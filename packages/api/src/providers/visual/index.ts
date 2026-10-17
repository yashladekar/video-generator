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

export async function generateVideoWithFallback(
  ctx: Context,
  userId: string,
  input: VideoGenerateInput,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<GeneratedVideo> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "TEXT_TO_VIDEO",
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
      if (options.autoFallback === false || index >= chain.length - 1) break;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(
    "NO_VIDEO_PROVIDER",
    "No video provider is available",
    { provider: "video", kind: "PROVIDER_PERMANENT" },
  );
}
