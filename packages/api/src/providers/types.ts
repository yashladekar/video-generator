import type { ProviderCategory } from "@video-generator/db";

import type { RuntimeEnv } from "../env";
import type { Logger } from "../lib/logger";

export type ProviderCategoryValue = ProviderCategory;

export type ResolvedProvider = {
  provider: string;
  category: ProviderCategoryValue;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  source: "user" | "env" | "builtin";
  enabled: boolean;
  isDefault: boolean;
};

export type ProviderCallContext = {
  env: RuntimeEnv;
  signal: AbortSignal;
  logger: Logger;
  userId: string;
};

export type UsageInfo = {
  inputUnits?: number;
  outputUnits?: number;
  unit?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  metadata?: Record<string, unknown>;
};

export type LlmGenerateInput = {
  brief: {
    topic: string;
    targetAudience?: string | null;
    objective?: string | null;
    niche?: string | null;
    language: string;
    tone?: string | null;
    style?: string | null;
    callToAction?: string | null;
    referenceText?: string | null;
    researchEnabled: boolean;
  };
  targetDurationSeconds: number;
  researchSummary?: string;
  repairErrors?: string[];
  model?: string;
  visualStyle?: string;
  musicMood?: string;
  narrationStyle?: string;
};

export type LlmGenerateOutput = {
  script: unknown;
  raw: string;
  usage?: UsageInfo;
  requestId?: string;
  provider: string;
  model?: string;
};

export type TtsSynthesizeInput = {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  format?: "wav" | "mp3";
};

export type TtsSynthesizeOutput = {
  audio: Buffer;
  mimeType: string;
  extension: string;
  durationSeconds?: number;
  usage?: UsageInfo;
  requestId?: string;
  provider: string;
};

export type ResearchSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type ResearchOutput = {
  summary: string;
  sources: ResearchSource[];
  usage?: UsageInfo;
};

export type ImageGenerateInput = {
  prompt: string;
  width: number;
  height: number;
  style?: string;
  seed?: number;
  model?: string;
};

export type ImageGenerateOutput = {
  image: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  attribution?: string;
  usage?: UsageInfo;
  requestId?: string;
  provider: string;
};

export type VideoGenerateInput = {
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  width: number;
  height: number;
  model?: string;
};

export type VideoGenerateOutput = {
  video: Buffer;
  mimeType: string;
  durationSeconds?: number;
  attribution?: string;
  usage?: UsageInfo;
  requestId?: string;
  provider: string;
};

export type MusicGenerateInput = {
  mood: string;
  durationSeconds: number;
  seed?: number;
};

export type MusicGenerateOutput = {
  audio: Buffer;
  mimeType: string;
  durationSeconds: number;
  usage?: UsageInfo;
  provider: string;
};

export type PublishInput = {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "public" | "unlisted" | "private";
  scheduledAt?: Date;
};

export type PublishOutput = {
  externalPostId: string;
  externalUrl?: string;
  requestId?: string;
};

export interface LlmProvider {
  provider: string;
  generateScript(
    input: LlmGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<LlmGenerateOutput>;
}

export interface TtsProvider {
  provider: string;
  synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput>;
}

export interface ResearchProvider {
  provider: string;
  research(
    topic: string,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ResearchOutput>;
}

export interface ImageProvider {
  provider: string;
  generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput>;
}

export interface VideoProvider {
  provider: string;
  generateVideo(
    input: VideoGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<VideoGenerateOutput>;
}

export interface MusicProvider {
  provider: string;
  generateMusic(
    input: MusicGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<MusicGenerateOutput>;
}

export interface PublishingProvider {
  provider: string;
  publish(
    input: PublishInput,
    credentials: Record<string, string>,
    ctx: ProviderCallContext,
  ): Promise<PublishOutput>;
}
