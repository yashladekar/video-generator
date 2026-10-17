import { z } from "zod";

export const idSchema = z.string().min(1).max(120);

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const languageSchema = z.string().min(2).max(16).default("en");

export const aspectRatioSchema = z.literal("9:16").default("9:16");

export const resolutionSchema = z.enum(["720p", "1080p"]).default("1080p");

export const durationSecondsSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
]);

export const platformSchema = z.enum([
  "YOUTUBE",
  "INSTAGRAM_REELS",
  "TIKTOK",
  "MANUAL",
]);

export const visualStyleSchema = z
  .enum(["cinematic", "minimal", "bold", "documentary", "tech", "nature"])
  .default("cinematic");

export const subtitleStyleSchema = z
  .enum(["bold", "clean", "karaoke", "minimal"])
  .default("bold");

export const musicMoodSchema = z
  .enum(["ambient", "cinematic", "upbeat", "lofi", "none"])
  .default("ambient");

export const narrationStyleSchema = z
  .enum(["conversational", "authoritative", "energetic", "calm"])
  .default("conversational");

export const providerCategorySchema = z.enum([
  "LLM",
  "RESEARCH",
  "TTS",
  "IMAGE",
  "IMAGE_TO_VIDEO",
  "TEXT_TO_VIDEO",
  "MUSIC",
  "STORAGE",
  "PUBLISHING",
]);

export const budgetConfigSchema = z.object({
  monthlyBudgetInrPaise: z.number().int().min(0).max(100_000_000).default(50_000),
  maxCostPerVideoInrPaise: z.number().int().min(0).max(10_000_000).default(5_000),
  maxHostedVideoCalls: z.number().int().min(0).max(10).default(2),
  maxRetries: z.number().int().min(0).max(10).default(3),
  reservePercent: z.number().min(0).max(90).default(15),
  usdToInrRate: z.number().positive().max(1000).default(88),
  taxPercent: z.number().min(0).max(100).default(0),
  feePercent: z.number().min(0).max(100).default(0),
  dailyLimit: z.number().int().min(1).max(10).default(1),
  timezone: z.string().min(1).max(80).default("Asia/Kolkata"),
  localOnly: z.boolean().default(false),
  autoFallback: z.boolean().default(true),
  preferredLlmProvider: z.string().max(80).optional(),
  preferredTtsProvider: z.string().max(80).optional(),
  preferredVisualProvider: z.string().max(80).optional(),
  preferredVideoProvider: z.string().max(80).optional(),
});

export type BudgetConfig = z.infer<typeof budgetConfigSchema>;
