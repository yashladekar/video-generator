import { describe, expect, it } from "vitest";

import { isReusableStepStatus, latestStepsByType } from "./checkpoint";

describe("pipeline checkpoints", () => {
  it("uses the latest attempt for each step type", () => {
    const latest = latestStepsByType([
      { type: "SCRIPT", attempt: 1, status: "FAILED" },
      { type: "SCRIPT", attempt: 2, status: "SUCCEEDED", output: { id: "s2" } },
      { type: "RENDER", attempt: 1, status: "SUCCEEDED" },
      { type: "NARRATION", attempt: 1, status: "SUCCEEDED" },
    ]);
    expect(latest.get("SCRIPT")?.attempt).toBe(2);
    expect(latest.get("SCRIPT")?.output).toEqual({ id: "s2" });
    expect(latest.get("RENDER")?.status).toBe("SUCCEEDED");
  });

  it("reuses only succeeded or skipped steps", () => {
    expect(isReusableStepStatus("SUCCEEDED")).toBe(true);
    expect(isReusableStepStatus("SKIPPED")).toBe(true);
    expect(isReusableStepStatus("PENDING")).toBe(false);
    expect(isReusableStepStatus("RUNNING")).toBe(false);
    expect(isReusableStepStatus("FAILED")).toBe(false);
  });
});
