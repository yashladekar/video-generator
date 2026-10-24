import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  DEFAULT_KEYFRAME_MODEL,
  DEFAULT_TEXT_TO_VIDEO_MODEL,
  IMAGE_TO_VIDEO_MODELS,
  KEYFRAME_MODELS,
  TEXT_TO_VIDEO_MODELS,
  cheapestModel,
  estimateModelCostUsd,
  findModelTier,
  withinTierBudget,
} from "./model-tiers";

describe("hosted model cost tiers", () => {
  it("defaults the keyframe tier to the cheapest image model", () => {
    expect(DEFAULT_KEYFRAME_MODEL).toBe("fal-ai/flux/schnell");
    expect(cheapestModel(KEYFRAME_MODELS)?.id).toBe(DEFAULT_KEYFRAME_MODEL);
  });

  it("defaults image-to-video to a turbo model, never the premium tier", () => {
    const cheapest = cheapestModel(IMAGE_TO_VIDEO_MODELS);
    expect(DEFAULT_IMAGE_TO_VIDEO_MODEL).toBe(cheapest?.id);
    const premium = findModelTier(
      "fal-ai/minimax/hailuo-02/turbo/image-to-video",
      IMAGE_TO_VIDEO_MODELS,
    );
    expect(premium?.estimatedUsdPerUnit).toBeGreaterThan(
      cheapest?.estimatedUsdPerUnit ?? 0,
    );
  });

  it("keeps native text-to-video as the most expensive tier", () => {
    const cheapestI2V = cheapestModel(IMAGE_TO_VIDEO_MODELS)!;
    const cheapestT2V = cheapestModel(TEXT_TO_VIDEO_MODELS)!;
    expect(cheapestT2V.estimatedUsdPerUnit).toBeGreaterThan(
      cheapestI2V.estimatedUsdPerUnit,
    );
    expect(DEFAULT_TEXT_TO_VIDEO_MODEL).toBe(cheapestT2V.id);
  });

  it("projects a five second clip from the tier table", () => {
    const cost = estimateModelCostUsd(
      DEFAULT_IMAGE_TO_VIDEO_MODEL,
      5,
      IMAGE_TO_VIDEO_MODELS,
    );
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.2);
  });

  it("answers whether a clip fits a per-clip dollar budget", () => {
    expect(
      withinTierBudget(DEFAULT_IMAGE_TO_VIDEO_MODEL, 10, IMAGE_TO_VIDEO_MODELS, 1),
    ).toBe(true);
    expect(
      withinTierBudget(
        "fal-ai/veo3/fast",
        10,
        TEXT_TO_VIDEO_MODELS,
        1,
      ),
    ).toBe(false);
  });

  it("returns no estimate for an unknown endpoint", () => {
    expect(
      estimateModelCostUsd("some/unknown-model", 5, IMAGE_TO_VIDEO_MODELS),
    ).toBeUndefined();
    expect(
      estimateModelCostUsd(DEFAULT_KEYFRAME_MODEL, 0, KEYFRAME_MODELS),
    ).toBeUndefined();
  });
});
