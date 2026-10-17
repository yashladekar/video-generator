import sharp from "sharp";

import { ProviderError } from "../../lib/errors";
import { cacheKeyFor } from "../../lib/hash";
import { fetchBuffer, fetchJson } from "../http";
import { secretValue } from "../resolve";
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

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt?: string;
  src: { original: string; portrait?: string; large2x?: string };
};

type PexelsPhotoResponse = { photos?: PexelsPhoto[] };

type PexelsVideoFile = {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  fps?: number;
  link: string;
};

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
};

type PexelsVideoResponse = { videos?: PexelsVideo[] };

function pickIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  const hash = cacheKeyFor({ seed }).slice(0, 8);
  return Number.parseInt(hash, 16) % length;
}

export const pexelsImageProvider: ImageProvider = {
  provider: "pexels",
  async generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput> {
    const apiKey = secretValue(resolved, "apiKey", ctx.env.PEXELS_API_KEY);
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No Pexels API key configured",
        { provider: "pexels", kind: "PROVIDER_PERMANENT" },
      );
    }
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", input.prompt.slice(0, 160));
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("size", "large");
    url.searchParams.set("per_page", "8");

    const response = await fetchJson<PexelsPhotoResponse>(
      url.toString(),
      { headers: { Authorization: apiKey } },
      { provider: "pexels", signal: ctx.signal, timeoutMs: 45_000 },
    );
    const photos = response.data.photos ?? [];
    if (photos.length === 0) {
      throw new ProviderError(
        "PEXELS_NO_RESULTS",
        "Pexels returned no matching photos",
        { provider: "pexels", kind: "PROVIDER_TRANSIENT" },
      );
    }
    const photo = photos[pickIndex(input.prompt + (input.seed ?? ""), photos.length)];
    if (!photo) {
      throw new ProviderError("PEXELS_NO_RESULTS", "No photo selected", {
        provider: "pexels",
        kind: "PROVIDER_TRANSIENT",
      });
    }
    const sourceUrl = photo.src.original || photo.src.large2x || photo.src.portrait;
    if (!sourceUrl) {
      throw new ProviderError("PEXELS_BAD_RESULT", "Photo has no download URL", {
        provider: "pexels",
      });
    }
    const image = await fetchBuffer(
      sourceUrl,
      { headers: { Authorization: apiKey } },
      {
        provider: "pexels",
        signal: ctx.signal,
        timeoutMs: 90_000,
        maxBytes: 40 * 1024 * 1024,
      },
    );
    const resized = await sharp(image.data)
      .resize(input.width, input.height, { fit: "cover", position: "attention" })
      .jpeg({ quality: 90 })
      .toBuffer();
    return {
      image: resized,
      mimeType: "image/jpeg",
      width: input.width,
      height: input.height,
      attribution: `Photo by ${photo.photographer} on Pexels (${photo.url})`,
      provider: "pexels",
      usage: {
        unit: "request",
        inputUnits: 1,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};

export const pexelsVideoProvider: VideoProvider = {
  provider: "pexels",
  async generateVideo(
    input: VideoGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<VideoGenerateOutput> {
    const apiKey = secretValue(resolved, "apiKey", ctx.env.PEXELS_API_KEY);
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No Pexels API key configured",
        { provider: "pexels", kind: "PROVIDER_PERMANENT" },
      );
    }
    const url = new URL("https://api.pexels.com/v1/videos/search");
    url.searchParams.set("query", input.prompt.slice(0, 160));
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("size", "medium");
    url.searchParams.set("per_page", "8");

    const response = await fetchJson<PexelsVideoResponse>(
      url.toString(),
      { headers: { Authorization: apiKey } },
      { provider: "pexels", signal: ctx.signal, timeoutMs: 45_000 },
    );
    const videos = response.data.videos ?? [];
    if (videos.length === 0) {
      throw new ProviderError(
        "PEXELS_NO_RESULTS",
        "Pexels returned no matching videos",
        { provider: "pexels", kind: "PROVIDER_TRANSIENT" },
      );
    }
    const video = videos[pickIndex(input.prompt, videos.length)];
    if (!video) {
      throw new ProviderError("PEXELS_NO_RESULTS", "No video selected", {
        provider: "pexels",
        kind: "PROVIDER_TRANSIENT",
      });
    }
    const files = [...video.video_files]
      .filter((file) => file.file_type === "video/mp4")
      .sort((a, b) => {
        const aScore = Math.abs(a.width / Math.max(1, a.height) - 9 / 16);
        const bScore = Math.abs(b.width / Math.max(1, b.height) - 9 / 16);
        return aScore - bScore || b.height - a.height;
      });
    const file = files[0];
    if (!file) {
      throw new ProviderError("PEXELS_BAD_RESULT", "Video has no MP4 file", {
        provider: "pexels",
      });
    }
    const downloaded = await fetchBuffer(
      file.link,
      {},
      {
        provider: "pexels",
        signal: ctx.signal,
        timeoutMs: 180_000,
        maxBytes: 150 * 1024 * 1024,
      },
    );
    return {
      video: downloaded.data,
      mimeType: "video/mp4",
      durationSeconds: video.duration,
      attribution: `Video by ${video.user.name} on Pexels (${video.url})`,
      provider: "pexels",
      usage: {
        unit: "request",
        inputUnits: 1,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};
