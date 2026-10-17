import type { Context } from "../../context";
import { ProviderError } from "../../lib/errors";
import { resolveProviderChain } from "../resolve";
import type {
  ProviderCallContext,
  ResolvedProvider,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "../types";
import { elevenLabsTtsProvider, openAiTtsProvider } from "./hosted";
import {
  espeakTtsProvider,
  macosSayTtsProvider,
  piperTtsProvider,
} from "./local";

const PROVIDERS = new Map<string, TtsProvider>([
  [macosSayTtsProvider.provider, macosSayTtsProvider],
  [espeakTtsProvider.provider, espeakTtsProvider],
  [piperTtsProvider.provider, piperTtsProvider],
  [openAiTtsProvider.provider, openAiTtsProvider],
  [elevenLabsTtsProvider.provider, elevenLabsTtsProvider],
]);

export type SynthesizedNarration = TtsSynthesizeOutput & {
  resolvedProvider: ResolvedProvider;
};

export async function synthesizeWithFallback(
  ctx: Context,
  userId: string,
  input: TtsSynthesizeInput,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    autoFallback?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<SynthesizedNarration> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "TTS",
    options.preferredProvider,
    { localOnly: options.localOnly },
  );
  const callCtx: ProviderCallContext = {
    env: ctx.env,
    signal: options.signal ?? new AbortController().signal,
    logger: ctx.logger,
    userId,
  };
  let lastError: unknown;

  for (const [index, resolved] of chain.entries()) {
    const adapter = PROVIDERS.get(resolved.provider);
    if (!adapter) continue;
    try {
      const output = await adapter.synthesize(input, resolved, callCtx);
      return { ...output, resolvedProvider: resolved };
    } catch (error) {
      lastError = error;
      ctx.logger.warn(
        {
          provider: resolved.provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "TTS provider failed",
      );
      if (options.autoFallback === false || index >= chain.length - 1) {
        break;
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(
    "NO_TTS_PROVIDER",
    "No text-to-speech provider is available. Configure one in Settings.",
    { provider: "tts", kind: "PROVIDER_PERMANENT" },
  );
}

export function getTtsAdapter(provider: string): TtsProvider | undefined {
  return PROVIDERS.get(provider);
}
