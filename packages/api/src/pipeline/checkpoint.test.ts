import { describe, expect, it } from "vitest";

import {
  interruptedStepTypes,
  isLocalOnlyStepType,
  isPaidStepType,
  isReusableStepStatus,
  latestStepsByType,
  planJobResume,
  renderOnlyViolations,
  reusableOutputFor,
  reusableStepFor,
} from "./checkpoint";

const GENERATE_ORDER = [
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
];

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

  it("classifies paid provider steps apart from local work", () => {
    expect(isPaidStepType("VISUALS")).toBe(true);
    expect(isPaidStepType("AI_VIDEO")).toBe(true);
    expect(isPaidStepType("NARRATION")).toBe(true);
    expect(isPaidStepType("RENDER")).toBe(false);
    expect(isLocalOnlyStepType("RENDER")).toBe(true);
    expect(isLocalOnlyStepType("SUBTITLES")).toBe(true);
    expect(isLocalOnlyStepType("SCRIPT")).toBe(false);
  });

  it("recovers a paid step from an earlier successful attempt after a failure", () => {
    const steps = [
      { type: "VISUALS", attempt: 1, status: "SUCCEEDED", output: { scenes: 4 } },
      { type: "VISUALS", attempt: 2, status: "FAILED" },
    ];
    const recovered = reusableStepFor(steps, "VISUALS");
    expect(recovered?.attempt).toBe(1);
    expect(reusableOutputFor(steps, "VISUALS")).toEqual({ scenes: 4 });
  });

  it("never treats an interrupted paid step as reusable", () => {
    const steps = [
      { type: "AI_VIDEO", attempt: 1, status: "RUNNING" },
      { type: "VISUALS", attempt: 1, status: "SUCCEEDED", output: { id: "v1" } },
    ];
    expect(reusableStepFor(steps, "AI_VIDEO")).toBeUndefined();
    expect(interruptedStepTypes(steps)).toEqual(["AI_VIDEO"]);
  });

  it("plans a resume that proves no paid step will be replayed", () => {
    const succeeded = GENERATE_ORDER.slice(0, 5).map((type) => ({
      type,
      attempt: 1,
      status: "SUCCEEDED",
      output: { type },
    }));
    const steps = [
      ...succeeded,
      { type: "VISUALS", attempt: 1, status: "FAILED" },
      { type: "AI_VIDEO", attempt: 1, status: "PENDING" },
      { type: "SUBTITLES", attempt: 1, status: "PENDING" },
      { type: "MUSIC", attempt: 1, status: "PENDING" },
      { type: "RENDER", attempt: 1, status: "PENDING" },
      { type: "VALIDATE_OUTPUT", attempt: 1, status: "PENDING" },
      { type: "FINALIZE", attempt: 1, status: "PENDING" },
    ];
    const plan = planJobResume(steps, GENERATE_ORDER);
    expect(plan.resumeFrom).toBe("VISUALS");
    expect(plan.paidStepsReused).toContain("SCRIPT");
    expect(plan.paidStepsReused).toContain("NARRATION");
    expect(plan.paidStepsReused).toContain("RESEARCH");
    expect(plan.paidStepsPending).toEqual(["VISUALS", "AI_VIDEO"]);
    expect(plan.requiresPaidReplay).toBe(true);
  });

  it("reports a paid step as recovered rather than pending when an earlier attempt succeeded", () => {
    const steps = [
      { type: "VALIDATE", attempt: 1, status: "SUCCEEDED" },
      { type: "RESEARCH", attempt: 1, status: "SKIPPED" },
      { type: "SCRIPT", attempt: 1, status: "SUCCEEDED", output: { id: "s" } },
      { type: "SCRIPT", attempt: 2, status: "FAILED" },
      ...GENERATE_ORDER.slice(3).map((type) => ({
        type,
        attempt: 1,
        status: "PENDING",
      })),
    ];
    const plan = planJobResume(steps, GENERATE_ORDER);
    expect(plan.paidStepsRecovered).toContain("SCRIPT");
    expect(plan.paidStepsPending).not.toContain("SCRIPT");
    expect(plan.resumeFrom).toBe("SCENES");
  });

  it("treats a render-only retry as touching no provider step", () => {
    const steps = [
      { type: "RENDER", attempt: 1, status: "FAILED" },
      { type: "VALIDATE_OUTPUT", attempt: 1, status: "PENDING" },
    ];
    expect(
      renderOnlyViolations(steps, ["RENDER", "VALIDATE_OUTPUT", "FINALIZE"]),
    ).toEqual([]);

    const withPaidFailure = [
      { type: "AI_VIDEO", attempt: 1, status: "FAILED" },
      { type: "RENDER", attempt: 1, status: "FAILED" },
    ];
    expect(
      renderOnlyViolations(withPaidFailure, [
        "RENDER",
        "VALIDATE_OUTPUT",
        "FINALIZE",
      ]),
    ).toEqual(["AI_VIDEO"]);
  });
});
