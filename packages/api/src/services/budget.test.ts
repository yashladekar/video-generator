import { describe, expect, it } from "vitest";

import { evaluateStartEligibility } from "./budget";

const base = {
  estimatedCostInrPaise: 0,
  unknownPricing: false,
  maxCostPerVideoInrPaise: 5_000,
  spendableInrPaise: 42_500,
  dailyRemaining: 1,
  dailyLimit: 1,
  activeJobs: 0,
};

describe("budget start eligibility", () => {
  it("allows a local/free estimate", () => {
    expect(evaluateStartEligibility(base)).toEqual({ ok: true });
  });

  it("blocks unknown hosted pricing", () => {
    const result = evaluateStartEligibility({ ...base, unknownPricing: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRICING_NOT_CONFIGURED");
  });

  it("blocks estimates above the per-video limit", () => {
    const result = evaluateStartEligibility({
      ...base,
      estimatedCostInrPaise: 6_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PER_VIDEO_LIMIT");
  });

  it("blocks estimates above the spendable monthly budget", () => {
    const result = evaluateStartEligibility({
      ...base,
      estimatedCostInrPaise: 3_000,
      spendableInrPaise: 2_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BUDGET_EXCEEDED");
  });

  it("blocks when the daily limit is exhausted", () => {
    const result = evaluateStartEligibility({ ...base, dailyRemaining: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DAILY_LIMIT");
  });

  it("blocks when another job is active", () => {
    const result = evaluateStartEligibility({ ...base, activeJobs: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("JOB_IN_PROGRESS");
  });
});
