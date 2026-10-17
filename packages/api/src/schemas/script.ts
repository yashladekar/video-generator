import { z } from "zod";

export const visualTypeSchema = z.enum([
  "IMAGE_ANIMATION",
  "STOCK_IMAGE",
  "STOCK_VIDEO",
  "PROCEDURAL",
  "AI_IMAGE",
  "AI_VIDEO",
]);

export const transitionSchema = z.enum(["cut", "fade"]).default("cut");

export const motionSchema = z
  .enum(["zoom_in", "zoom_out", "pan_left", "pan_right", "static"])
  .optional();

export const sceneDraftSchema = z.object({
  sceneNumber: z.number().int().min(1).max(40),
  durationSeconds: z.number().min(1).max(12),
  narration: z.string().trim().min(1).max(800),
  visualDescription: z.string().trim().min(1).max(600),
  visualType: visualTypeSchema,
  subtitleText: z.string().trim().min(1).max(200),
  transition: transitionSchema,
  motion: motionSchema,
  emphasis: z.string().max(80).optional(),
});

export const scriptDraftBaseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  hook: z.string().trim().min(1).max(400),
  targetDurationSeconds: z.number().int().min(30).max(90),
  aspectRatio: z.literal("9:16"),
  language: z.string().min(2).max(16),
  cta: z.string().trim().min(1).max(240),
  visualStyle: z.string().min(1).max(80),
  musicMood: z.string().min(1).max(80),
  scenes: z.array(sceneDraftSchema).min(3).max(24),
});

export type SceneDraft = z.infer<typeof sceneDraftSchema>;
export type ScriptDraft = z.infer<typeof scriptDraftBaseSchema>;

export const scriptDraftSchema = scriptDraftBaseSchema.superRefine(
  (script, ctx) => {
    const sum = script.scenes.reduce(
      (total, scene) => total + scene.durationSeconds,
      0,
    );
    const tolerance = Math.max(1.5, script.targetDurationSeconds * 0.05);
    if (Math.abs(sum - script.targetDurationSeconds) > tolerance) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: `Scene durations sum to ${sum}s but the target is ${script.targetDurationSeconds}s (tolerance ${tolerance.toFixed(1)}s).`,
      });
    }

    const numbers = new Set<number>();
    const visualKeys = new Set<string>();
    for (const [index, scene] of script.scenes.entries()) {
      if (numbers.has(scene.sceneNumber)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "sceneNumber"],
          message: `Duplicate scene number ${scene.sceneNumber}.`,
        });
      }
      numbers.add(scene.sceneNumber);

      const words = scene.narration.trim().split(/\s+/).filter(Boolean).length;
      const maxWords = scene.durationSeconds * 3.6 + 2;
      if (words > maxWords) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "narration"],
          message: `Narration has ${words} words but must fit ${scene.durationSeconds}s (max ~${Math.floor(maxWords)} words).`,
        });
      }

      const key = scene.visualDescription
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (visualKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", index, "visualDescription"],
          message: "Visual descriptions must be distinct across scenes.",
        });
      }
      visualKeys.add(key);
    }

    const sorted = [...script.scenes].sort(
      (a, b) => a.sceneNumber - b.sceneNumber,
    );
    if (sorted[0]?.sceneNumber !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: "Scene numbering must start at 1.",
      });
    }
  },
);

export const scriptJsonSchema = z.toJSONSchema(scriptDraftBaseSchema, {
  target: "draft-7",
  io: "input",
}) as Record<string, unknown>;

export type ScriptValidationResult =
  | { success: true; data: ScriptDraft }
  | { success: false; errors: string[] };

export function validateScriptDraft(value: unknown): ScriptValidationResult {
  const parsed = scriptDraftSchema.safeParse(value);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    errors: parsed.error.issues.map(
      (issue) =>
        `${issue.path.length ? issue.path.join(".") : "script"}: ${issue.message}`,
    ),
  };
}

export type NormalizedScene = SceneDraft & {
  orderIndex: number;
  startSeconds: number;
  endSeconds: number;
};

export type NormalizedScriptDraft = Omit<ScriptDraft, "scenes"> & {
  scenes: NormalizedScene[];
};

export function normalizeScriptDraft(
  script: ScriptDraft,
  targetDurationSeconds = script.targetDurationSeconds,
): NormalizedScriptDraft {
  const sorted = [...script.scenes].sort(
    (a, b) => a.sceneNumber - b.sceneNumber,
  );
  let cursor = 0;
  const scenes = sorted.map((scene, index) => {
    const startSeconds = cursor;
    cursor += scene.durationSeconds;
    return {
      ...scene,
      sceneNumber: index + 1,
      subtitleText:
        scene.subtitleText.trim() || scene.narration.trim().slice(0, 160),
      transition: scene.transition ?? "cut",
      orderIndex: index,
      startSeconds,
      endSeconds: cursor,
    };
  });
  return {
    ...script,
    targetDurationSeconds,
    scenes,
  };
}

export const sceneUpdateSchema = z.object({
  sceneId: z.string().min(1),
  narration: z.string().trim().min(1).max(800).optional(),
  subtitleText: z.string().trim().min(1).max(200).optional(),
  durationSeconds: z.number().min(1).max(20).optional(),
  transition: transitionSchema.optional(),
  motion: motionSchema,
  visualDescription: z.string().trim().min(1).max(600).optional(),
  visualType: visualTypeSchema.optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export const reorderScenesSchema = z.object({
  projectId: z.string().min(1),
  sceneIds: z.array(z.string().min(1)).min(1).max(40),
});

export const regenerateSceneSchema = z.object({
  sceneId: z.string().min(1),
  parts: z
    .array(z.enum(["script", "visual", "narration", "all"]))
    .min(1)
    .default(["all"]),
  idempotencyKey: z.string().min(8).max(120),
});

export const replaceVisualSchema = z.object({
  sceneId: z.string().min(1),
  assetId: z.string().min(1).optional(),
  prompt: z.string().max(600).optional(),
  visualType: visualTypeSchema.optional(),
});

export const regenerateVoiceoverSchema = z.object({
  sceneId: z.string().min(1),
  voice: z.string().max(100).optional(),
  idempotencyKey: z.string().min(8).max(120),
});

export const updateMusicSchema = z.object({
  projectId: z.string().min(1),
  mood: z.enum(["ambient", "cinematic", "upbeat", "lofi", "none"]).optional(),
  volume: z.number().min(0).max(1).optional(),
});

export const updateCaptionStyleSchema = z.object({
  projectId: z.string().min(1),
  style: z.enum(["bold", "clean", "karaoke", "minimal"]),
  position: z.enum(["bottom", "center", "top"]).optional(),
});

export const approveVideoSchema = z.object({
  renderedVideoId: z.string().min(1),
});
