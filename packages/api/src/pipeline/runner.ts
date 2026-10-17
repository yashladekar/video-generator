import { readFile } from "node:fs/promises";

import type { Prisma, Script, Scene, StepType } from "@video-generator/db";

import type { Context } from "../context";
import { AppError, CancelledError, MediaError, ValidationError } from "../lib/errors";
import { cleanupDir, createTempDir } from "../lib/fs";
import { hashCacheKey, extensionForMime } from "../lib/hash";
import { toJsonValue } from "../lib/json";
import { materializeAsset, mediaKey, storeAsset } from "./asset-store";
import { isReusableStepStatus, latestStepsByType } from "./checkpoint";
import { guardPaidCall, recordProviderUsage } from "./provider-usage";
import { renderReel, type RenderScene } from "./renderer";
import { generateSubtitles } from "./subtitles";
import { validateRenderedVideo } from "./validate";
import { ensureUserSettings } from "../services/budget";
import { researchWithFallback } from "../providers/research/research";
import { generateScriptWithFallback } from "../providers/llm";
import { synthesizeWithFallback } from "../providers/tts";
import {
  generateImageWithFallback,
  generateVideoWithFallback,
} from "../providers/visual";
import { renderProceduralMusic } from "../providers/music/procedural";
import { resolveProviderChain } from "../providers/resolve";
import {
  createStorageService,
  providerCallContextForStorage,
  type StorageService,
} from "../providers/storage";

type LoadedJob = Awaited<ReturnType<typeof loadJob>>;
type PipelineSettings = Awaited<ReturnType<typeof ensureUserSettings>>;

const LOCAL_TTS = new Set(["macos-say", "espeak-ng", "piper"]);
const IMAGE_SOURCE: Record<string, "PROCEDURAL" | "PEXELS" | "FAL" | "WAVESPEED" | "COMFYUI" | "OTHER"> = {
  procedural: "PROCEDURAL",
  pexels: "PEXELS",
  fal: "FAL",
  wavespeed: "WAVESPEED",
  comfyui: "COMFYUI",
};

export async function runGenerationJob(params: {
  ctx: Context;
  jobId: string;
  signal?: AbortSignal;
}) {
  const { ctx, jobId } = params;
  const signal = params.signal ?? new AbortController().signal;
  const job = await loadJob(ctx, jobId);
  if (job.status === "CANCELLED" || job.status === "SUCCEEDED") return;

  const baseSettings = await ensureUserSettings(ctx, job.userId);
  const metadata = (job.metadata ?? {}) as {
    settings?: Partial<PipelineSettings>;
    targetDurationSeconds?: number;
    researchEnabled?: boolean;
    renderKind?: "PREVIEW" | "FINAL";
    parts?: string[];
  };
  const settings: PipelineSettings = {
    ...baseSettings,
    ...(metadata.settings ?? {}),
  };

  const storage = await createStorageService(
    ctx,
    job.userId,
    providerCallContextForStorage(ctx, job.userId),
  );
  const workDir = await createTempDir(`reel-${job.id.slice(0, 8)}-`);

  try {
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date(),
        errorCode: null,
        errorClass: null,
        errorMessage: null,
        attempt: { increment: 1 },
      },
    });

    const runtime = createRuntime({
      ctx,
      job,
      settings,
      storage,
      workDir,
      signal,
      targetDurationSeconds:
        metadata.targetDurationSeconds ?? job.project.durationSeconds,
      researchEnabled:
        metadata.researchEnabled ?? job.project.brief?.researchEnabled ?? false,
      renderKind: metadata.renderKind,
      parts: metadata.parts,
    });

    await runStages(runtime);
    await finalizeSuccess(runtime);
  } catch (error) {
    await handleFailure(ctx, job, error);
  } finally {
    await cleanupDir(workDir);
  }
}

async function loadJob(ctx: Context, jobId: string) {
  return ctx.db.generationJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      project: { include: { brief: true, thumbnailAsset: true } },
    },
  });
}

function createRuntime(input: {
  ctx: Context;
  job: LoadedJob;
  settings: PipelineSettings;
  storage: StorageService;
  workDir: string;
  signal: AbortSignal;
  targetDurationSeconds: number;
  researchEnabled: boolean;
  renderKind?: "PREVIEW" | "FINAL";
  parts?: string[];
}) {
  const { ctx, job, settings, storage, workDir, signal } = input;

  const checkCancelled = async () => {
    if (signal.aborted) throw new CancelledError();
    const current = await ctx.db.generationJob.findUnique({
      where: { id: job.id },
      select: { cancelRequested: true, status: true },
    });
    if (current?.cancelRequested || current?.status === "CANCELLED") {
      throw new CancelledError();
    }
  };

  const latestStep = async (type: StepType) =>
    ctx.db.generationStep.findFirst({
      where: { jobId: job.id, type },
      orderBy: { attempt: "desc" },
    });

  const getOutput = async <T,>(type: StepType): Promise<T | null> => {
    const step = await latestStep(type);
    return (step?.output as T | null) ?? null;
  };

  const updateProgress = async () => {
    const steps = await ctx.db.generationStep.findMany({
      where: { jobId: job.id },
      orderBy: { attempt: "asc" },
    });
    const latest = latestStepsByType(steps);
    const total = latest.size;
    const done = [...latest.values()].filter((step) =>
      isReusableStepStatus(step.status),
    ).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: { progress: Math.min(99, progress) },
    });
  };

  const runStep = async <T,>(
    type: StepType,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const step = await latestStep(type);
    if (!step) {
      throw new ValidationError(`Missing generation step ${type}`);
    }
    if (isReusableStepStatus(step.status)) {
      return (step.output as T) ?? (undefined as T);
    }
    await checkCancelled();
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: { currentStep: type, status: "RUNNING" },
    });
    const startedAt = new Date();
    await ctx.db.generationStep.update({
      where: { id: step.id },
      data: {
        status: "RUNNING",
        startedAt,
        completedAt: null,
        errorCode: null,
        errorClass: null,
        errorMessage: null,
      },
    });
    try {
      const output = await fn();
      const skipped =
        output !== null &&
        typeof output === "object" &&
        (output as { skipped?: boolean }).skipped === true;
      const jsonOutput =
        output === null || output === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue);
      await ctx.db.generationStep.update({
        where: { id: step.id },
        data: {
          status: skipped ? "SKIPPED" : "SUCCEEDED",
          output: jsonOutput,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      });
      await updateProgress();
      return output;
    } catch (error) {
      await ctx.db.generationStep.update({
        where: { id: step.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorCode:
            error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
          errorClass:
            error instanceof AppError ? error.kind : "INTERNAL",
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : String(error),
        },
      });
      await updateProgress();
      throw error;
    }
  };

  return {
    ctx,
    job,
    project: job.project,
    settings,
    storage,
    workDir,
    signal,
    targetDurationSeconds: input.targetDurationSeconds,
    researchEnabled: input.researchEnabled,
    renderKind: input.renderKind,
    parts: input.parts,
    checkCancelled,
    getOutput,
    runStep,
    updateProgress,
  };
}

type Runtime = ReturnType<typeof createRuntime>;

async function runStages(runtime: Runtime) {
  const kind = runtime.job.kind;
  if (kind === "GENERATE") {
    await runtime.runStep("VALIDATE", () => validateStage(runtime));
    await runtime.runStep("RESEARCH", () => researchStage(runtime));
    await runtime.runStep("SCRIPT", () => scriptStage(runtime));
    await runtime.runStep("SCENES", () => scenesStage(runtime));
    await runtime.runStep("NARRATION", () => narrationStage(runtime));
    await runtime.runStep("VISUALS", () => visualsStage(runtime));
    await runtime.runStep("AI_VIDEO", () => aiVideoStage(runtime));
    await runtime.runStep("SUBTITLES", () => subtitlesStage(runtime));
    await runtime.runStep("MUSIC", () => musicStage(runtime));
    await runtime.runStep("RENDER", () => renderStage(runtime));
    await runtime.runStep("VALIDATE_OUTPUT", () => validateOutputStage(runtime));
    await runtime.runStep("FINALIZE", () => finalizeStage(runtime));
    return;
  }
  if (kind === "RENDER") {
    await runtime.runStep("RENDER", () => renderStage(runtime));
    await runtime.runStep("VALIDATE_OUTPUT", () => validateOutputStage(runtime));
    await runtime.runStep("FINALIZE", () => finalizeStage(runtime));
    return;
  }
  if (kind === "REGENERATE_SCENE") {
    await runtime.runStep("NARRATION", () => regenerateSceneStage(runtime, "narration"));
    await runtime.runStep("VISUALS", () => regenerateSceneStage(runtime, "visual"));
    await runtime.runStep("SUBTITLES", () => subtitlesStage(runtime));
    await runtime.runStep("RENDER", () => renderStage(runtime));
    await runtime.runStep("VALIDATE_OUTPUT", () => validateOutputStage(runtime));
    await runtime.runStep("FINALIZE", () => finalizeStage(runtime));
    return;
  }
  throw new ValidationError(`Unsupported job kind: ${kind}`);
}

async function validateStage(runtime: Runtime) {
  const brief = runtime.project.brief;
  if (!brief) throw new ValidationError("Content brief is missing");
  if (!runtime.project.topic.trim()) {
    throw new ValidationError("A topic is required");
  }
  const chains = await Promise.all(
    (["LLM", "TTS", "IMAGE"] as const).map((category) =>
      resolveProviderChain(
        runtime.ctx,
        runtime.job.userId,
        category,
        category === "LLM"
          ? runtime.settings.preferredLlmProvider
          : category === "TTS"
            ? runtime.settings.preferredTtsProvider
            : runtime.settings.preferredVisualProvider,
        { localOnly: runtime.settings.localOnly },
      ),
    ),
  );
  if (chains.some((chain) => chain.length === 0)) {
    throw new ValidationError(
      "One or more required provider categories have no available provider",
    );
  }
  return {
    ok: true,
    targetDurationSeconds: runtime.targetDurationSeconds,
    researchEnabled: runtime.researchEnabled,
    localOnly: runtime.settings.localOnly,
  };
}

async function researchStage(runtime: Runtime) {
  if (!runtime.researchEnabled) {
    return { skipped: true, reason: "Research is disabled for this brief" };
  }
  const result = await researchWithFallback(
    runtime.ctx,
    runtime.job.userId,
    runtime.project.topic,
    {
      preferredProvider: undefined,
      localOnly: runtime.settings.localOnly,
      signal: runtime.signal,
    },
  );
  if (!result) {
    return {
      summary: "",
      sources: [],
      warning: "No research provider was available; continuing without research.",
    };
  }
  return {
    summary: result.summary,
    sources: result.sources,
    provider: result.provider,
  };
}

async function scriptStage(runtime: Runtime) {
  await runtime.checkCancelled();
  const research = await runtime.getOutput<{
    summary?: string;
    sources?: unknown[];
  }>("RESEARCH");
  const brief = runtime.project.brief;
  if (!brief) throw new ValidationError("Content brief is missing");

  const generated = await generateScriptWithFallback(
    runtime.ctx,
    runtime.job.userId,
    {
      brief: {
        topic: brief.topic,
        targetAudience: brief.targetAudience,
        objective: brief.objective,
        niche: brief.niche,
        language: brief.language,
        tone: brief.tone,
        style: brief.style,
        callToAction: brief.callToAction,
        referenceText: brief.referenceText,
        researchEnabled: brief.researchEnabled,
      },
      targetDurationSeconds: runtime.targetDurationSeconds,
      researchSummary: research?.summary,
      visualStyle: runtime.project.visualStyle,
      musicMood: runtime.project.musicMood,
      narrationStyle: runtime.project.narrationStyle,
    },
    {
      preferredProvider: runtime.settings.preferredLlmProvider,
      localOnly: runtime.settings.localOnly,
      autoFallback: runtime.settings.autoFallback,
      signal: runtime.signal,
    },
  );

  const latest = await runtime.ctx.db.script.findFirst({
    where: { projectId: runtime.project.id },
    orderBy: { version: "desc" },
  });
  const version = (latest?.version ?? 0) + 1;
  const script = await runtime.ctx.db.script.create({
    data: {
      projectId: runtime.project.id,
      version,
      status: "DRAFT",
      title: generated.script.title,
      hook: generated.script.hook,
      targetDurationSeconds: generated.script.targetDurationSeconds,
      aspectRatio: generated.script.aspectRatio,
      language: generated.script.language,
      provider: generated.provider,
      model: generated.model,
      researchSummary: research?.summary,
      researchSources: toJsonValue(research?.sources),
      rawResponse: generated.raw,
      validationErrors:
        generated.validationErrors.length > 0
          ? generated.validationErrors
          : undefined,
      scenes: {
        create: generated.script.scenes.map((scene) => ({
          sceneNumber: scene.sceneNumber,
          orderIndex: scene.orderIndex,
          durationSeconds: scene.durationSeconds,
          startSeconds: scene.startSeconds,
          endSeconds: scene.endSeconds,
          narration: scene.narration,
          visualDescription: scene.visualDescription,
          visualType: scene.visualType,
          subtitleText: scene.subtitleText,
          transition: scene.transition,
          motion: scene.motion,
          status: "PLANNED",
        })),
      },
    },
    include: { scenes: true },
  });

  await runtime.ctx.db.generationJob.update({
    where: { id: runtime.job.id },
    data: { scriptId: script.id },
  });

  const usage = generated.usage;
  const totalTokens =
    (usage?.inputUnits ?? 0) + (usage?.outputUnits ?? 0);
  const unit = generated.provider === "openai-compatible" ? "1k_tokens" : "request";
  const units =
    generated.provider === "openai-compatible"
      ? Math.max(1, totalTokens / 1000)
      : 1;
  await recordProviderUsage(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: runtime.project.id,
    jobId: runtime.job.id,
    provider: generated.provider,
    category: "LLM",
    model: generated.model,
    units,
    unit,
    providerRequestId: generated.requestId,
    usage,
    settings: runtime.settings,
  });

  return {
    scriptId: script.id,
    provider: generated.provider,
    model: generated.model,
    sceneCount: script.scenes.length,
  };
}

async function scenesStage(runtime: Runtime) {
  const script = await runtime.ctx.db.script.findFirst({
    where: { projectId: runtime.project.id },
    orderBy: { version: "desc" },
    include: { scenes: { orderBy: { orderIndex: "asc" } } },
  });
  if (!script || script.scenes.length === 0) {
    throw new ValidationError("No script scenes were generated");
  }
  const total = script.scenes.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0,
  );
  const tolerance = Math.max(2, runtime.targetDurationSeconds * 0.06);
  if (Math.abs(total - runtime.targetDurationSeconds) > tolerance) {
    throw new ValidationError(
      `Scene durations sum to ${total.toFixed(1)}s but the target is ${runtime.targetDurationSeconds}s`,
    );
  }

  const pexelsChain = await resolveProviderChain(
    runtime.ctx,
    runtime.job.userId,
    "IMAGE",
    "pexels",
  ).catch(() => []);
  const hasPexels = pexelsChain.some((entry) => entry.provider === "pexels");

  for (const scene of script.scenes) {
    let visualType = scene.visualType;
    if (
      runtime.settings.localOnly &&
      (visualType === "AI_IMAGE" || visualType === "AI_VIDEO")
    ) {
      visualType = "PROCEDURAL";
    }
    if (
      !hasPexels &&
      (visualType === "STOCK_IMAGE" || visualType === "STOCK_VIDEO")
    ) {
      visualType = "PROCEDURAL";
    }
    if (visualType !== scene.visualType) {
      await runtime.ctx.db.scene.update({
        where: { id: scene.id },
        data: { visualType },
      });
    }
  }

  return {
    scriptId: script.id,
    sceneCount: script.scenes.length,
    totalDuration: total,
    hasPexels,
  };
}

async function narrationStage(runtime: Runtime) {
  await runtime.checkCancelled();
  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
    include: { narrationAsset: true },
  });

  type Generated = {
    scene: Scene;
    assetId: string;
    audioDuration: number;
    plannedDuration: number;
  };
  let generated: Generated[] = [];

  for (const scene of scenes) {
    await runtime.checkCancelled();
    if (scene.narrationAsset?.status === "READY") {
      generated.push({
        scene,
        assetId: scene.narrationAsset.id,
        audioDuration: scene.narrationAsset.durationSeconds ?? scene.durationSeconds,
        plannedDuration: scene.durationSeconds,
      });
      continue;
    }
    const voice = runtime.settings.defaultVoice ?? runtime.project.voice ?? undefined;
    const cacheKey = hashCacheKey({
      type: "narration",
      text: scene.narration,
      voice,
      language: runtime.project.language,
      preferredProvider: runtime.settings.preferredTtsProvider ?? "auto",
      speed: 1,
    });
    const cached = await runtime.ctx.db.mediaAsset.findUnique({
      where: { cacheKey },
    });
    if (cached && cached.status === "READY") {
      await runtime.ctx.db.scene.update({
        where: { id: scene.id },
        data: { narrationAssetId: cached.id },
      });
      generated.push({
        scene,
        assetId: cached.id,
        audioDuration: cached.durationSeconds ?? scene.durationSeconds,
        plannedDuration: scene.durationSeconds,
      });
      continue;
    }

    const tts = await synthesizeWithFallback(
      runtime.ctx,
      runtime.job.userId,
      {
        text: scene.narration,
        voice,
        language: runtime.project.language,
        speed: 1,
        format: "wav",
      },
      {
        preferredProvider: runtime.settings.preferredTtsProvider,
        localOnly: runtime.settings.localOnly,
        autoFallback: runtime.settings.autoFallback,
        signal: runtime.signal,
      },
    );
    const key = mediaKey(
      runtime.project.id,
      "audio",
      `scene-${scene.sceneNumber}-${cacheKey.slice(0, 12)}.wav`,
    );
    const asset = await storeAsset(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: runtime.project.id,
      kind: "NARRATION",
      source: LOCAL_TTS.has(tts.provider) ? "LOCAL" : "OTHER",
      storageKey: key,
      data: tts.audio,
      mimeType: tts.mimeType,
      durationSeconds: tts.durationSeconds,
      provider: tts.provider,
      providerModel: undefined,
      providerRequestId: tts.requestId,
      cacheKey,
      storage: runtime.storage,
    });
    await runtime.ctx.db.scene.update({
      where: { id: scene.id },
      data: { narrationAssetId: asset.id },
    });
    await recordProviderUsage(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: runtime.project.id,
      jobId: runtime.job.id,
      provider: tts.provider,
      category: "TTS",
      units: scene.narration.length,
      unit: "character",
      providerRequestId: tts.requestId,
      usage: tts.usage,
      settings: runtime.settings,
    });
    generated.push({
      scene,
      assetId: asset.id,
      audioDuration: asset.durationSeconds ?? tts.durationSeconds ?? 0,
      plannedDuration: scene.durationSeconds,
    });
  }

  const tolerance = Math.max(2, runtime.targetDurationSeconds * 0.05);
  let durations = generated.map((item) =>
    Math.max(item.plannedDuration, item.audioDuration + 0.25),
  );
  let total = durations.reduce((sum, value) => sum + value, 0);

  if (total > runtime.targetDurationSeconds + tolerance) {
    const reworked: Generated[] = [];
    for (const item of generated) {
      if (item.audioDuration <= item.plannedDuration + 0.05) {
        reworked.push(item);
        continue;
      }
      const speed = Math.min(
        1.25,
        Math.max(1.02, item.audioDuration / item.plannedDuration + 0.02),
      );
      const voice = runtime.settings.defaultVoice ?? runtime.project.voice ?? undefined;
      const cacheKey = hashCacheKey({
        type: "narration",
        text: item.scene.narration,
        voice,
        language: runtime.project.language,
        preferredProvider: runtime.settings.preferredTtsProvider ?? "auto",
        speed,
      });
      const cached = await runtime.ctx.db.mediaAsset.findUnique({ where: { cacheKey } });
      if (cached && cached.status === "READY") {
        reworked.push({
          ...item,
          assetId: cached.id,
          audioDuration: cached.durationSeconds ?? item.audioDuration,
        });
        continue;
      }
      const tts = await synthesizeWithFallback(
        runtime.ctx,
        runtime.job.userId,
        {
          text: item.scene.narration,
          voice,
          language: runtime.project.language,
          speed,
          format: "wav",
        },
        {
          preferredProvider: runtime.settings.preferredTtsProvider,
          localOnly: runtime.settings.localOnly,
          autoFallback: runtime.settings.autoFallback,
          signal: runtime.signal,
        },
      );
      const key = mediaKey(
        runtime.project.id,
        "audio",
        `scene-${item.scene.sceneNumber}-${cacheKey.slice(0, 12)}.wav`,
      );
      const asset = await storeAsset(runtime.ctx, {
        userId: runtime.job.userId,
        projectId: runtime.project.id,
        kind: "NARRATION",
        source: LOCAL_TTS.has(tts.provider) ? "LOCAL" : "OTHER",
        storageKey: key,
        data: tts.audio,
        mimeType: tts.mimeType,
        durationSeconds: tts.durationSeconds,
        provider: tts.provider,
        providerRequestId: tts.requestId,
        cacheKey,
        storage: runtime.storage,
      });
      await runtime.ctx.db.scene.update({
        where: { id: item.scene.id },
        data: { narrationAssetId: asset.id },
      });
      await recordProviderUsage(runtime.ctx, {
        userId: runtime.job.userId,
        projectId: runtime.project.id,
        jobId: runtime.job.id,
        provider: tts.provider,
        category: "TTS",
        units: item.scene.narration.length,
        unit: "character",
        providerRequestId: tts.requestId,
        usage: tts.usage,
        settings: runtime.settings,
      });
      reworked.push({
        ...item,
        assetId: asset.id,
        audioDuration: asset.durationSeconds ?? tts.durationSeconds ?? 0,
      });
    }
    generated = reworked;
    durations = generated.map((item) =>
      Math.max(item.plannedDuration, item.audioDuration + 0.25),
    );
    total = durations.reduce((sum, value) => sum + value, 0);
  }

  if (total > runtime.targetDurationSeconds + tolerance) {
    throw new MediaError(
      "NARRATION_TOO_LONG",
      `Narration needs ${total.toFixed(1)}s even after speed-up, but the target is ${runtime.targetDurationSeconds}s. Choose a faster voice or shorten the script.`,
    );
  }

  if (total < runtime.targetDurationSeconds) {
    const extra = runtime.targetDurationSeconds - total;
    const weights = durations.map((value) => value / total);
    durations = durations.map(
      (value, index) => value + extra * (weights[index] ?? 0),
    );
  }

  let cursor = 0;
  const sceneTimings: Array<{
    sceneId: string;
    assetId: string;
    durationSeconds: number;
    audioDuration: number;
  }> = [];
  for (const [index, item] of generated.entries()) {
    const duration = durations[index] ?? item.plannedDuration;
    await runtime.ctx.db.scene.update({
      where: { id: item.scene.id },
      data: {
        durationSeconds: duration,
        startSeconds: cursor,
        endSeconds: cursor + duration,
        status: "READY",
      },
    });
    cursor += duration;
    sceneTimings.push({
      sceneId: item.scene.id,
      assetId: item.assetId,
      durationSeconds: duration,
      audioDuration: item.audioDuration,
    });
  }

  return {
    totalDuration: cursor,
    scenes: sceneTimings,
  };
}

async function visualsStage(runtime: Runtime) {
  await runtime.checkCancelled();
  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
    include: { visualAsset: true },
  });
  const { width, height } = outputDimensions(runtime.project.resolution, false);
  const results: Array<{
    sceneId: string;
    assetId: string;
    provider: string;
    kind: string;
  }> = [];
  const warnings: string[] = [];

  for (const scene of scenes) {
    await runtime.checkCancelled();
    if (scene.visualType === "AI_VIDEO") continue;
    if (scene.visualAsset?.status === "READY") {
      results.push({
        sceneId: scene.id,
        assetId: scene.visualAsset.id,
        provider: scene.visualAsset.provider ?? "unknown",
        kind: scene.visualAsset.kind,
      });
      continue;
    }

    const preferred =
      scene.visualType === "STOCK_IMAGE"
        ? "pexels"
        : scene.visualType === "AI_IMAGE"
          ? runtime.settings.preferredVisualProvider
          : "procedural";
    const prompt = `${scene.visualDescription}. Vertical 9:16 composition, ${runtime.project.visualStyle} style, cinematic lighting, no embedded text.`;

    if (scene.visualType === "STOCK_VIDEO") {
      const pexelsChain = await resolveProviderChain(
        runtime.ctx,
        runtime.job.userId,
        "TEXT_TO_VIDEO",
        "pexels",
      ).catch(() => []);
      if (pexelsChain.some((entry) => entry.provider === "pexels")) {
        try {
          const video = await generateVideoWithFallback(
            runtime.ctx,
            runtime.job.userId,
            {
              prompt,
              durationSeconds: Math.min(5, scene.durationSeconds),
              aspectRatio: "9:16",
              width,
              height,
            },
            {
              preferredProvider: "pexels",
              localOnly: runtime.settings.localOnly,
              autoFallback: false,
              signal: runtime.signal,
            },
          );
          const cacheKey = hashCacheKey({
            type: "stock-video",
            prompt,
            width,
            height,
          });
          const key = mediaKey(
            runtime.project.id,
            "visuals",
            `scene-${scene.sceneNumber}-${cacheKey.slice(0, 12)}.mp4`,
          );
          const asset = await storeAsset(runtime.ctx, {
            userId: runtime.job.userId,
            projectId: runtime.project.id,
            kind: "VIDEO",
            source: "PEXELS",
            storageKey: key,
            data: video.video,
            mimeType: video.mimeType,
            durationSeconds: video.durationSeconds,
            attribution: video.attribution,
            provider: video.provider,
            providerRequestId: video.requestId,
            cacheKey,
            storage: runtime.storage,
          });
          await runtime.ctx.db.scene.update({
            where: { id: scene.id },
            data: { visualAssetId: asset.id, status: "ASSETS_READY" },
          });
          await recordProviderUsage(runtime.ctx, {
            userId: runtime.job.userId,
            projectId: runtime.project.id,
            jobId: runtime.job.id,
            provider: video.provider,
            category: "TEXT_TO_VIDEO",
            units: video.durationSeconds ?? Math.min(5, scene.durationSeconds),
            unit: "second",
            providerRequestId: video.requestId,
            usage: video.usage,
            settings: runtime.settings,
          });
          results.push({
            sceneId: scene.id,
            assetId: asset.id,
            provider: video.provider,
            kind: "VIDEO",
          });
          continue;
        } catch (error) {
          warnings.push(
            `Scene ${scene.sceneNumber}: stock video failed, using an image instead. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const chain = await resolveProviderChain(
      runtime.ctx,
      runtime.job.userId,
      "IMAGE",
      preferred,
      { localOnly: runtime.settings.localOnly },
    );
    const first = chain[0];
    if (first) {
      const model =
        typeof first.config.model === "string" ? first.config.model : undefined;
      await guardPaidCall(
        runtime.ctx,
        runtime.job.userId,
        first.provider,
        "IMAGE",
        model,
        "image",
      );
    }
    const image = await generateImageWithFallback(
      runtime.ctx,
      runtime.job.userId,
      {
        prompt,
        width,
        height,
        style: runtime.project.visualStyle,
        seed: scene.sceneNumber * 7919,
      },
      {
        preferredProvider: preferred,
        localOnly: runtime.settings.localOnly,
        autoFallback: runtime.settings.autoFallback,
        signal: runtime.signal,
      },
    );
    const cacheKey = hashCacheKey({
      type: "image",
      prompt,
      width,
      height,
      preferredProvider: preferred ?? "auto",
    });
    const extension = extensionForMime(image.mimeType);
    const key = mediaKey(
      runtime.project.id,
      "visuals",
      `scene-${scene.sceneNumber}-${cacheKey.slice(0, 12)}.${extension}`,
    );
    const asset = await storeAsset(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: runtime.project.id,
      kind: "IMAGE",
      source: IMAGE_SOURCE[image.provider] ?? "OTHER",
      storageKey: key,
      data: image.image,
      mimeType: image.mimeType,
      width: image.width ?? width,
      height: image.height ?? height,
      attribution: image.attribution,
      provider: image.provider,
      providerModel:
        typeof image.resolvedProvider.config.model === "string"
          ? image.resolvedProvider.config.model
          : undefined,
      providerRequestId: image.requestId,
      cacheKey,
      storage: runtime.storage,
    });
    await runtime.ctx.db.scene.update({
      where: { id: scene.id },
      data: { visualAssetId: asset.id, status: "ASSETS_READY" },
    });
    await recordProviderUsage(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: runtime.project.id,
      jobId: runtime.job.id,
      provider: image.provider,
      category: "IMAGE",
      model:
        typeof image.resolvedProvider.config.model === "string"
          ? image.resolvedProvider.config.model
          : undefined,
      units: 1,
      unit: "image",
      providerRequestId: image.requestId,
      usage: image.usage,
      settings: runtime.settings,
    });
    results.push({
      sceneId: scene.id,
      assetId: asset.id,
      provider: image.provider,
      kind: "IMAGE",
    });
  }

  return { scenes: results, warnings };
}

async function aiVideoStage(runtime: Runtime) {
  const preferred = runtime.settings.preferredVideoProvider;
  if (
    runtime.settings.localOnly ||
    runtime.settings.maxHostedVideoCalls <= 0 ||
    !preferred ||
    preferred === "auto" ||
    preferred === "none"
  ) {
    return {
      skipped: true,
      reason: "Hosted AI video is not selected for this project",
    };
  }
  const chain = await resolveProviderChain(
    runtime.ctx,
    runtime.job.userId,
    "TEXT_TO_VIDEO",
    preferred,
    { localOnly: runtime.settings.localOnly },
  );
  if (chain.length === 0) {
    return { skipped: true, reason: "No video provider is configured" };
  }

  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
    include: { visualAsset: true },
  });
  const limit = runtime.settings.maxHostedVideoCalls;
  const selected: Scene[] = scenes
    .filter((scene) => scene.visualType === "AI_VIDEO")
    .slice(0, limit);
  if (selected.length < limit) {
    const candidates: Scene[] = [];
    const firstScene = scenes[0];
    const lastScene = scenes[scenes.length - 1];
    if (firstScene) candidates.push(firstScene);
    if (lastScene) candidates.push(lastScene);
    for (const scene of candidates) {
      if (selected.length >= limit) break;
      if (!selected.some((item) => item.id === scene.id)) selected.push(scene);
    }
  }

  const { width, height } = outputDimensions(runtime.project.resolution, false);
  const warnings: string[] = [];
  const results: Array<{ sceneId: string; assetId: string; provider: string }> = [];

  for (const scene of selected) {
    await runtime.checkCancelled();
    const first = chain[0];
    if (!first) continue;
    const model =
      typeof first.config.model === "string" ? first.config.model : undefined;
    try {
      await guardPaidCall(
        runtime.ctx,
        runtime.job.userId,
        first.provider,
        "TEXT_TO_VIDEO",
        model,
        "second",
        { duration: 5, aspect_ratio: "9:16" },
      );
      const video = await generateVideoWithFallback(
        runtime.ctx,
        runtime.job.userId,
        {
          prompt: `${scene.visualDescription}. Vertical 9:16, ${runtime.project.visualStyle}, cinematic motion, no text.`,
          durationSeconds: Math.min(5, scene.durationSeconds),
          aspectRatio: "9:16",
          width,
          height,
        },
        {
          preferredProvider: preferred,
          localOnly: runtime.settings.localOnly,
          autoFallback: runtime.settings.autoFallback,
          signal: runtime.signal,
        },
      );
      const cacheKey = hashCacheKey({
        type: "ai-video",
        prompt: scene.visualDescription,
        provider: video.provider,
        width,
        height,
      });
      const key = mediaKey(
        runtime.project.id,
        "visuals",
        `scene-${scene.sceneNumber}-ai-${cacheKey.slice(0, 12)}.mp4`,
      );
      const asset = await storeAsset(runtime.ctx, {
        userId: runtime.job.userId,
        projectId: runtime.project.id,
        kind: "VIDEO",
        source: IMAGE_SOURCE[video.provider] ?? "OTHER",
        storageKey: key,
        data: video.video,
        mimeType: video.mimeType,
        durationSeconds: video.durationSeconds,
        attribution: video.attribution,
        provider: video.provider,
        providerModel: model,
        providerRequestId: video.requestId,
        cacheKey,
        metadata: { aiVideo: true },
        storage: runtime.storage,
      });
      await runtime.ctx.db.scene.update({
        where: { id: scene.id },
        data: {
          visualAssetId: asset.id,
          status: "READY",
          metadata: { aiVideo: true },
        },
      });
      await recordProviderUsage(runtime.ctx, {
        userId: runtime.job.userId,
        projectId: runtime.project.id,
        jobId: runtime.job.id,
        provider: video.provider,
        category: "TEXT_TO_VIDEO",
        model,
        units: video.durationSeconds ?? Math.min(5, scene.durationSeconds),
        unit: "second",
        providerRequestId: video.requestId,
        usage: video.usage,
        settings: runtime.settings,
      });
      results.push({
        sceneId: scene.id,
        assetId: asset.id,
        provider: video.provider,
      });
    } catch (error) {
      if (!runtime.settings.autoFallback) throw error;
      warnings.push(
        `Scene ${scene.sceneNumber}: AI video failed, falling back to an image. ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        const image = await generateImageWithFallback(
          runtime.ctx,
          runtime.job.userId,
          {
            prompt: `${scene.visualDescription}. Vertical 9:16, ${runtime.project.visualStyle}, no text.`,
            width,
            height,
            style: runtime.project.visualStyle,
            seed: scene.sceneNumber * 104729,
          },
          {
            preferredProvider: "procedural",
            localOnly: true,
            autoFallback: true,
            signal: runtime.signal,
          },
        );
        const key = mediaKey(
          runtime.project.id,
          "visuals",
          `scene-${scene.sceneNumber}-fallback.png`,
        );
        const asset = await storeAsset(runtime.ctx, {
          userId: runtime.job.userId,
          projectId: runtime.project.id,
          kind: "IMAGE",
          source: "PROCEDURAL",
          storageKey: key.replace(/\.png$/, ".jpg"),
          data: image.image,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          provider: image.provider,
          metadata: { aiVideoFallback: true },
          storage: runtime.storage,
        });
        await runtime.ctx.db.scene.update({
          where: { id: scene.id },
          data: {
            visualAssetId: asset.id,
            status: "READY",
            metadata: { aiVideoFallback: true },
          },
        });
        results.push({
          sceneId: scene.id,
          assetId: asset.id,
          provider: image.provider,
        });
      } catch (fallbackError) {
        warnings.push(
          `Scene ${scene.sceneNumber}: fallback image also failed. ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }
  }

  return { selected: results, warnings };
}

async function subtitlesStage(runtime: Runtime) {
  await runtime.checkCancelled();
  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
  });
  const result = await generateSubtitles(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: runtime.project.id,
    scenes,
    style: runtime.project.subtitleStyle,
    position: runtime.project.captionPosition,
    storage: runtime.storage,
    workDir: runtime.workDir,
  });
  return result;
}

async function musicStage(runtime: Runtime) {
  if (runtime.project.musicMood === "none") {
    return { skipped: true, reason: "Music is disabled" };
  }
  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
  });
  const duration = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const cacheKey = hashCacheKey({
    type: "music",
    mood: runtime.project.musicMood,
    duration: Math.round(duration),
  });
  const cached = await runtime.ctx.db.mediaAsset.findUnique({ where: { cacheKey } });
  if (cached && cached.status === "READY") {
    return { assetId: cached.id, key: cached.storageKey, duration };
  }
  const music = await renderProceduralMusic(
    runtime.project.musicMood,
    duration,
    Math.round(duration * 1000),
  );
  const key = mediaKey(runtime.project.id, "music", `${cacheKey.slice(0, 16)}.wav`);
  const asset = await storeAsset(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: runtime.project.id,
    kind: "MUSIC",
    source: "MUSIC_GENERATOR",
    storageKey: key,
    data: music.audio,
    mimeType: "audio/wav",
    durationSeconds: music.durationSeconds,
    provider: "music-generator",
    cacheKey,
    storage: runtime.storage,
  });
  return { assetId: asset.id, key: asset.storageKey, duration: music.durationSeconds };
}

async function renderStage(runtime: Runtime) {
  await runtime.checkCancelled();
  const script = await requireLatestScript(runtime);
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { orderIndex: "asc" },
    include: { visualAsset: true, narrationAsset: true },
  });
  const subtitles = await runtime.getOutput<{
    chunksByScene: Record<
      string,
      Array<{
        key: string;
        width: number;
        height: number;
        x: number;
        y: number;
        startSeconds: number;
        endSeconds: number;
      }>
    >;
  }>("SUBTITLES");
  const music = await runtime.getOutput<{ assetId?: string; key?: string }>("MUSIC");
  const preview =
    runtime.job.kind === "RENDER" && runtime.renderKind === "PREVIEW";
  const { width, height } = outputDimensions(
    runtime.project.resolution,
    preview,
  );
  const renderScenes: RenderScene[] = [];

  for (const [index, scene] of scenes.entries()) {
    if (!scene.visualAsset) {
      throw new MediaError(
        "MISSING_VISUAL",
        `Scene ${scene.sceneNumber} has no visual asset`,
      );
    }
    if (!scene.narrationAsset) {
      throw new MediaError(
        "MISSING_NARRATION",
        `Scene ${scene.sceneNumber} has no narration asset`,
      );
    }
    const visualExt = extensionForMime(scene.visualAsset.mimeType);
    const narrationExt = extensionForMime(scene.narrationAsset.mimeType);
    const visualPath = await materializeAsset(
      runtime.storage,
      scene.visualAsset.storageKey,
      runtime.workDir,
      `visual-${index}.${visualExt}`,
    );
    const narrationPath = await materializeAsset(
      runtime.storage,
      scene.narrationAsset.storageKey,
      runtime.workDir,
      `narration-${index}.${narrationExt}`,
    );
    const captionChunks = subtitles?.chunksByScene[scene.id] ?? [];
    const captions = [];
    for (const [captionIndex, chunk] of captionChunks.entries()) {
      const captionPath = await materializeAsset(
        runtime.storage,
        chunk.key,
        runtime.workDir,
        `caption-${index}-${captionIndex}.png`,
      );
      captions.push({
        path: captionPath,
        width: chunk.width,
        height: chunk.height,
        x: chunk.x,
        y: chunk.y,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
      });
    }
    renderScenes.push({
      index,
      visualPath,
      visualMimeType: scene.visualAsset.mimeType,
      narrationPath,
      durationSeconds: scene.durationSeconds,
      captions,
      motion: scene.motion,
    });
  }

  let musicPath: string | null = null;
  if (music?.key) {
    musicPath = await materializeAsset(
      runtime.storage,
      music.key,
      runtime.workDir,
      "music.wav",
    );
  }

  const rendered = await renderReel({
    workDir: runtime.workDir,
    scenes: renderScenes,
    musicPath,
    musicVolume: runtime.project.musicVolume,
    width,
    height,
    preview,
    ffmpegPath: runtime.ctx.env.FFMPEG_PATH,
    ffprobePath: runtime.ctx.env.FFPROBE_PATH,
  });

  const videoData = await readFile(rendered.filePath);
  const thumbData = await readFile(rendered.thumbnailPath);
  const kind = preview ? "PREVIEW" : "FINAL";
  const videoKey = mediaKey(
    runtime.project.id,
    "renders",
    `${runtime.job.id}-${kind.toLowerCase()}.mp4`,
  );
  const thumbKey = mediaKey(
    runtime.project.id,
    "renders",
    `${runtime.job.id}-${kind.toLowerCase()}-thumb.jpg`,
  );
  const videoAsset = await storeAsset(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: runtime.project.id,
    kind: "FINAL_VIDEO",
    source: "LOCAL",
    storageKey: videoKey,
    data: videoData,
    mimeType: "video/mp4",
    width: rendered.width,
    height: rendered.height,
    durationSeconds: rendered.durationSeconds,
    provider: "local",
    storage: runtime.storage,
  });
  const thumbAsset = await storeAsset(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: runtime.project.id,
    kind: "THUMBNAIL",
    source: "LOCAL",
    storageKey: thumbKey,
    data: thumbData,
    mimeType: "image/jpeg",
    width: rendered.width,
    height: rendered.height,
    provider: "local",
    storage: runtime.storage,
  });

  const existing = await runtime.ctx.db.renderedVideo.findFirst({
    where: { jobId: runtime.job.id, kind },
  });
  const renderedVideo = existing
    ? await runtime.ctx.db.renderedVideo.update({
        where: { id: existing.id },
        data: {
          status: "COMPLETED",
          videoAssetId: videoAsset.id,
          thumbnailAssetId: thumbAsset.id,
          durationSeconds: rendered.durationSeconds,
          width: rendered.width,
          height: rendered.height,
          fps: rendered.fps,
          fileSizeBytes: rendered.fileSizeBytes,
          validation: undefined,
        },
      })
    : await runtime.ctx.db.renderedVideo.create({
        data: {
          projectId: runtime.project.id,
          jobId: runtime.job.id,
          scriptId: script.id,
          userId: runtime.job.userId,
          kind,
          status: "COMPLETED",
          videoAssetId: videoAsset.id,
          thumbnailAssetId: thumbAsset.id,
          durationSeconds: rendered.durationSeconds,
          width: rendered.width,
          height: rendered.height,
          fps: rendered.fps,
          fileSizeBytes: rendered.fileSizeBytes,
        },
      });

  if (kind === "FINAL") {
    await runtime.ctx.db.project.update({
      where: { id: runtime.project.id },
      data: { thumbnailAssetId: thumbAsset.id },
    });
  }

  return {
    renderedVideoId: renderedVideo.id,
    videoAssetId: videoAsset.id,
    thumbnailAssetId: thumbAsset.id,
    videoKey,
    durationSeconds: rendered.durationSeconds,
    width: rendered.width,
    height: rendered.height,
    fps: rendered.fps,
    fileSizeBytes: rendered.fileSizeBytes,
    preview,
  };
}

async function validateOutputStage(runtime: Runtime) {
  const render = await runtime.getOutput<{
    renderedVideoId: string;
    videoKey: string;
    width: number;
    height: number;
  }>("RENDER");
  if (!render) throw new MediaError("RENDER_OUTPUT_MISSING", "Render output is missing");
  const videoPath = await materializeAsset(
    runtime.storage,
    render.videoKey,
    runtime.workDir,
    "validation.mp4",
  );
  const result = await validateRenderedVideo(videoPath, {
    durationSeconds: runtime.targetDurationSeconds,
    width: render.width,
    height: render.height,
    ffmpegPath: runtime.ctx.env.FFMPEG_PATH,
    ffprobePath: runtime.ctx.env.FFPROBE_PATH,
  });
  await runtime.ctx.db.renderedVideo.update({
    where: { id: render.renderedVideoId },
    data: {
      status: result.passed ? "COMPLETED" : "FAILED",
      validation: result as unknown as Prisma.InputJsonValue,
    },
  });
  if (!result.passed) {
    throw new MediaError(
      "OUTPUT_VALIDATION_FAILED",
      `Rendered video failed validation: ${result.issues.join(" ")}`,
      result,
    );
  }
  return result;
}

async function finalizeStage(runtime: Runtime) {
  if (runtime.job.kind === "GENERATE" || runtime.renderKind === "FINAL") {
    await runtime.ctx.db.project.update({
      where: { id: runtime.project.id },
      data: { status: "COMPLETED" },
    });
  }
  return { ok: true };
}

async function regenerateSceneStage(runtime: Runtime, part: "narration" | "visual") {
  const targetSceneId = runtime.job.targetSceneId;
  if (!targetSceneId) throw new ValidationError("Target scene is missing");
  const parts = runtime.parts ?? ["all"];
  const shouldRun =
    parts.includes("all") ||
    parts.includes("script") ||
    parts.includes(part);
  if (!shouldRun) return { skipped: true, part };
  if (part === "narration") {
    return regenerateNarration(runtime, targetSceneId);
  }
  return regenerateVisual(runtime, targetSceneId);
}

async function regenerateNarration(runtime: Runtime, sceneId: string) {
  const scene = await runtime.ctx.db.scene.findUnique({
    where: { id: sceneId },
    include: { script: { include: { project: true, scenes: true } } },
  });
  if (!scene || scene.script.project.userId !== runtime.job.userId) {
    throw new ValidationError("Target scene not found");
  }
  const voice = runtime.settings.defaultVoice ?? runtime.project.voice ?? undefined;
  const cacheKey = hashCacheKey({
    type: "narration",
    text: scene.narration,
    voice,
    language: scene.script.project.language,
    preferredProvider: runtime.settings.preferredTtsProvider ?? "auto",
    speed: 1,
    regenerate: runtime.job.id,
  });
  let asset = await runtime.ctx.db.mediaAsset.findUnique({ where: { cacheKey } });
  if (!asset || asset.status !== "READY") {
    const tts = await synthesizeWithFallback(
      runtime.ctx,
      runtime.job.userId,
      {
        text: scene.narration,
        voice,
        language: scene.script.project.language,
        speed: 1,
        format: "wav",
      },
      {
        preferredProvider: runtime.settings.preferredTtsProvider,
        localOnly: runtime.settings.localOnly,
        autoFallback: runtime.settings.autoFallback,
        signal: runtime.signal,
      },
    );
    const key = mediaKey(
      scene.script.projectId,
      "audio",
      `scene-${scene.sceneNumber}-${cacheKey.slice(0, 12)}.wav`,
    );
    asset = await storeAsset(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: scene.script.projectId,
      kind: "NARRATION",
      source: LOCAL_TTS.has(tts.provider) ? "LOCAL" : "OTHER",
      storageKey: key,
      data: tts.audio,
      mimeType: tts.mimeType,
      durationSeconds: tts.durationSeconds,
      provider: tts.provider,
      providerRequestId: tts.requestId,
      cacheKey,
      storage: runtime.storage,
    });
    await recordProviderUsage(runtime.ctx, {
      userId: runtime.job.userId,
      projectId: scene.script.projectId,
      jobId: runtime.job.id,
      provider: tts.provider,
      category: "TTS",
      units: scene.narration.length,
      unit: "character",
      providerRequestId: tts.requestId,
      usage: tts.usage,
      settings: runtime.settings,
    });
  }
  const audioDuration = asset.durationSeconds ?? scene.durationSeconds;
  const newDuration = Math.max(scene.durationSeconds, audioDuration + 0.25);
  await runtime.ctx.db.scene.update({
    where: { id: scene.id },
    data: {
      narrationAssetId: asset.id,
      durationSeconds: newDuration,
      status: "READY",
    },
  });
  await balanceSceneTimings(
    runtime,
    scene.scriptId,
    scene.script.targetDurationSeconds,
    scene.id,
  );
  return { sceneId, assetId: asset.id, audioDuration, durationSeconds: newDuration };
}

async function regenerateVisual(runtime: Runtime, sceneId: string) {
  const scene = await runtime.ctx.db.scene.findUnique({
    where: { id: sceneId },
    include: { script: { include: { project: true } } },
  });
  if (!scene || scene.script.project.userId !== runtime.job.userId) {
    throw new ValidationError("Target scene not found");
  }
  const { width, height } = outputDimensions(scene.script.project.resolution, false);
  const preferred =
    scene.visualType === "STOCK_IMAGE"
      ? "pexels"
      : scene.visualType === "AI_IMAGE"
        ? runtime.settings.preferredVisualProvider
        : scene.visualType === "AI_VIDEO"
          ? runtime.settings.preferredVisualProvider
          : "procedural";
  const prompt = `${scene.visualDescription}. Vertical 9:16 composition, ${scene.script.project.visualStyle} style, cinematic lighting, no embedded text.`;

  if (scene.visualType === "AI_VIDEO") {
    try {
    const videoPreferred = runtime.settings.preferredVideoProvider;
    if (
      videoPreferred &&
      videoPreferred !== "auto" &&
      videoPreferred !== "none" &&
      !runtime.settings.localOnly
    ) {
      const chain = await resolveProviderChain(
        runtime.ctx,
        runtime.job.userId,
        "TEXT_TO_VIDEO",
        videoPreferred,
      );
      const first = chain[0];
      if (first) {
        const model =
          typeof first.config.model === "string" ? first.config.model : undefined;
        await guardPaidCall(
          runtime.ctx,
          runtime.job.userId,
          first.provider,
          "TEXT_TO_VIDEO",
          model,
          "second",
          { duration: 5, aspect_ratio: "9:16" },
        );
        const video = await generateVideoWithFallback(
          runtime.ctx,
          runtime.job.userId,
          {
            prompt,
            durationSeconds: Math.min(5, scene.durationSeconds),
            aspectRatio: "9:16",
            width,
            height,
          },
          {
            preferredProvider: videoPreferred,
            localOnly: runtime.settings.localOnly,
            autoFallback: runtime.settings.autoFallback,
            signal: runtime.signal,
          },
        );
        const cacheKey = hashCacheKey({
          type: "ai-video",
          prompt,
          provider: video.provider,
          width,
          height,
          regenerate: runtime.job.id,
        });
        const key = mediaKey(
          scene.script.projectId,
          "visuals",
          `scene-${scene.sceneNumber}-regen-${cacheKey.slice(0, 12)}.mp4`,
        );
        const asset = await storeAsset(runtime.ctx, {
          userId: runtime.job.userId,
          projectId: scene.script.projectId,
          kind: "VIDEO",
          source: IMAGE_SOURCE[video.provider] ?? "OTHER",
          storageKey: key,
          data: video.video,
          mimeType: video.mimeType,
          durationSeconds: video.durationSeconds,
          attribution: video.attribution,
          provider: video.provider,
          providerModel: model,
          providerRequestId: video.requestId,
          cacheKey,
          metadata: { regenerated: true, aiVideo: true },
          storage: runtime.storage,
        });
        await runtime.ctx.db.scene.update({
          where: { id: scene.id },
          data: { visualAssetId: asset.id, status: "READY" },
        });
        await recordProviderUsage(runtime.ctx, {
          userId: runtime.job.userId,
          projectId: scene.script.projectId,
          jobId: runtime.job.id,
          provider: video.provider,
          category: "TEXT_TO_VIDEO",
          model,
          units: video.durationSeconds ?? Math.min(5, scene.durationSeconds),
          unit: "second",
          providerRequestId: video.requestId,
          usage: video.usage,
          settings: runtime.settings,
        });
        return { sceneId, assetId: asset.id, regeneration: "video" };
      }
    }
    } catch (error) {
      if (!runtime.settings.autoFallback) throw error;
      runtime.ctx.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "scene video regeneration failed; falling back to an image",
      );
    }
  }

  const chain = await resolveProviderChain(
    runtime.ctx,
    runtime.job.userId,
    "IMAGE",
    preferred,
    { localOnly: runtime.settings.localOnly },
  );
  const first = chain[0];
  if (first) {
    const model =
      typeof first.config.model === "string" ? first.config.model : undefined;
    await guardPaidCall(
      runtime.ctx,
      runtime.job.userId,
      first.provider,
      "IMAGE",
      model,
      "image",
    );
  }
  const image = await generateImageWithFallback(
    runtime.ctx,
    runtime.job.userId,
    {
      prompt,
      width,
      height,
      style: scene.script.project.visualStyle,
      seed: hashCacheKey({ sceneId: scene.id, jobId: runtime.job.id })
        .slice(0, 8)
        .split("")
        .reduce((sum, char) => sum + char.charCodeAt(0), 0),
    },
    {
      preferredProvider: preferred,
      localOnly: runtime.settings.localOnly,
      autoFallback: runtime.settings.autoFallback,
      signal: runtime.signal,
    },
  );
  const cacheKey = hashCacheKey({
    type: "image",
    prompt,
    width,
    height,
    preferredProvider: preferred ?? "auto",
    regenerate: runtime.job.id,
  });
  const extension = extensionForMime(image.mimeType);
  const key = mediaKey(
    scene.script.projectId,
    "visuals",
    `scene-${scene.sceneNumber}-regen-${cacheKey.slice(0, 12)}.${extension}`,
  );
  const asset = await storeAsset(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: scene.script.projectId,
    kind: "IMAGE",
    source: IMAGE_SOURCE[image.provider] ?? "OTHER",
    storageKey: key,
    data: image.image,
    mimeType: image.mimeType,
    width: image.width ?? width,
    height: image.height ?? height,
    attribution: image.attribution,
    provider: image.provider,
    providerModel:
      typeof image.resolvedProvider.config.model === "string"
        ? image.resolvedProvider.config.model
        : undefined,
    providerRequestId: image.requestId,
    cacheKey,
    metadata: { regenerated: true },
    storage: runtime.storage,
  });
  await runtime.ctx.db.scene.update({
    where: { id: scene.id },
    data: { visualAssetId: asset.id, status: "ASSETS_READY" },
  });
  await recordProviderUsage(runtime.ctx, {
    userId: runtime.job.userId,
    projectId: scene.script.projectId,
    jobId: runtime.job.id,
    provider: image.provider,
    category: "IMAGE",
    model:
      typeof image.resolvedProvider.config.model === "string"
        ? image.resolvedProvider.config.model
        : undefined,
    units: 1,
    unit: "image",
    providerRequestId: image.requestId,
    usage: image.usage,
    settings: runtime.settings,
  });
  return { sceneId, assetId: asset.id, regeneration: "image" };
}

async function balanceSceneTimings(
  runtime: Runtime,
  scriptId: string,
  targetDuration: number,
  changedSceneId: string,
) {
  const scenes = await runtime.ctx.db.scene.findMany({
    where: { scriptId },
    orderBy: { orderIndex: "asc" },
  });
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const delta = targetDuration - total;
  if (Math.abs(delta) > 0.02) {
    const adjustable = [...scenes]
      .reverse()
      .find((scene) => scene.id !== changedSceneId);
    if (adjustable) {
      const nextDuration = Math.max(1, adjustable.durationSeconds + delta);
      await runtime.ctx.db.scene.update({
        where: { id: adjustable.id },
        data: { durationSeconds: nextDuration },
      });
    }
  }
  const updated = await runtime.ctx.db.scene.findMany({
    where: { scriptId },
    orderBy: { orderIndex: "asc" },
  });
  let cursor = 0;
  for (const scene of updated) {
    await runtime.ctx.db.scene.update({
      where: { id: scene.id },
      data: { startSeconds: cursor, endSeconds: cursor + scene.durationSeconds },
    });
    cursor += scene.durationSeconds;
  }
}

async function requireLatestScript(runtime: Runtime) {
  const script = await runtime.ctx.db.script.findFirst({
    where: { projectId: runtime.project.id },
    orderBy: { version: "desc" },
    include: { scenes: { orderBy: { orderIndex: "asc" } } },
  });
  if (!script) throw new ValidationError("No script is available");
  return script as Script & { scenes: Scene[] };
}

function outputDimensions(
  resolution: string,
  preview: boolean,
): { width: number; height: number } {
  if (preview) return { width: 540, height: 960 };
  return resolution === "720p"
    ? { width: 720, height: 1280 }
    : { width: 1080, height: 1920 };
}

async function finalizeSuccess(runtime: Runtime) {
  const usage = await runtime.ctx.db.usageRecord.aggregate({
    where: { jobId: runtime.job.id, costType: "ACTUAL" },
    _sum: { actualCostInrPaise: true },
  });
  const actualCost = usage._sum.actualCostInrPaise ?? 0;
  await runtime.ctx.db.generationJob.update({
    where: { id: runtime.job.id },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      completedAt: new Date(),
      actualCostInrPaise: actualCost,
      errorCode: null,
      errorClass: null,
      errorMessage: null,
    },
  });
  const projectUsage = await runtime.ctx.db.usageRecord.aggregate({
    where: { projectId: runtime.project.id, costType: "ACTUAL" },
    _sum: { actualCostInrPaise: true },
  });
  const projectStatus =
    runtime.job.kind === "RENDER" && runtime.renderKind === "PREVIEW"
      ? runtime.project.status
      : "COMPLETED";
  await runtime.ctx.db.project.update({
    where: { id: runtime.project.id },
    data: {
      status: projectStatus,
      actualCostInrPaise: projectUsage._sum.actualCostInrPaise ?? 0,
    },
  });
  await runtime.ctx.db.notification.create({
    data: {
      userId: runtime.job.userId,
      type: "GENERATION_SUCCEEDED",
      title:
        runtime.job.kind === "GENERATE"
          ? "Reel generated"
          : runtime.job.kind === "RENDER"
            ? "Render completed"
            : "Scene regenerated",
      body: runtime.project.title,
      link: `/studio/${runtime.project.id}`,
    },
  });
}

async function handleFailure(ctx: Context, job: LoadedJob, error: unknown) {
  const current = await ctx.db.generationJob.findUnique({
    where: { id: job.id },
    select: { cancelRequested: true },
  });
  const cancelled = error instanceof CancelledError || current?.cancelRequested;
  const code =
    error instanceof AppError
      ? error.code
      : cancelled
        ? "JOB_CANCELLED"
        : "UNEXPECTED_ERROR";
  const errorClass =
    error instanceof AppError ? error.kind : cancelled ? "CANCELLED" : "INTERNAL";
  const message =
    error instanceof Error ? error.message.slice(0, 2000) : String(error);

  await ctx.db.generationJob.update({
    where: { id: job.id },
    data: {
      status: cancelled ? "CANCELLED" : "FAILED",
      completedAt: new Date(),
      errorCode: code,
      errorClass,
      errorMessage: message,
    },
  });
  await ctx.db.project.update({
    where: { id: job.projectId },
    data: {
      status: cancelled
        ? job.project.status === "QUEUED"
          ? "DRAFT"
          : job.project.status
        : job.kind === "GENERATE"
          ? "FAILED"
          : job.project.status,
    },
  });
  await ctx.db.notification.create({
    data: {
      userId: job.userId,
      type: cancelled ? "GENERATION_CANCELLED" : "GENERATION_FAILED",
      title: cancelled ? "Generation cancelled" : "Generation failed",
      body: message,
      link: `/projects/${job.projectId}`,
    },
  });

  if (error instanceof AppError && error.retryable) {
    throw error;
  }
}
