import type { Context } from "../../context";
import { ProviderError } from "../../lib/errors";
import {
  normalizeScriptDraft,
  validateScriptDraft,
} from "../../schemas/script";
import { resolveProviderChain } from "../resolve";
import type {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
  ProviderCallContext,
} from "../types";
import { ollamaLlmProvider } from "./ollama";
import { openAiCompatibleLlmProvider } from "./openai-compatible";
import { templateLlmProvider } from "./template";

const PROVIDERS = new Map<string, LlmProvider>([
  [templateLlmProvider.provider, templateLlmProvider],
  [ollamaLlmProvider.provider, ollamaLlmProvider],
  [openAiCompatibleLlmProvider.provider, openAiCompatibleLlmProvider],
]);

export type GeneratedScriptResult = {
  script: ReturnType<typeof normalizeScriptDraft>;
  provider: string;
  model?: string;
  raw: string;
  requestId?: string;
  usage?: LlmGenerateOutput["usage"];
  validationErrors: string[];
};

export async function generateScriptWithFallback(
  ctx: Context,
  userId: string,
  input: LlmGenerateInput,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
    maxRepairAttempts?: number;
  } = {},
): Promise<GeneratedScriptResult> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "LLM",
    options.preferredProvider,
    { localOnly: options.localOnly },
  );
  const callCtx: ProviderCallContext = {
    env: ctx.env,
    signal: options.signal ?? new AbortController().signal,
    logger: ctx.logger,
    userId,
  };
  const maxAttempts = Math.max(1, options.maxRepairAttempts ?? 3);
  let lastError: unknown;

  for (const [providerIndex, resolved] of chain.entries()) {
    const adapter = PROVIDERS.get(resolved.provider);
    if (!adapter) continue;
    let repairErrors: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const output = await adapter.generateScript(
          { ...input, repairErrors },
          resolved,
          callCtx,
        );
        const validation = validateScriptDraft(output.script);
        if (validation.success) {
          return {
            script: normalizeScriptDraft(
              validation.data,
              input.targetDurationSeconds,
            ),
            provider: output.provider,
            model: output.model,
            raw: output.raw,
            requestId: output.requestId,
            usage: output.usage,
            validationErrors: repairErrors,
          };
        }
        repairErrors = validation.errors;
        ctx.logger.warn(
          {
            provider: output.provider,
            attempt: attempt + 1,
            errors: validation.errors.slice(0, 8),
          },
          "script validation failed; requesting repair",
        );
      } catch (error) {
        lastError = error;
        ctx.logger.warn(
          {
            provider: resolved.provider,
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error),
          },
          "script provider failed",
        );
        break;
      }
    }

    if (options.autoFallback === false || providerIndex >= chain.length - 1) {
      break;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(
    "NO_SCRIPT_PROVIDER",
    "No script provider could generate a valid script",
    { provider: "llm", kind: "PROVIDER_PERMANENT" },
  );
}

export function getLlmAdapter(provider: string): LlmProvider | undefined {
  return PROVIDERS.get(provider);
}
