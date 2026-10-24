import { describe, expect, it } from "vitest";

import {
  hasExplicitVisualPreference,
  paidTiers,
  planSceneVisual,
  planRequiresPaidSpend,
} from "./tiers";

const available = {
  stockProviders: ["pexels"],
  imageProviders: ["fal"],
  videoProviders: ["fal"],
  allowPaidVideo: true,
};

describe("scene visual tiers", () => {
  it("treats auto/none/empty as no explicit preference", () => {
    expect(hasExplicitVisualPreference(null)).toBe(false);
    expect(hasExplicitVisualPreference(undefined)).toBe(false);
    expect(hasExplicitVisualPreference("auto")).toBe(false);
    expect(hasExplicitVisualPreference("none")).toBe(false);
    expect(hasExplicitVisualPreference("")).toBe(false);
    expect(hasExplicitVisualPreference("fal")).toBe(true);
  });

  it("lists free stock before paid generation for AI_VIDEO scenes", () => {
    const plan = planSceneVisual({ visualType: "AI_VIDEO", ...available });
    const order = plan.map((item) => item.provider);
    expect(order[0]).toBe("pexels");
    expect(order).toContain("fal");
    expect(order).toContain("procedural");
    expect(planRequiresPaidSpend(plan)).toBe(false);
  });

  it("puts the cheap keyframe ahead of the paid video tier", () => {
    const plan = planSceneVisual({ visualType: "AI_VIDEO", ...available });
    const keyframeIndex = plan.findIndex((item) => item.tier === "keyframe");
    const videoIndex = plan.findIndex(
      (item) => item.tier === "generative-video",
    );
    expect(keyframeIndex).toBeGreaterThanOrEqual(0);
    expect(videoIndex).toBeGreaterThan(keyframeIndex);
  });

  it("drops every paid tier in local-only mode", () => {
    const plan = planSceneVisual({
      visualType: "AI_IMAGE",
      ...available,
      localOnly: true,
    });
    expect(paidTiers(plan)).toHaveLength(0);
    expect(plan.map((item) => item.provider)).toEqual(["procedural"]);
  });

  it("skips paid video when hosted clips are disabled", () => {
    const plan = planSceneVisual({
      visualType: "AI_VIDEO",
      ...available,
      allowPaidVideo: false,
    });
    expect(plan.some((item) => item.tier === "generative-video")).toBe(false);
  });

  it("respects a pinned provider for AI scenes", () => {
    const plan = planSceneVisual({
      visualType: "AI_IMAGE",
      ...available,
      preferredProvider: "fal",
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.provider).toBe("fal");
    expect(planRequiresPaidSpend(plan)).toBe(true);
  });

  it("keeps procedural and stock scenes on free sources even when a paid provider is pinned", () => {
    const procedural = planSceneVisual({
      visualType: "PROCEDURAL",
      ...available,
      preferredProvider: "procedural",
    });
    expect(procedural.map((item) => item.provider)).toEqual(["procedural"]);

    const stock = planSceneVisual({
      visualType: "STOCK_IMAGE",
      ...available,
      preferredProvider: "pexels",
    });
    expect(paidTiers(stock)).toHaveLength(0);
  });

  it("keeps every free source ahead of paid generation for stock scenes", () => {
    const plan = planSceneVisual({ visualType: "STOCK_IMAGE", ...available });
    expect(plan.map((item) => item.tier)).toEqual([
      "stock",
      "procedural",
      "keyframe",
    ]);
    expect(plan[plan.length - 1]?.paid).toBe(true);
  });

  it("always ends an AI scene plan with the zero-cost procedural fallback", () => {
    const plan = planSceneVisual({ visualType: "AI_VIDEO", ...available });
    const last = plan[plan.length - 1];
    expect(last?.provider).toBe("procedural");
    expect(last?.paid).toBe(false);
  });
});
