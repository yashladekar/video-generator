/**
 * Cost tiers for hosted generative media models.
 *
 * `estimatedUsdPerUnit` is a pre-flight planning estimate used to pick a tier and
 * to project a clip's cost before spending. It is never used as the recorded
 * price: `services/pricing.ts` prefers a live provider quote and then the
 * `ProviderPricing` catalog, and blocks the call when neither exists.
 *
 * Endpoint ids follow the provider's model gallery. Verify the current id and
 * price for your account before enabling a tier, and override it per user in
 * Settings -> Providers when a provider renames an endpoint.
 */

export type FalModelTier = {
  id: string;
  label: string;
  unit: "image" | "second";
  estimatedUsdPerUnit: number;
  notes?: string;
};

export const KEYFRAME_MODELS: FalModelTier[] = [
  {
    id: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell]",
    unit: "image",
    estimatedUsdPerUnit: 0.003,
    notes: "Stepped-distilled keyframe model. Cheapest hosted image tier.",
  },
  {
    id: "fal-ai/flux/dev",
    label: "FLUX.1 [dev]",
    unit: "image",
    estimatedUsdPerUnit: 0.025,
    notes: "Higher-fidelity keyframe. Only worth it for hero scenes.",
  },
];

export const IMAGE_TO_VIDEO_MODELS: FalModelTier[] = [
  {
    id: "fal-ai/ltx-video-13b-distilled/image-to-video",
    label: "LTX-Video 13B distilled (I2V)",
    unit: "second",
    estimatedUsdPerUnit: 0.015,
    notes: "Distilled open-weights runner. Cheapest per-second image-to-video tier.",
  },
  {
    id: "fal-ai/wan/v2.2-5b/image-to-video",
    label: "Wan 2.2 5B (I2V)",
    unit: "second",
    estimatedUsdPerUnit: 0.02,
    notes: "Small open-weights runner. Good motion quality per rupee.",
  },
  {
    id: "fal-ai/minimax/hailuo-02/turbo/image-to-video",
    label: "MiniMax Hailuo 02 Turbo (I2V)",
    unit: "second",
    estimatedUsdPerUnit: 0.045,
    notes: "Premium turbo tier. Reserve for hook scenes only.",
  },
];

export const TEXT_TO_VIDEO_MODELS: FalModelTier[] = [
  {
    id: "fal-ai/wan/v2.2-5b/text-to-video",
    label: "Wan 2.2 5B (T2V)",
    unit: "second",
    estimatedUsdPerUnit: 0.03,
    notes: "Text-to-video bypasses keyframe control and costs more per usable second.",
  },
  {
    id: "fal-ai/veo3/fast",
    label: "Veo 3 Fast (T2V)",
    unit: "second",
    estimatedUsdPerUnit: 0.25,
    notes: "Premium native text-to-video. Exhausts a small budget in a few clips.",
  },
];

export const DEFAULT_KEYFRAME_MODEL = "fal-ai/flux/schnell";
export const DEFAULT_IMAGE_TO_VIDEO_MODEL =
  "fal-ai/ltx-video-13b-distilled/image-to-video";
export const DEFAULT_TEXT_TO_VIDEO_MODEL = "fal-ai/wan/v2.2-5b/text-to-video";

export function findModelTier(
  model: string | undefined,
  tiers: FalModelTier[],
): FalModelTier | undefined {
  if (!model) return undefined;
  return tiers.find((tier) => tier.id === model);
}

export function cheapestModel(tiers: FalModelTier[]): FalModelTier | undefined {
  return [...tiers].sort(
    (a, b) => a.estimatedUsdPerUnit - b.estimatedUsdPerUnit,
  )[0];
}

export function estimateModelCostUsd(
  model: string | undefined,
  units: number,
  tiers: FalModelTier[],
): number | undefined {
  const tier = findModelTier(model, tiers);
  if (!tier || !Number.isFinite(units) || units <= 0) return undefined;
  return tier.estimatedUsdPerUnit * units;
}

export function withinTierBudget(
  model: string | undefined,
  units: number,
  tiers: FalModelTier[],
  maxUsd: number,
): boolean {
  const estimate = estimateModelCostUsd(model, units, tiers);
  if (estimate === undefined) return true;
  return estimate <= maxUsd;
}
