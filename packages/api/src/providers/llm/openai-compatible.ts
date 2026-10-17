import { ProviderError } from "../../lib/errors";
import { scriptJsonSchema } from "../../schemas/script";
import { fetchJson, joinUrl, parseJsonLoose } from "../http";
import { configNumber, configString, secretValue } from "../resolve";
import type {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
  ProviderCallContext,
  ResolvedProvider,
} from "../types";

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

function buildMessages(input: LlmGenerateInput) {
  const brief = input.brief;
  const system =
    "You are an expert short-form video scriptwriter. Return only a JSON object that matches the provided schema. No markdown, no commentary.";
  const user = [
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
    "Requirements:",
    "- Scenes: hook, main content, ending/CTA. 3-24 scenes.",
    "- Sum of scene durations must be within 1.5s of the target.",
    "- Narration must fit each scene at no more than ~3.2 words/second.",
    "- Distinct visuals, no repetitive descriptions, no unnecessary pauses.",
    "- subtitleText <= 120 characters. transition is cut or fade.",
    "- visualType: IMAGE_ANIMATION, STOCK_IMAGE, STOCK_VIDEO, PROCEDURAL, AI_IMAGE, or AI_VIDEO.",
    input.repairErrors?.length
      ? `\nFix these validation errors from the previous attempt:\n- ${input.repairErrors.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

export const openAiCompatibleLlmProvider: LlmProvider = {
  provider: "openai-compatible",
  async generateScript(
    input: LlmGenerateInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<LlmGenerateOutput> {
    const baseUrl = configString(
      resolved,
      "baseUrl",
      ctx.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    )!;
    const apiKey = secretValue(resolved, "apiKey", ctx.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No API key configured for the OpenAI-compatible provider",
        { provider: "openai-compatible", kind: "PROVIDER_PERMANENT" },
      );
    }
    const model =
      input.model ?? configString(resolved, "model", "gpt-4o-mini")!;
    const temperature = configNumber(resolved, "temperature", 0.7)!;
    const messages = buildMessages(input);
    const url = joinUrl(baseUrl, "/chat/completions");

    const request = async (useJsonSchema: boolean) =>
      fetchJson<OpenAIResponse>(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature,
            messages,
            response_format: useJsonSchema
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: "reel_script",
                    strict: true,
                    schema: scriptJsonSchema,
                  },
                }
              : { type: "json_object" },
          }),
        },
        {
          provider: "openai-compatible",
          signal: ctx.signal,
          timeoutMs: 120_000,
          requestIdHeader: "x-request-id",
        },
      );

    let response: Awaited<ReturnType<typeof request>>;
    try {
      response = await request(true);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 400) {
        response = await request(false);
      } else {
        throw error;
      }
    }

    if (response.data.error?.message) {
      throw new ProviderError(
        "OPENAI_ERROR",
        response.data.error.message,
        { provider: "openai-compatible", kind: "PROVIDER_TRANSIENT" },
      );
    }

    const content = response.data.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError(
        "OPENAI_EMPTY_RESPONSE",
        "The provider returned an empty response",
        { provider: "openai-compatible", kind: "PROVIDER_TRANSIENT" },
      );
    }

    let script: unknown;
    try {
      script = parseJsonLoose(content);
    } catch (error) {
      throw new ProviderError(
        "OPENAI_INVALID_JSON",
        "The provider returned invalid JSON",
        { provider: "openai-compatible", kind: "PROVIDER_TRANSIENT", cause: error },
      );
    }

    return {
      script,
      raw: content,
      provider: "openai-compatible",
      model,
      requestId: response.requestId,
      usage: {
        unit: "tokens",
        inputUnits: response.data.usage?.prompt_tokens ?? 0,
        outputUnits: response.data.usage?.completion_tokens ?? 0,
        metadata: { totalTokens: response.data.usage?.total_tokens },
      },
    };
  },
};
