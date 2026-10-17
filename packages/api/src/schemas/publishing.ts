import { z } from "zod";

import { idSchema, platformSchema } from "./common";

export const createPublishingJobInputSchema = z.object({
  renderedVideoId: idSchema,
  platform: platformSchema,
  title: z.string().trim().min(1).max(100),
  caption: z.string().trim().max(5000).default(""),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  scheduledAt: z.coerce.date().optional(),
  privacyStatus: z.enum(["public", "unlisted", "private"]).default("private"),
  publishingAccountId: idSchema.optional(),
  idempotencyKey: z.string().min(8).max(120),
});

export const publishingJobIdSchema = z.object({ publishingJobId: idSchema });

export const manualExportInputSchema = z.object({
  renderedVideoId: idSchema,
  platform: z.enum(["INSTAGRAM_REELS", "TIKTOK", "MANUAL"]),
  title: z.string().trim().min(1).max(100),
  caption: z.string().trim().max(5000).default(""),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  idempotencyKey: z.string().min(8).max(120),
});

export const connectAccountInputSchema = z.object({
  platform: z.literal("YOUTUBE"),
});

export const disconnectAccountInputSchema = z.object({
  accountId: idSchema,
});

export const setupRequirementsInputSchema = z.object({
  platform: platformSchema,
});
