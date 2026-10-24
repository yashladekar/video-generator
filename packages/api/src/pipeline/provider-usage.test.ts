import { describe, expect, it, vi } from "vitest";

import type { Context } from "../context";
import { BudgetError } from "../lib/errors";
import { silentLogger, testEnv } from "../test/helpers";
import {
  assertVideoCostHeadroom,
  classifyCostLevel,
  enforcePerVideoLimit,
  getJobCostSnapshot,
  projectEstimatedCostInrPaise,
  projectProviderCostInrPaise,
} from "./provider-usage";

function fakeContext(db: Context["db"]): Context {
  return { env: testEnv, db, logger: silentLogger() } as unknown as Context;
}

function costDb(spentInrPaise: number) {
  return {
    usageRecord: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { actualCostInrPaise: spentInrPaise },
      }),
    },
  } as unknown as Context["db"];
}

describe("per-video cost guards", () => {
  it("classifies spend against the limit", () => {
    expect(classifyCostLevel(0, 7000)).toBe("ok");
    expect(classifyCostLevel(5000, 7000)).toBe("ok");
    expect(classifyCostLevel(5800, 7000)).toBe("warning");
    expect(classifyCostLevel(7000, 7000)).toBe("exceeded");
    expect(classifyCostLevel(9000, 7000)).toBe("exceeded");
    expect(classifyCostLevel(500, 0)).toBe("ok");
  });

  it("converts USD unit prices into recorded paise with tax and fees", () => {
    const plain = projectProviderCostInrPaise(5, 0.02, { usdToInrRate: 88 });
    expect(plain).toBe(880);
    const loaded = projectProviderCostInrPaise(5, 0.02, {
      usdToInrRate: 88,
      taxPercent: 18,
      feePercent: 2,
    });
    expect(loaded).toBeGreaterThan(plain);
    expect(projectEstimatedCostInrPaise(0.1, { usdToInrRate: 88 })).toBe(880);
  });

  it("reports the running snapshot for a job", async () => {
    const snapshot = await getJobCostSnapshot(
      fakeContext(costDb(4200)),
      "job-1",
      7000,
    );
    expect(snapshot.spentInrPaise).toBe(4200);
    expect(snapshot.remainingInrPaise).toBe(2800);
    expect(snapshot.level).toBe("ok");
    expect(snapshot.percentUsed).toBeCloseTo(60, 5);
  });

  it("blocks a paid clip whose projection crosses the per-video limit", async () => {
    const ctx = fakeContext(costDb(6000));
    await expect(
      assertVideoCostHeadroom(ctx, {
        userId: "user-1",
        jobId: "job-1",
        provider: "fal",
        model: "fal-ai/veo3/fast",
        label: "AI video for scene 3",
        limitInrPaise: 7000,
        projectedInrPaise: 2200,
      }),
    ).rejects.toThrow(BudgetError);
  });

  it("allows a clip that still fits under the limit but flags the warning band", async () => {
    const ctx = fakeContext(costDb(5800));
    const snapshot = await assertVideoCostHeadroom(ctx, {
      userId: "user-1",
      jobId: "job-1",
      provider: "fal",
      label: "AI video for scene 1",
      limitInrPaise: 7000,
      projectedInrPaise: 300,
    });
    expect(snapshot.level).toBe("warning");
  });

  it("runs without a limit configured", async () => {
    const ctx = fakeContext(costDb(9999));
    const snapshot = await assertVideoCostHeadroom(ctx, {
      userId: "user-1",
      jobId: "job-1",
      provider: "fal",
      label: "AI video for scene 1",
      limitInrPaise: 0,
      projectedInrPaise: 100,
    });
    expect(snapshot.level).toBe("ok");
    expect(snapshot.limitInrPaise).toBe(0);
  });

  it("stops the job once recorded spend crosses the limit", async () => {
    const ctx = fakeContext(costDb(8200));
    await expect(
      enforcePerVideoLimit(ctx, {
        jobId: "job-1",
        userId: "user-1",
        provider: "fal",
        limitInrPaise: 7000,
      }),
    ).rejects.toThrow(/above the .*per-video limit/);
  });

  it("returns a snapshot without throwing while under the limit", async () => {
    const ctx = fakeContext(costDb(1000));
    const snapshot = await enforcePerVideoLimit(ctx, {
      jobId: "job-1",
      userId: "user-1",
      provider: "fal",
      limitInrPaise: 7000,
    });
    expect(snapshot?.level).toBe("ok");
  });

  it("skips enforcement when no limit is configured", async () => {
    const ctx = fakeContext(costDb(100000));
    expect(
      await enforcePerVideoLimit(ctx, {
        jobId: "job-1",
        userId: "user-1",
        provider: "fal",
      }),
    ).toBeNull();
  });
});
