import type { StepType } from "@video-generator/db";

import type { Context } from "../context";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import type {
  GenerationOverrides,
  StartGenerationInput,
} from "../schemas/generation";
import {
  assertCanStartGeneration,
  ensureUserSettings,
  getBudgetStatus,
  getDailyUsage,
} from "./budget";
import { latestStepsByType } from "../pipeline/checkpoint";
import { estimateGenerationCost } from "./pricing";
import { requireProject } from "./projects";

const GENERATE_STEPS: StepType[] = [
  "VALIDATE",
  "RESEARCH",
  "SCRIPT",
  "SCENES",
  "NARRATION",
  "VISUALS",
  "AI_VIDEO",
  "SUBTITLES",
  "MUSIC",
  "RENDER",
  "VALIDATE_OUTPUT",
  "FINALIZE",
];

const RENDER_STEPS: StepType[] = [
  "RENDER",
  "VALIDATE_OUTPUT",
  "FINALIZE",
];

const REGENERATE_STEPS: StepType[] = [
  "NARRATION",
  "VISUALS",
  "SUBTITLES",
  "RENDER",
  "VALIDATE_OUTPUT",
  "FINALIZE",
];

function stepsForKind(kind: string): StepType[] {
  if (kind === "RENDER") return RENDER_STEPS;
  if (kind === "REGENERATE_SCENE") return REGENERATE_STEPS;
  return GENERATE_STEPS;
}

export async function effectiveSettings(
  ctx: Context,
  userId: string,
  overrides?: GenerationOverrides,
) {
  const settings = await ensureUserSettings(ctx, userId);
  return {
    ...settings,
    ...(overrides?.localOnly !== undefined
      ? { localOnly: overrides.localOnly }
      : {}),
    ...(overrides?.autoFallback !== undefined
      ? { autoFallback: overrides.autoFallback }
      : {}),
    ...(overrides?.maxHostedVideoCalls !== undefined
      ? { maxHostedVideoCalls: overrides.maxHostedVideoCalls }
      : {}),
    ...(overrides?.maxRetries !== undefined
      ? { maxRetries: overrides.maxRetries }
      : {}),
    ...(overrides?.preferredLlmProvider !== undefined
      ? { preferredLlmProvider: overrides.preferredLlmProvider }
      : {}),
    ...(overrides?.preferredTtsProvider !== undefined
      ? { preferredTtsProvider: overrides.preferredTtsProvider }
      : {}),
    ...(overrides?.preferredVisualProvider !== undefined
      ? { preferredVisualProvider: overrides.preferredVisualProvider }
      : {}),
    ...(overrides?.preferredVideoProvider !== undefined
      ? { preferredVideoProvider: overrides.preferredVideoProvider }
      : {}),
  };
}

export async function estimateForProject(
  ctx: Context,
  userId: string,
  projectId: string,
  overrides?: GenerationOverrides,
) {
  const project = await requireProject(ctx, userId, projectId);
  const brief = await ctx.db.contentBrief.findUnique({
    where: { projectId },
  });
  const settings = await effectiveSettings(ctx, userId, overrides);
  const targetDurationSeconds =
    overrides?.targetDurationSeconds ?? project.durationSeconds;
  const estimate = await estimateGenerationCost(ctx, userId, settings, {
    targetDurationSeconds,
    visualStyle: project.visualStyle,
  });
  const budget = await getBudgetStatus(ctx, userId);
  const daily = await getDailyUsage(ctx, userId);
  return {
    project,
    brief,
    settings,
    estimate,
    budget: {
      amountInrPaise: budget.amountInrPaise,
      spentInrPaise: budget.spentInrPaise,
      reservedInrPaise: budget.reservedInrPaise,
      availableInrPaise: budget.availableInrPaise,
      retryReserveInrPaise: budget.retryReserveInrPaise,
      spendableInrPaise: budget.spendableInrPaise,
    },
    daily,
    fitsBudget:
      !estimate.unknownPricing &&
      estimate.estimatedCostInrPaise <= settings.maxCostPerVideoInrPaise &&
      estimate.estimatedCostInrPaise <= budget.spendableInrPaise &&
      daily.remaining > 0,
  };
}

async function createSteps(
  ctx: Context,
  jobId: string,
  kind: string,
  options?: { fromStep?: StepType },
) {
  const allSteps = stepsForKind(kind);
  const fromIndex = options?.fromStep
    ? allSteps.indexOf(options.fromStep)
    : 0;
  const steps = allSteps.filter((_, index) => index >= fromIndex);
  const existing = await ctx.db.generationStep.findMany({
    where: { jobId },
    select: { type: true, attempt: true },
  });
  const maxAttemptByType = new Map<string, number>();
  for (const step of existing) {
    maxAttemptByType.set(
      step.type,
      Math.max(maxAttemptByType.get(step.type) ?? 0, step.attempt),
    );
  }
  await ctx.db.generationStep.createMany({
    data: steps.map((type) => ({
      jobId,
      type,
      attempt: (maxAttemptByType.get(type) ?? 0) + 1,
      status: "PENDING",
      orderIndex: allSteps.indexOf(type),
    })),
  });
}

export async function startGeneration(
  ctx: Context,
  userId: string,
  input: StartGenerationInput,
) {
  const existing = await ctx.db.generationJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { project: true },
  });
  if (existing) return existing;

  const preflight = await estimateForProject(
    ctx,
    userId,
    input.projectId,
    input.overrides,
  );
  await assertCanStartGeneration(ctx, userId, preflight.estimate);

  const project = preflight.project;
  const settings = preflight.settings;
  const targetDurationSeconds =
    input.overrides?.targetDurationSeconds ?? project.durationSeconds;
  const researchEnabled =
    input.overrides?.researchEnabled ??
    preflight.brief?.researchEnabled ??
    false;

  const job = await ctx.db.$transaction(async (tx) => {
    const created = await tx.generationJob.create({
      data: {
        projectId: project.id,
        userId,
        kind: "GENERATE",
        status: "QUEUED",
        progress: 0,
        maxAttempts: settings.maxRetries + 1,
        idempotencyKey: input.idempotencyKey,
        estimatedCostInrPaise: preflight.estimate.estimatedCostInrPaise,
        metadata: {
          estimate: preflight.estimate,
          overrides: input.overrides ?? {},
          targetDurationSeconds,
          researchEnabled,
          settings: {
            localOnly: settings.localOnly,
            autoFallback: settings.autoFallback,
            maxHostedVideoCalls: settings.maxHostedVideoCalls,
            maxRetries: settings.maxRetries,
            preferredLlmProvider: settings.preferredLlmProvider,
            preferredTtsProvider: settings.preferredTtsProvider,
            preferredVisualProvider: settings.preferredVisualProvider,
            preferredVideoProvider: settings.preferredVideoProvider,
          },
        },
      },
    });
    await tx.generationStep.createMany({
      data: GENERATE_STEPS.map((type, index) => ({
        jobId: created.id,
        type,
        attempt: 1,
        status: "PENDING" as const,
        orderIndex: index,
      })),
    });
    await tx.project.update({
      where: { id: project.id },
      data: {
        status: "QUEUED",
        estimatedCostInrPaise: preflight.estimate.estimatedCostInrPaise,
      },
    });
    return created;
  });

  try {
    const enqueued = await ctx.dispatcher.enqueueGeneration(job.id, {
      attempts: job.maxAttempts,
    });
    if (enqueued.bullJobId) {
      await ctx.db.generationJob.update({
        where: { id: job.id },
        data: { bullJobId: enqueued.bullJobId },
      });
    }
  } catch (error) {
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "QUEUE_FAILED",
        errorClass: "INTERNAL",
        errorMessage:
          error instanceof Error ? error.message : "Could not enqueue job",
        completedAt: new Date(),
      },
    });
    await ctx.db.project.update({
      where: { id: project.id },
      data: { status: "FAILED" },
    });
    throw error;
  }

  return ctx.db.generationJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { project: true },
  });
}

export async function getJob(ctx: Context, userId: string, jobId: string) {
  const job = await ctx.db.generationJob.findFirst({
    where: { id: jobId, userId },
    include: {
      project: { select: { id: true, title: true, status: true } },
      steps: { orderBy: [{ orderIndex: "asc" }, { attempt: "desc" }] },
      usageRecords: { orderBy: { createdAt: "desc" }, take: 50 },
      renderedVideos: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { videoAsset: true, thumbnailAsset: true },
      },
    },
  });
  if (!job) throw new NotFoundError("Generation job not found");
  const latest = latestStepsByType(job.steps);
  return {
    ...job,
    steps: [...latest.values()].sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

export async function listJobs(
  ctx: Context,
  userId: string,
  input?: { projectId?: string; limit?: number },
) {
  return ctx.db.generationJob.findMany({
    where: {
      userId,
      ...(input?.projectId ? { projectId: input.projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input?.limit ?? 10,
    include: {
      project: { select: { id: true, title: true } },
    },
  });
}

export async function cancelJob(
  ctx: Context,
  userId: string,
  jobId: string,
) {
  const job = await ctx.db.generationJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) throw new NotFoundError("Generation job not found");
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) return job;

  await ctx.db.generationJob.update({
    where: { id: job.id },
    data: { cancelRequested: true },
  });

  if (job.status === "QUEUED") {
    if (job.bullJobId) {
      await ctx.dispatcher
        .cancelQueued("generation", job.bullJobId)
        .catch(() => undefined);
    }
    return ctx.db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        errorCode: "JOB_CANCELLED",
        errorClass: "CANCELLED",
        errorMessage: "Cancelled before processing",
      },
    });
  }

  return ctx.db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
}

export async function retryJob(
  ctx: Context,
  userId: string,
  jobId: string,
  fromStep?: StepType,
) {
  const job = await ctx.db.generationJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) throw new NotFoundError("Generation job not found");
  if (!["FAILED", "CANCELLED"].includes(job.status)) {
    throw new ValidationError(
      "Only failed or cancelled jobs can be retried",
    );
  }
  const updated = await ctx.db.generationJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      progress: 0,
      currentStep: null,
      errorCode: null,
      errorClass: null,
      errorMessage: null,
      cancelRequested: false,
      attempt: 0,
      completedAt: null,
    },
  });
  await createSteps(ctx, job.id, job.kind, { fromStep });
  const enqueued = await ctx.dispatcher.enqueueGeneration(job.id, {
    attempts: job.maxAttempts,
  });
  if (enqueued.bullJobId) {
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: { bullJobId: enqueued.bullJobId },
    });
  }
  return ctx.db.generationJob.findUniqueOrThrow({ where: { id: updated.id } });
}

export async function startRenderJob(
  ctx: Context,
  userId: string,
  input: {
    projectId: string;
    kind: "PREVIEW" | "FINAL";
    idempotencyKey: string;
  },
) {
  const existing = await ctx.db.generationJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  const project = await requireProject(ctx, userId, input.projectId);
  const script = await ctx.db.script.findFirst({
    where: { projectId: project.id },
    orderBy: { version: "desc" },
    include: { scenes: true },
  });
  if (!script) {
    throw new ValidationError("Generate a script before rendering");
  }

  const active = await ctx.db.generationJob.count({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active > 0) {
    throw new AppError(
      "VALIDATION",
      "JOB_IN_PROGRESS",
      "Another job is already running. Wait for it to finish first.",
    );
  }

  const job = await ctx.db.$transaction(async (tx) => {
    const created = await tx.generationJob.create({
      data: {
        projectId: project.id,
        userId,
        scriptId: script.id,
        kind: "RENDER",
        status: "QUEUED",
        maxAttempts: 2,
        idempotencyKey: input.idempotencyKey,
        estimatedCostInrPaise: 0,
        metadata: { renderKind: input.kind },
      },
    });
    await tx.generationStep.createMany({
      data: RENDER_STEPS.map((type, index) => ({
        jobId: created.id,
        type,
        attempt: 1,
        status: "PENDING" as const,
        orderIndex: index,
      })),
    });
    return created;
  });

  const enqueued = await ctx.dispatcher.enqueueGeneration(job.id, {
    attempts: 2,
  });
  if (enqueued.bullJobId) {
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: { bullJobId: enqueued.bullJobId },
    });
  }
  return job;
}

export async function createRegenerateSceneJob(
  ctx: Context,
  userId: string,
  input: {
    sceneId: string;
    parts: string[];
    idempotencyKey: string;
  },
) {
  const existing = await ctx.db.generationJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;

  const scene = await ctx.db.scene.findFirst({
    where: { id: input.sceneId },
    include: { script: { include: { project: true } } },
  });
  if (!scene || scene.script.project.userId !== userId) {
    throw new NotFoundError("Scene not found");
  }
  const project = scene.script.project;
  const active = await ctx.db.generationJob.count({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active > 0) {
    throw new AppError(
      "VALIDATION",
      "JOB_IN_PROGRESS",
      "Another job is already running. Wait for it to finish first.",
    );
  }

  const job = await ctx.db.$transaction(async (tx) => {
    const created = await tx.generationJob.create({
      data: {
        projectId: project.id,
        userId,
        scriptId: scene.scriptId,
        kind: "REGENERATE_SCENE",
        targetSceneId: scene.id,
        status: "QUEUED",
        maxAttempts: 2,
        idempotencyKey: input.idempotencyKey,
        estimatedCostInrPaise: 0,
        metadata: { parts: input.parts },
      },
    });
    await tx.generationStep.createMany({
      data: REGENERATE_STEPS.map((type, index) => ({
        jobId: created.id,
        type,
        attempt: 1,
        status: "PENDING" as const,
        orderIndex: index,
      })),
    });
    return created;
  });

  const enqueued = await ctx.dispatcher.enqueueGeneration(job.id, {
    attempts: 2,
  });
  if (enqueued.bullJobId) {
    await ctx.db.generationJob.update({
      where: { id: job.id },
      data: { bullJobId: enqueued.bullJobId },
    });
  }
  return job;
}
