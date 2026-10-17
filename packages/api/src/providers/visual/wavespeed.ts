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

type WaveSpeedSubmitResponse = {
  code?: number;
  message?: string;
  data?: {
    id?: string;
    status?: string;
    urls?: { get?: string };
  };
};

type WaveSpeedResultResponse = {
  code?: number;
  message?: string;
  data?: {
    id?: string;
    status?: string;
    outputs?: unknown;
    output?: unknown;
    error?: string;
  };
};

function requireKey(resolved: ResolvedProvider, ctx: ProviderCallContext): string {
  const apiKey = secretValue(resolved, "apiKey", ctx.env.WAVESPEED_API_KEY);
  if (!apiKey) {
    throw new ProviderError(
      "PROVIDER_AUTH",
      "No WaveSpeedAI API key configured",
      { provider: "wavespeed", kind: "PROVIDER_PERMANENT" },
    );
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
  timeoutMs = 12 * 60 * 1000,
): Promise<{ outputs: unknown; requestId: string }> {
  const apiKey = requireKey(resolved, ctx);
  const baseUrl = configString(
    resolved,
    "baseUrl",
    "https://api.wavespeed.ai/api/v3",
  )!;
  let submit: WaveSpeedSubmitResponse;
  try {
    const response = await fetchJson<WaveSpeedSubmitResponse>(
      joinUrl(baseUrl, model),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      {
        provider: "wavespeed",
        signal: ctx.signal,
        timeoutMs: 120_000,
        requestIdHeader: "x-request-id",
      },
    );
    submit = response.data;
  } catch (error) {
    if (
      error instanceof ProviderError &&
      error.status !== undefined &&
      error.status >= 500
    ) {
      throw new ProviderError(
        "WAVESPEED_UNKNOWN_OUTCOME",
        "WaveSpeedAI submission failed after it may have been accepted. Check the provider dashboard before retrying.",
        {
          provider: "wavespeed",
          status: error.status,
          kind: "PROVIDER_UNKNOWN_OUTCOME",
          cause: error,
        },
      );
    }
    throw error;
  }

  if (submit.code !== undefined && submit.code !== 200) {
    throw new ProviderError(
      "WAVESPEED_SUBMIT_FAILED",
      submit.message ?? `WaveSpeedAI submit failed with code ${submit.code}`,
      { provider: "wavespeed", kind: "PROVIDER_PERMANENT" },
    );
  }
  const requestId = submit.data?.id;
  if (!requestId) {
    throw new ProviderError(
      "WAVESPEED_NO_REQUEST_ID",
      "WaveSpeedAI did not return a task id; the request may still have been accepted.",
      {
        provider: "wavespeed",
        kind: "PROVIDER_UNKNOWN_OUTCOME",
        details: submit,
      },
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleepWithSignal(2000, ctx.signal);
    let response: WaveSpeedResultResponse | null = null;
    try {
      const result = await fetchJson<WaveSpeedResultResponse>(
        joinUrl(baseUrl, `predictions/${requestId}/result`),
        { headers: { Authorization: `Bearer ${apiKey}` } },
        { provider: "wavespeed", signal: ctx.signal, timeoutMs: 45_000 },
      );
      response = result.data;
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.status &&
        error.status !== 429 &&
        error.status < 500
      ) {
        throw error;
      }
    }

    const status = response?.data?.status;
    if (status === "completed") {
      return {
        outputs: response?.data?.outputs ?? response?.data?.output,
        requestId,
      };
    }
    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "timeout" ||
      status === "deleted"
    ) {
      throw new ProviderError(
        "WAVESPEED_GENERATION_FAILED",
        response?.data?.error ?? `WaveSpeedAI task ${status}`,
        { provider: "wavespeed", requestId, kind: "PROVIDER_PERMANENT" },
      );
    }
  }

  throw new ProviderError(
    "WAVESPEED_TIMEOUT",
    "WaveSpeedAI generation timed out; the task may still complete",
    {
      provider: "wavespeed",
      requestId,
      kind: "PROVIDER_UNKNOWN_OUTCOME",
    },
  );
}

export const waveSpeedImageProvider: ImageProvider = {
  provider: "wavespeed",
  async generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput> {
    const model =
      input.model ??
      configString(resolved, "model", "wavespeed-ai/z-image/turbo")!;
    const { outputs, requestId } = await submitAndPoll(
      model,
      inputFor(input, resolved),
      resolved,
      ctx,
    );
    const imageUrl = findFirstUrl(outputs);
    if (!imageUrl) {
      throw new ProviderError(
        "WAVESPEED_NO_OUTPUT",
        "WaveSpeedAI returned no image URL",
        { provider: "wavespeed", requestId },
      );
    }
    const image = await downloadImage(
      imageUrl,
      input.width,
      input.height,
      ctx,
      "wavespeed",
    );
    return {
      image,
      mimeType: "image/jpeg",
      width: input.width,
      height: input.height,
      requestId,
      provider: "wavespeed",
      usage: { unit: "image", inputUnits: 1, metadata: { model } },
    };
  },
};

export const waveSpeedVideoProvider: VideoProvider = {
  provider: "wavespeed",
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
        "pixverse/pixverse-v5.5/text-to-video",
      )!;
    const { outputs, requestId } = await submitAndPoll(
      model,
      inputFor(input, resolved),
      resolved,
      ctx,
    );
    const videoUrl = findFirstUrl(outputs);
    if (!videoUrl) {
      throw new ProviderError(
        "WAVESPEED_NO_OUTPUT",
        "WaveSpeedAI returned no video URL",
        { provider: "wavespeed", requestId },
      );
    }
    const video = await downloadVideo(videoUrl, ctx, "wavespeed");
    return {
      video: video.video,
      mimeType: video.mimeType,
      durationSeconds: input.durationSeconds,
      requestId,
      provider: "wavespeed",
      usage: {
        unit: "second",
        outputUnits: input.durationSeconds,
        metadata: { model },
      },
    };
  },
};

export async function getWaveSpeedStatus(
  requestId: string,
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
): Promise<{ status: string; outputs?: unknown }> {
  const apiKey = requireKey(resolved, ctx);
  const baseUrl = configString(
    resolved,
    "baseUrl",
    "https://api.wavespeed.ai/api/v3",
  )!;
  const result = await fetchJson<WaveSpeedResultResponse>(
    joinUrl(baseUrl, `predictions/${requestId}/result`),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { provider: "wavespeed", signal: ctx.signal, timeoutMs: 45_000 },
  );
  return {
    status: result.data.data?.status ?? "UNKNOWN",
    outputs: result.data.data?.outputs ?? result.data.data?.output,
  };
}

export async function getWaveSpeedPriceQuote(
  model: string,
  inputs: Record<string, unknown>,
  resolved: ResolvedProvider,
  ctx: ProviderCallContext,
): Promise<{ priceUsd: number; discountedPriceUsd: number; currency: string } | null> {
  const apiKey = secretValue(resolved, "apiKey", ctx.env.WAVESPEED_API_KEY);
  if (!apiKey) return null;
  const baseUrl = configString(
    resolved,
    "baseUrl",
    "https://api.wavespeed.ai/api/v3",
  )!;
  try {
    const response = await fetchJson<{
      code?: number;
      data?: {
        price?: number;
        discounted_price?: number;
        currency?: string;
      };
    }>(
      joinUrl(baseUrl, "model/price"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model_id: model, inputs }),
      },
      { provider: "wavespeed", signal: ctx.signal, timeoutMs: 30_000 },
    );
    const data = response.data.data;
    if (!data || typeof data.price !== "number") return null;
    return {
      priceUsd: data.price,
      discountedPriceUsd: data.discounted_price ?? data.price,
      currency: data.currency ?? "USD",
    };
  } catch {
    return null;
  }
}
