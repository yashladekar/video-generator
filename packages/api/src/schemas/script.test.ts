import { describe, expect, it } from "vitest";

import { templateLlmProvider } from "../providers/llm/template";
import {
  normalizeScriptDraft,
  validateScriptDraft,
  type ScriptDraft,
} from "./script";
import { testCallContext, testProvider } from "../test/helpers";

async function generateSample(): Promise<ScriptDraft> {
  const output = await templateLlmProvider.generateScript(
    {
      brief: {
        topic: "Why the ocean is deep",
        targetAudience: "Curious beginners",
        objective: "Explain the science",
        niche: "Science explainers",
        language: "en",
        tone: "Clear and friendly",
        style: "Cinematic",
        callToAction: "Follow for more ocean explainers.",
        referenceText: null,
        researchEnabled: false,
      },
      targetDurationSeconds: 45,
      visualStyle: "cinematic",
      musicMood: "ambient",
      narrationStyle: "conversational",
    },
    testProvider("template", "LLM"),
    testCallContext(),
  );
  return output.script as ScriptDraft;
}

describe("script schema", () => {
  it("accepts the deterministic template script", async () => {
    const script = await generateSample();
    const result = validateScriptDraft(script);
    expect(result.success).toBe(true);
  });

  it("rejects a target duration that does not match the scene sum", async () => {
    const script = await generateSample();
    const result = validateScriptDraft({
      ...script,
      targetDurationSeconds: 60,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toMatch(/scene durations/i);
    }
  });

  it("rejects duplicate scene numbers", async () => {
    const script = await generateSample();
    const scenes = script.scenes.map((scene, index) => ({
      ...scene,
      sceneNumber: index === 1 ? 1 : scene.sceneNumber,
    }));
    const result = validateScriptDraft({ ...script, scenes });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toMatch(/duplicate scene number/i);
    }
  });

  it("rejects narration that cannot fit the scene timing", async () => {
    const script = await generateSample();
    const scenes = script.scenes.map((scene, index) =>
      index === 0
        ? {
            ...scene,
            durationSeconds: 2,
            narration:
              "This is an intentionally very long narration that cannot possibly fit into two seconds at a reasonable speaking rate and should be rejected by the validator.",
          }
        : scene,
    );
    const result = validateScriptDraft({ ...script, scenes });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(" ")).toMatch(/words/i);
    }
  });

  it("normalizes ordering and start/end times", async () => {
    const script = await generateSample();
    const shuffled = {
      ...script,
      scenes: [...script.scenes].reverse(),
    };
    const normalized = normalizeScriptDraft(shuffled);
    expect(normalized.scenes[0]?.sceneNumber).toBe(1);
    expect(normalized.scenes[0]?.startSeconds).toBe(0);
    const total = normalized.scenes.reduce(
      (sum, scene) => sum + scene.durationSeconds,
      0,
    );
    expect(total).toBe(45);
    expect(normalized.scenes.at(-1)?.endSeconds).toBeCloseTo(45, 5);
  });
});
