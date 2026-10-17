import { z } from "zod";

import { providerCategorySchema } from "./common";

export const providerConfigRecordSchema = z.record(z.string(), z.unknown());

export const upsertProviderInputSchema = z.object({
  category: providerCategorySchema,
  provider: z.string().min(1).max(80),
  label: z.string().max(120).optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  config: providerConfigRecordSchema.optional(),
  secrets: z.record(z.string(), z.string().max(4000)).optional(),
});

export const deleteProviderInputSchema = z.object({
  category: providerCategorySchema,
  provider: z.string().min(1).max(80),
});

export const testProviderInputSchema = z.object({
  category: providerCategorySchema,
  provider: z.string().min(1).max(80),
});

export const pricingUpsertInputSchema = z.object({
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  category: providerCategorySchema,
  unit: z.string().min(1).max(60),
  unitPriceUsd: z.number().min(0).max(10_000),
  sourceUrl: z.string().max(500).optional(),
  active: z.boolean().default(true),
});

export const providerListInputSchema = z.object({
  category: providerCategorySchema.optional(),
});
