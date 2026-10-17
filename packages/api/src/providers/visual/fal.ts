import { ProviderError } from "../../lib/errors";
import { fetchJson, joinUrl } from "../http";
import {
  asTemplate,
  downloadImage,
  downloadVideo,
  findFirstUrl,
  sleepWithSignal,
  substituteTemplate,
} from "../media-helpers";
import { configString, secretValue } from "../resolve";
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

type FalSubmitResponse = {
  request_id?: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
  queue_position?: number;
};

type FalStatusResponse = {
  status?: string;
  request_id?: string;
  response_url?: string;
  queue_position?: number;
  logs?: Array<{ message?: string }>;
  error?: string;
  error_type?: string;
};

type FalResultResponse = Record<string, unknown>;

function requireKey(resolved: ResolvedProvider, ctx: ProviderCallContext): string {
  const apiKey = secretValue(resolved, "apiKey", ctx.env.FAL_KEY);
  if (!apiKey) {
    throw new ProviderError("PROVIDER_AUTH", "No fal.ai API key configured", {
      provider: "fal",
      kind: "PROVIDER_PERMANENT",
    });
  }
  return apiKey;
}

function inputFor(
  input: ImageGenerateInput | VideoGenerateInput,
  resolved: ResolvedProvider,
): Record<string, unknown> {
  const templateValue = resolved.config.inputTemplate;
  let template: Record<string, unknown> | null = null;
  if (typeof templateValue === "string") {
    try {
      template = asTemplate(JSON.parse(templateValue));
    } catch {
      template = null;
    }
  } else if (templateValue) {
    template = asTemplate(templateValue);
  }
  const values: Record<string, string | number> = {
    prompt: input.prompt,
    width: input.width,
    height: input.height,
    aspect_ratio: "aspectRatio" in input ? input.aspectRatio : "9:16",
  };
  if ("durationSeconds" in input) {
    values.duration = input.durationSeconds;
    values.duration_seconds = input.durationSeconds;
  }
  return template
    ? (substituteTemplate(template, values) as Record<string, unknown>)
    : { prompt: input.prompt };
}

async function submitAndPoll(
  model: string,
  body: Record<string, unknown>,
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
  timeoutMs = 10 * 60 * 1000,
): Promise<{ result: FalResultResponse; requestId: string }> {
  const apiKey = requireKey(resolved, ctx);
  const baseUrl = configString(resolved, "baseUrl", "https://queue.fal.run")!;
  const submitUrl = joinUrl(baseUrl, model);
  const submit = await fetchJson<FalSubmitResponse>(
    submitUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    {
      provider: "fal",
      signal: ctx.signal,
      timeoutMs: 120_000,
      requestIdHeader: "x-fal-request-id",
    },
  );
  const requestId = submit.data.request_id;
  if (!requestId) {
    throw new ProviderError(
      "FAL_NO_REQUEST_ID",
      "fal.ai did not return a request id",
      {
        provider: "fal",
        kind: "PROVIDER_UNKNOWN_OUTCOME",
        details: submit.data,
      },
    );
  }
  const statusUrl =
    submit.data.status_url ??
    joinUrl(baseUrl, `${model}/requests/${requestId}/status`);
  const responseUrl =
    submit.data.response_url ??
    joinUrl(baseUrl, `${model}/requests/${requestId}`);

  const deadline = Date.now() + timeoutMs;
  let delay = 2000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    let status: FalStatusResponse | null = null;
    try {
      const response = await fetchJson<FalStatusResponse>(
        `${statusUrl}?logs=1`,
        { headers: { Authorization: `Key ${apiKey}` } },
        { provider: "fal", signal: ctx.signal, timeoutMs: 45_000 },
      );
      status = response.data;
    } catch (error) {
      lastError = error;
      if (
        error instanceof ProviderError &&
        error.status &&
        error.status !== 429 &&
        error.status < 500
      ) {
        throw error;
      }
    }

    if (status?.status === "COMPLETED") {
      if (status.error) {
        throw new ProviderError(
          "FAL_GENERATION_FAILED",
          status.error,
          { provider: "fal", requestId, kind: "PROVIDER_PERMANENT" },
        );
      }
      const result = await fetchJson<FalResultResponse>(
        responseUrl,
        { headers: { Authorization: `Key ${apiKey}` } },
        { provider: "fal", signal: ctx.signal, timeoutMs: 120_000 },
      );
      return { result: result.data, requestId };
    }

    await sleepWithSignal(delay, ctx.signal);
    delay = Math.min(15_000, Math.round(delay * 1.5));
  }

  throw new ProviderError(
    "FAL_TIMEOUT",
    "fal.ai generation timed out; the request may still complete",
    {
      provider: "fal",
      requestId,
      kind: "PROVIDER_UNKNOWN_OUTCOME",
      cause: lastError,
    },
  );
}

export const falImageProvider: ImageProvider = {
  provider: "fal",
  async generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput> {
    const model =
      input.model ??
      configString(resolved, "model", "fal-ai/flux/schnell")!;
    const { result, requestId } = await submitAndPoll(
      model,
      inputFor(input, resolved),
      resolved,
      ctx,
    );
    const images = result.images;
    const firstImage =
      Array.isArray(images) && images[0] && typeof images[0] === "object"
        ? (images[0] as { url?: string }).url
        : undefined;
    const imageUrl =
      firstImage ??
      (typeof result.image === "object" && result.image
        ? (result.image as { url?: string }).url
        : undefined) ??
      findFirstUrl(result);
    if (!imageUrl) {
      throw new ProviderError(
        "FAL_NO_OUTPUT",
        "fal.ai returned no image URL",
        { provider: "fal", requestId },
      );
    }
    const image = await downloadImage(imageUrl, input.width, input.height, ctx, "fal");
    return {
      image,
      mimeType: "image/jpeg",
      width: input.width,
      height: input.height,
      requestId,
      provider: "fal",
      usage: { unit: "image", inputUnits: 1, metadata: { model } },
    };
  },
};

export const falVideoProvider: VideoProvider = {
  provider: "fal",
  async generateVideo(
    input: VideoGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<VideoGenerateOutput> {
    const model =
      input.model ??
      configString(
        resolved,
        "model",
        "fal-ai/wan/v2.2-5b/text-to-video",
      )!;
    const { result, requestId } = await submitAndPoll(
      model,
      inputFor(input, resolved),
      resolved,
      ctx,
    );
    const videoUrl =
      (typeof result.video === "object" && result.video
        ? (result.video as { url?: string }).url
        : undefined) ??
      (typeof result.video_url === "string" ? result.video_url : undefined) ??
      findFirstUrl(result);
    if (!videoUrl) {
      throw new ProviderError(
        "FAL_NO_OUTPUT",
        "fal.ai returned no video URL",
        { provider: "fal", requestId },
      );
    }
    const video = await downloadVideo(videoUrl, ctx, "fal");
    return {
      video: video.video,
      mimeType: video.mimeType,
      durationSeconds: input.durationSeconds,
      requestId,
      provider: "fal",
      usage: {
        unit: "second",
        outputUnits: input.durationSeconds,
        metadata: { model },
      },
    };
  },
};

export async function getFalRequestStatus(
  model: string,
  requestId: string,
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
): Promise<{ status: string; result?: FalResultResponse }> {
  const apiKey = requireKey(resolved, ctx);
  const baseUrl = configString(resolved, "baseUrl", "https://queue.fal.run")!;
  const status = await fetchJson<FalStatusResponse>(
    joinUrl(baseUrl, `${model}/requests/${requestId}/status`),
    { headers: { Authorization: `Key ${apiKey}` } },
    { provider: "fal", signal: ctx.signal, timeoutMs: 45_000 },
  );
  if (status.data.status !== "COMPLETED") {
    return { status: status.data.status ?? "UNKNOWN" };
  }
  const result = await fetchJson<FalResultResponse>(
    joinUrl(baseUrl, `${model}/requests/${requestId}`),
    { headers: { Authorization: `Key ${apiKey}` } },
    { provider: "fal", signal: ctx.signal, timeoutMs: 60_000 },
  );
  return { status: "COMPLETED", result: result.data };
}
