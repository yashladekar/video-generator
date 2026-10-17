import sharp from "sharp";

import { ProviderError } from "../../lib/errors";
import { fetchBuffer, fetchJson, joinUrl } from "../http";
import {
  asTemplate,
  findFirstUrl,
  sleepWithSignal,
  substituteTemplate,
} from "../media-helpers";
import { configString } from "../resolve";
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  ImageProvider,
  ProviderCallContext,
  ResolvedProvider,
  VideoGenerateInput,
  VideoGenerateOutput,
  VideoProvider,
} from "../types";

type ComfyPromptResponse = {
  prompt_id?: string;
  error?: unknown;
  node_errors?: unknown;
};

type ComfyHistoryEntry = {
  outputs?: Record<
    string,
    {
      images?: Array<{ filename: string; subfolder?: string; type?: string }>;
      gifs?: Array<{ filename: string; subfolder?: string; type?: string }>;
      videos?: Array<{ filename: string; subfolder?: string; type?: string }>;
    }
  >;
  status?: { completed?: boolean; status_str?: string };
};

type ComfyHistoryResponse = Record<string, ComfyHistoryEntry | undefined>;

function workflowFor(
  resolved: ResolvedProvider,
  values: Record<string, string | number>,
): Record<string, unknown> | null {
  const value = resolved.config.workflow;
  let workflow: Record<string, unknown> | null = null;
  if (typeof value === "string") {
    try {
      workflow = asTemplate(JSON.parse(value));
    } catch {
      return null;
    }
  } else if (value) {
    workflow = asTemplate(value);
  }
  if (!workflow) return null;
  return substituteTemplate(workflow, values) as Record<string, unknown>;
}

async function runWorkflow(
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
  values: Record<string, string | number>,
  kind: "image" | "video",
): Promise<{ buffer: Buffer; mimeType: string }> {
  const baseUrl = configString(
    resolved,
    "baseUrl",
    ctx.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
  )!;
  const workflow = workflowFor(resolved, values);
  if (!workflow) {
    throw new ProviderError(
      "COMFYUI_WORKFLOW_MISSING",
      "ComfyUI requires a workflow JSON template in provider settings",
      { provider: "comfyui", kind: "PROVIDER_PERMANENT" },
    );
  }
  const clientId = `video-generator-${ctx.userId}`;
  const submit = await fetchJson<ComfyPromptResponse>(
    joinUrl(baseUrl, "prompt"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    },
    { provider: "comfyui", signal: ctx.signal, timeoutMs: 60_000 },
  );
  const promptId = submit.data.prompt_id;
  if (!promptId) {
    throw new ProviderError(
      "COMFYUI_SUBMIT_FAILED",
      "ComfyUI did not return a prompt id",
      { provider: "comfyui", details: submit.data },
    );
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleepWithSignal(2000, ctx.signal);
    const history = await fetchJson<ComfyHistoryResponse>(
      joinUrl(baseUrl, `history/${promptId}`),
      {},
      { provider: "comfyui", signal: ctx.signal, timeoutMs: 45_000 },
    );
    const entry = history.data[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      throw new ProviderError(
        "COMFYUI_GENERATION_FAILED",
        "ComfyUI workflow failed",
        { provider: "comfyui" },
      );
    }
    const outputs = entry.outputs ?? {};
    for (const node of Object.values(outputs)) {
      const candidates =
        kind === "image"
          ? node.images ?? []
          : node.videos ?? node.gifs ?? node.images ?? [];
      const first = candidates[0];
      if (first) {
        const url = new URL(joinUrl(baseUrl, "view"));
        url.searchParams.set("filename", first.filename);
        if (first.subfolder) url.searchParams.set("subfolder", first.subfolder);
        url.searchParams.set("type", first.type ?? "output");
        const file = await fetchBuffer(
          url.toString(),
          {},
          {
            provider: "comfyui",
            signal: ctx.signal,
            timeoutMs: 120_000,
            maxBytes: 250 * 1024 * 1024,
          },
        );
        return { buffer: file.data, mimeType: file.mimeType };
      }
    }
  }
  throw new ProviderError(
    "COMFYUI_TIMEOUT",
    "ComfyUI workflow timed out",
    { provider: "comfyui", kind: "PROVIDER_TRANSIENT" },
  );
}

export const comfyUiImageProvider: ImageProvider = {
  provider: "comfyui",
  async generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput> {
    const seed = input.seed ?? 42;
    const result = await runWorkflow(
      resolved,
      ctx,
      {
        prompt: input.prompt,
        width: input.width,
        height: input.height,
        seed,
      },
      "image",
    );
    const image = await sharp(result.buffer)
      .resize(input.width, input.height, { fit: "cover" })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      image,
      mimeType: "image/jpeg",
      width: input.width,
      height: input.height,
      provider: "comfyui",
      usage: {
        unit: "image",
        inputUnits: 1,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};

export const comfyUiVideoProvider: VideoProvider = {
  provider: "comfyui",
  async generateVideo(
    input: VideoGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<VideoGenerateOutput> {
    const result = await runWorkflow(
      resolved,
      ctx,
      {
        prompt: input.prompt,
        width: input.width,
        height: input.height,
        duration: input.durationSeconds,
        aspect_ratio: input.aspectRatio,
      },
      "video",
    );
    return {
      video: result.buffer,
      mimeType: result.mimeType.includes("video")
        ? result.mimeType
        : "video/mp4",
      durationSeconds: input.durationSeconds,
      provider: "comfyui",
      usage: {
        unit: "second",
        outputUnits: input.durationSeconds,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};

export async function testComfyUi(
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = configString(
    resolved,
    "baseUrl",
    ctx.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
  )!;
  try {
    await fetchJson<Record<string, unknown>>(
      joinUrl(baseUrl, "system_stats"),
      {},
      { provider: "comfyui", signal: ctx.signal, timeoutMs: 10_000 },
    );
    return { ok: true, message: "ComfyUI is reachable" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "ComfyUI is unreachable",
    };
  }
}

export function extractComfyUrl(value: unknown): string | undefined {
  return findFirstUrl(value);
}
