import { z } from "zod";

import { durationSecondsSchema, idSchema } from "./common";

export const generationOverridesSchema = z.object({
  localOnly: z.boolean().optional(),
  autoFallback: z.boolean().optional(),
  maxHostedVideoCalls: z.number().int().min(0).max(10).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  preferredLlmProvider: z.string().max(80).optional(),
  preferredTtsProvider: z.string().max(80).optional(),
  preferredVisualProvider: z.string().max(80).optional(),
  preferredVideoProvider: z.string().max(80).optional(),
  researchEnabled: z.boolean().optional(),
  targetDurationSeconds: durationSecondsSchema.optional(),
  generateScript: z.boolean().default(true),
});

export const startGenerationInputSchema = z.object({
  projectId: idSchema,
  idempotencyKey: z.string().min(8).max(120),
  overrides: generationOverridesSchema.optional(),
});

export const estimateGenerationInputSchema = z.object({
  projectId: idSchema,
  overrides: generationOverridesSchema.optional(),
});

export const jobIdSchema = z.object({ jobId: idSchema });

export const jobListInputSchema = z.object({
  projectId: idSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const cancelJobInputSchema = z.object({ jobId: idSchema });

export const retryJobInputSchema = z.object({
  jobId: idSchema,
  fromStep: z
    .enum([
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
    ])
    .optional(),
});

export const reconcileJobInputSchema = z.object({ jobId: idSchema });

export const renderInputSchema = z.object({
  projectId: idSchema,
  kind: z.enum(["PREVIEW", "FINAL"]).default("PREVIEW"),
  idempotencyKey: z.string().min(8).max(120),
});

export type StartGenerationInput = z.infer<typeof startGenerationInputSchema>;
export type GenerationOverrides = z.infer<typeof generationOverridesSchema>;
