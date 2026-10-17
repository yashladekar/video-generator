import { ProviderError } from "../../lib/errors";
import { scriptJsonSchema } from "../../schemas/script";
import { fetchJson, joinUrl, parseJsonLoose } from "../http";
import { configNumber, configString } from "../resolve";
import type {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
  ProviderCallContext,
  ResolvedProvider,
} from "../types";

type OllamaResponse = {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
  error?: string;
};

function buildPrompt(input: LlmGenerateInput): string {
  const brief = input.brief;
  return [
    "Write a structured short-form vertical video script.",
    `Topic: ${brief.topic}`,
    `Audience: ${brief.targetAudience ?? "general"}`,
    `Objective: ${brief.objective ?? "inform and retain attention"}`,
    `Niche: ${brief.niche ?? "general"}`,
    `Language: ${brief.language}`,
    `Tone: ${brief.tone ?? "clear, engaging"}`,
    `Narration style: ${input.narrationStyle ?? "conversational"}`,
    `Visual style: ${input.visualStyle ?? "cinematic"}`,
    `Music mood: ${input.musicMood ?? "ambient"}`,
    `Target duration: ${input.targetDurationSeconds} seconds`,
    `Call to action: ${brief.callToAction ?? "Follow for more."}`,
    brief.referenceText ? `Reference notes: ${brief.referenceText.slice(0, 3000)}` : "",
    input.researchSummary ? `Research summary: ${input.researchSummary.slice(0, 4000)}` : "",
    "",
    "Rules:",
    "- Return only JSON matching the schema. No markdown.",
    "- Scenes must have a hook, a clear progression, and an ending/CTA.",
    "- The sum of scene durations must equal the target duration within 1.5 seconds.",
    "- Narration must fit each scene (max ~3.2 words per second).",
    "- Use distinct visual descriptions. Avoid repetitive visuals and long pauses.",
    "- visualType must be one of IMAGE_ANIMATION, STOCK_IMAGE, STOCK_VIDEO, PROCEDURAL, AI_IMAGE, AI_VIDEO.",
    "- subtitleText must be a short caption of at most 120 characters.",
    "- transition must be cut or fade.",
    "",
    `JSON schema: ${JSON.stringify(scriptJsonSchema)}`,
    input.repairErrors?.length
      ? `Fix these validation errors from the previous attempt:\n- ${input.repairErrors.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const ollamaLlmProvider: LlmProvider = {
  provider: "ollama",
  async generateScript(
    input: LlmGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<LlmGenerateOutput> {
    const baseUrl = configString(
      resolved,
      "baseUrl",
      ctx.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    )!;
    const model =
      input.model ?? configString(resolved, "model", "llama3.2:3b")!;
    const temperature = configNumber(resolved, "temperature", 0.7)!;

    const response = await fetchJson<OllamaResponse>(
      joinUrl(baseUrl, "/api/chat"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: scriptJsonSchema,
          options: { temperature },
          messages: [
            {
              role: "system",
              content:
                "You are an expert short-form video scriptwriter. You return strict JSON only.",
            },
            { role: "user", content: buildPrompt(input) },
          ],
        }),
      },
      { provider: "ollama", signal: ctx.signal, timeoutMs: 180_000 },
    );

    if (response.data.error) {
      throw new ProviderError("OLLAMA_ERROR", response.data.error, {
        provider: "ollama",
        kind: "PROVIDER_PERMANENT",
      });
    }
    const content = response.data.message?.content;
    if (!content) {
      throw new ProviderError(
        "OLLAMA_EMPTY_RESPONSE",
        "Ollama returned an empty response",
        { provider: "ollama", kind: "PROVIDER_TRANSIENT" },
      );
    }
    let script: unknown;
    try {
      script = parseJsonLoose(content);
    } catch (error) {
      throw new ProviderError(
        "OLLAMA_INVALID_JSON",
        "Ollama returned invalid JSON",
        { provider: "ollama", kind: "PROVIDER_TRANSIENT", cause: error },
      );
    }
    return {
      script,
      raw: content,
      provider: "ollama",
      model,
      usage: {
        unit: "tokens",
        inputUnits: response.data.prompt_eval_count ?? 0,
        outputUnits: response.data.eval_count ?? 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};
