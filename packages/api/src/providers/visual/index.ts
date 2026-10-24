import type { Context } from "../../context";
import { ProviderError } from "../../lib/errors";
import { resolveProviderChain } from "../resolve";
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  ImageProvider,
  ProviderCallContext,
  ResolvedProvider,
  VideoGenerateInput,
  VideoGenerateOutput,
  VideoKeyframe,
  VideoProvider,
} from "../types";
import { comfyUiImageProvider, comfyUiVideoProvider } from "./comfyui";
import { falImageProvider, falVideoProvider } from "./fal";
import { pexelsImageProvider, pexelsVideoProvider } from "./pexels";
import { proceduralImageProvider } from "./procedural";
import { waveSpeedImageProvider, waveSpeedVideoProvider } from "./wavespeed";

const IMAGE_PROVIDERS = new Map<string, ImageProvider>([
  [proceduralImageProvider.provider, proceduralImageProvider],
  [pexelsImageProvider.provider, pexelsImageProvider],
  [falImageProvider.provider, falImageProvider],
  [waveSpeedImageProvider.provider, waveSpeedImageProvider],
  [comfyUiImageProvider.provider, comfyUiImageProvider],
]);

const VIDEO_PROVIDERS = new Map<string, VideoProvider>([
  [pexelsVideoProvider.provider, pexelsVideoProvider],
  [falVideoProvider.provider, falVideoProvider],
  [waveSpeedVideoProvider.provider, waveSpeedVideoProvider],
  [comfyUiVideoProvider.provider, comfyUiVideoProvider],
]);

export type GeneratedImage = ImageGenerateOutput & {
  resolvedProvider: ResolvedProvider;
};

export async function generateImageWithFallback(
  ctx: Context,
  userId: string,
  input: ImageGenerateInput,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GeneratedImage> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "IMAGE",
    options.preferredProvider,
    { localOnly: options.localOnly },
  );
  const callCtx: ProviderCallContext = {
    env: ctx.env,
    signal: options.signal ?? new AbortController().signal,
    logger: ctx.logger,
    userId,
  };
  let lastError: unknown;
  for (const [index, resolved] of chain.entries()) {
    const adapter = IMAGE_PROVIDERS.get(resolved.provider);
    if (!adapter) continue;
    try {
      const output = await adapter.generateImage(input, resolved, callCtx);
      return { ...output, resolvedProvider: resolved };
    } catch (error) {
      lastError = error;
      ctx.logger.warn(
        {
          provider: resolved.provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "image provider failed",
      );
      if (options.autoFallback === false || index >= chain.length - 1) break;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(
    "NO_IMAGE_PROVIDER",
    "No image provider is available",
    { provider: "image", kind: "PROVIDER_PERMANENT" },
  );
}

export type GeneratedVideo = VideoGenerateOutput & {
  resolvedProvider: ResolvedProvider;
};

export function imageToVideoProviders(): string[] {
  return [...VIDEO_PROVIDERS.values()]
    .filter((adapter) => adapter.supportsImageToVideo === true)
    .map((adapter) => adapter.provider);
}

export function videoProviderSupportsImageToVideo(provider: string): boolean {
  return VIDEO_PROVIDERS.get(provider)?.supportsImageToVideo === true;
}

export async function generateVideoWithFallback(
  ctx: Context,
  userId: string,
  input: VideoGenerateInput,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
    imageToVideoOnly?: boolean;
  } = {},
): Promise<GeneratedVideo> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "TEXT_TO_VIDEO",
    options.preferredProvider,
    { localOnly: options.localOnly },
  );
  const requiresImageToVideo = Boolean(input.image) || options.imageToVideoOnly;
  const candidates = requiresImageToVideo
    ? chain.filter((entry) => videoProviderSupportsImageToVideo(entry.provider))
    : chain;
  const callCtx: ProviderCallContext = {
    env: ctx.env,
    signal: options.signal ?? new AbortController().signal,
    logger: ctx.logger,
    userId,
  };
  let lastError: unknown;
  for (const [index, resolved] of candidates.entries()) {
    const adapter = VIDEO_PROVIDERS.get(resolved.provider);
    if (!adapter) continue;
    try {
      const output = await adapter.generateVideo(input, resolved, callCtx);
      return { ...output, resolvedProvider: resolved };
    } catch (error) {
      lastError = error;
      ctx.logger.warn(
        {
          provider: resolved.provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "video provider failed",
      );
      if (options.autoFallback === false || index >= candidates.length - 1) break;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(
    requiresImageToVideo ? "NO_IMAGE_TO_VIDEO_PROVIDER" : "NO_VIDEO_PROVIDER",
    requiresImageToVideo
      ? "No provider supports image-to-video clips. Configure a turbo image-to-video model."
      : "No video provider is available",
    { provider: "video", kind: "PROVIDER_PERMANENT" },
  );
}

export type HybridVideoResult = {
  video: GeneratedVideo;
  keyframeProvider: string;
  keyframeReused: boolean;
};

/**
 * Image-to-video workflow: produce (or reuse) one cheap keyframe, then animate
 * it with a turbo image-to-video model. Only providers that declare
 * image-to-video support are eligible, so this can never silently fall back to
 * an expensive native text-to-video endpoint.
 */
export async function generateHybridVideoWithFallback(
  ctx: Context,
  userId: string,
  input: {
    prompt: string;
    durationSeconds: number;
    aspectRatio: string;
    width: number;
    height: number;
    style?: string;
    seed?: number;
    motion?: string;
    model?: string;
    keyframe?: VideoKeyframe | null;
  },
  options: {
    preferredImageProvider?: string | null;
    preferredVideoProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<HybridVideoResult> {
  let keyframe = input.keyframe ?? null;
  let keyframeProvider = keyframe?.provider ?? "unknown";
  if (!keyframe) {
    const generated = await generateImageWithFallback(
      ctx,
      userId,
      {
        prompt: input.prompt,
        width: input.width,
        height: input.height,
        style: input.style,
        seed: input.seed,
      },
      {
        preferredProvider: options.preferredImageProvider,
        localOnly: options.localOnly,
        autoFallback: options.autoFallback,
        signal: options.signal,
      },
    );
    keyframe = {
      data: generated.image,
      mimeType: generated.mimeType,
      provider: generated.provider,
      requestId: generated.requestId,
    };
    keyframeProvider = generated.provider;
  }

  const video = await generateVideoWithFallback(
    ctx,
    userId,
    {
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      width: input.width,
      height: input.height,
      model: input.model,
      motion: input.motion,
      image: keyframe,
    },
    {
      preferredProvider: options.preferredVideoProvider,
      localOnly: options.localOnly,
      autoFallback: options.autoFallback,
      signal: options.signal,
      imageToVideoOnly: true,
    },
  );

  return {
    video,
    keyframeProvider,
    keyframeReused: Boolean(input.keyframe),
  };
}
