import { z } from "zod";

import {
  aspectRatioSchema,
  budgetConfigSchema,
  durationSecondsSchema,
  idSchema,
  languageSchema,
  musicMoodSchema,
  narrationStyleSchema,
  paginationSchema,
  platformSchema,
  resolutionSchema,
  subtitleStyleSchema,
  visualStyleSchema,
} from "./common";

export const projectBriefSchema = z.object({
  title: z.string().trim().min(2).max(160),
  topic: z.string().trim().min(3).max(500),
  niche: z.string().trim().max(120).optional(),
  targetAudience: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(200).optional(),
  language: languageSchema,
  tone: z.string().trim().max(120).optional(),
  style: z.string().trim().max(120).optional(),
  callToAction: z.string().trim().max(240).optional(),
  referenceText: z.string().max(10_000).optional(),
  referenceAssetIds: z.array(idSchema).max(10).optional(),
  researchEnabled: z.boolean().default(false),
});

export const projectConfigSchema = z.object({
  durationSeconds: durationSecondsSchema.default(60),
  aspectRatio: aspectRatioSchema,
  resolution: resolutionSchema,
  narrationStyle: narrationStyleSchema,
  voice: z.string().max(100).optional(),
  subtitleStyle: subtitleStyleSchema,
  visualStyle: visualStyleSchema,
  musicMood: musicMoodSchema,
  platform: platformSchema.default("YOUTUBE"),
});

export const createProjectInputSchema = z.object({
  brief: projectBriefSchema,
  config: projectConfigSchema,
});

export const createProjectWithBudgetInputSchema = createProjectInputSchema.extend({
  budget: budgetConfigSchema.optional(),
});

export const updateProjectInputSchema = z.object({
  projectId: idSchema,
  brief: projectBriefSchema.partial().optional(),
  config: projectConfigSchema.partial().optional(),
  title: z.string().trim().min(2).max(160).optional(),
});

export const projectIdSchema = z.object({ projectId: idSchema });

export const projectListInputSchema = paginationSchema.extend({
  search: z.string().trim().max(160).optional(),
  status: z
    .enum([
      "ALL",
      "DRAFT",
      "CONFIGURED",
      "QUEUED",
      "GENERATING",
      "COMPLETED",
      "FAILED",
      "ARCHIVED",
    ])
    .default("ALL"),
  platform: z
    .enum(["ALL", "YOUTUBE", "INSTAGRAM_REELS", "TIKTOK", "MANUAL"])
    .default("ALL"),
  sort: z
    .enum(["newest", "oldest", "title", "duration", "cost"])
    .default("newest"),
  includeArchived: z.boolean().default(false),
  includeDeleted: z.boolean().default(false),
});

export const duplicateProjectInputSchema = z.object({
  projectId: idSchema,
  title: z.string().trim().min(2).max(160).optional(),
});

export const renameProjectInputSchema = z.object({
  projectId: idSchema,
  title: z.string().trim().min(2).max(160),
});

export const setThumbnailInputSchema = z.object({
  projectId: idSchema,
  assetId: idSchema,
});

export const settingsUpdateSchema = budgetConfigSchema.partial().extend({
  defaultLanguage: z.string().min(2).max(16).optional(),
  defaultTone: z.string().max(120).optional(),
  defaultVoice: z.string().max(100).optional(),
  defaultSubtitleStyle: subtitleStyleSchema.optional(),
  defaultVisualStyle: visualStyleSchema.optional(),
  defaultMusicMood: musicMoodSchema.optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectWithBudgetInputSchema>;
export type ProjectListInput = z.infer<typeof projectListInputSchema>;
