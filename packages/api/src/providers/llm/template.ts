import type {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
  ProviderCallContext,
  ResolvedProvider,
} from "../types";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "about",
  "into",
  "what",
  "when",
  "how",
  "why",
  "are",
  "you",
  "can",
  "will",
  "our",
  "their",
  "they",
  "them",
  "have",
  "has",
  "not",
  "but",
]);

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function topicKeywords(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 6);
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "")}.`;
}

function allocateDurations(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  const result = Array.from({ length: count }, () => base);
  const center = (count - 1) / 2;
  const indexes = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => Math.abs(a - center) - Math.abs(b - center),
  );
  for (let i = 0; i < remainder; i += 1) {
    const index = indexes[i];
    if (index !== undefined) result[index] = (result[index] ?? base) + 1;
  }
  return result;
}

function ensureDurationSum(durations: number[], total: number): number[] {
  const sum = durations.reduce((a, b) => a + b, 0);
  if (sum === total) return durations;
  const result = [...durations];
  result[result.length - 1] = (result[result.length - 1] ?? 0) + (total - sum);
  return result;
}

export const templateLlmProvider: LlmProvider = {
  provider: "template",
  async generateScript(
    input: LlmGenerateInput,
    _resolved: ResolvedProvider,
    _ctx: ProviderCallContext,
  ): Promise<LlmGenerateOutput> {
    const target = Math.max(30, Math.min(90, Math.round(input.targetDurationSeconds)));
    const sceneCount = Math.max(4, Math.min(12, Math.round(target / 8)));
    const durations = ensureDurationSum(
      allocateDurations(target, sceneCount),
      target,
    );
    const keywords = topicKeywords(input.brief.topic);
    const audience = input.brief.targetAudience?.trim() || "curious viewers";
    const niche = input.brief.niche?.trim() || keywords[0] || "this topic";
    const visualStyle = input.visualStyle || input.brief.style || "cinematic";
    const musicMood = input.musicMood || "ambient";
    const cta =
      input.brief.callToAction?.trim() ||
      `Follow for more ${niche} explainers.`;

    const hookLines = [
      `Most people misunderstand ${input.brief.topic}. Here is the simple version.`,
      `Here is a quick way to think about ${input.brief.topic}.`,
      `This is the part of ${input.brief.topic} that actually matters.`,
    ];
    const bodyLines = [
      `Start with the one idea that makes ${niche} easier to understand.`,
      `Think of ${niche} as a system, not a single trick.`,
      `The practical takeaway is to focus on what you can control.`,
      `A simple example makes the point stick.`,
      `Notice how small choices compound over time.`,
      `That is why ${audience} should keep this framework handy.`,
      `Compare the result you want with the input you are giving.`,
      `Clarity comes from testing one change at a time.`,
      `The best next step is usually the smallest useful one.`,
      `Keep the process repeatable and the results get easier to trust.`,
    ];
    const visualMotifs = [
      "slow push toward a glowing focal point",
      "macro detail with soft moving light",
      "geometric layers sliding past each other",
      "a wide establishing shot with gentle parallax",
      "abstract data lines forming a clear shape",
      "close-up texture with shallow depth of field",
      "minimal typography over a dark gradient",
      "a split composition showing cause and effect",
      "a top-down view with clean directional movement",
      "a final wide shot that opens into negative space",
    ];

    const scenes = durations.map((duration, index) => {
      const isHook = index === 0;
      const isCta = index === durations.length - 1;
      const wordBudget = Math.max(8, Math.floor(duration * 2.8));
      const baseLine = isHook
        ? (hookLines[0] ?? input.brief.topic)
        : isCta
          ? cta
          : bodyLines[(index - 1) % bodyLines.length] ??
            bodyLines[0] ??
            input.brief.topic;
      const narration = truncateWords(
        isCta && wordBudget < 8 ? cta : baseLine,
        wordBudget,
      );
      const keyword = keywords[index % Math.max(1, keywords.length)] ?? niche;
      const visualType =
        isHook
          ? "PROCEDURAL"
          : index % 3 === 0
            ? "STOCK_IMAGE"
            : index % 5 === 0
              ? "IMAGE_ANIMATION"
              : "PROCEDURAL";
      const visualDescription = `${visualStyle} scene about ${input.brief.topic}, ${visualMotifs[index % visualMotifs.length]}, ${keyword} metaphor, vertical 9:16 composition, no text`;
      return {
        sceneNumber: index + 1,
        durationSeconds: duration,
        narration,
        visualDescription,
        visualType,
        subtitleText: truncateWords(narration, 12),
        transition: index === 0 ? "fade" : index % 4 === 0 ? "fade" : "cut",
        motion:
          index % 4 === 0
            ? "zoom_out"
            : index % 3 === 0
              ? "pan_left"
              : index % 2 === 0
                ? "pan_right"
                : "zoom_in",
      };
    });

    const script = {
      title: titleCase(
        input.brief.topic.length > 70
          ? `${input.brief.topic.slice(0, 67)}...`
          : input.brief.topic,
      ),
      hook: truncateWords(hookLines[0] ?? input.brief.topic, 18),
      targetDurationSeconds: target,
      aspectRatio: "9:16",
      language: input.brief.language || "en",
      cta,
      visualStyle,
      musicMood,
      scenes,
    };

    return {
      script,
      raw: JSON.stringify(script),
      provider: "template",
      model: "rule-based",
      usage: { unit: "request", inputUnits: 1, estimatedCostUsd: 0, actualCostUsd: 0 },
    };
  },
};
