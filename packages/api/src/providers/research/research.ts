import type { Context } from "../../context";
import { resolveProviderChain } from "../resolve";
import type {
  ProviderCallContext,
  ResearchOutput,
  ResearchProvider,
  ResolvedProvider,
} from "../types";
import { tavilyResearchProvider, wikipediaResearchProvider } from "./index";

const PROVIDERS = new Map<string, ResearchProvider>([
  [wikipediaResearchProvider.provider, wikipediaResearchProvider],
  [tavilyResearchProvider.provider, tavilyResearchProvider],
]);

export type ResearchResult = ResearchOutput & {
  provider: string;
  resolvedProvider: ResolvedProvider;
};

export async function researchWithFallback(
  ctx: Context,
  userId: string,
  topic: string,
  options: {
    preferredProvider?: string | null;
    localOnly?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<ResearchResult | null> {
  const chain = await resolveProviderChain(
    ctx,
    userId,
    "RESEARCH",
    options.preferredProvider,
    { localOnly: options.localOnly },
  );
  const callCtx: ProviderCallContext = {
    env: ctx.env,
    signal: options.signal ?? new AbortController().signal,
    logger: ctx.logger,
    userId,
  };

  for (const resolved of chain) {
    const adapter = PROVIDERS.get(resolved.provider);
    if (!adapter) continue;
    try {
      const output = await adapter.research(topic, resolved, callCtx);
      return { ...output, provider: resolved.provider, resolvedProvider: resolved };
    } catch (error) {
      ctx.logger.warn(
        {
          provider: resolved.provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "research provider failed",
      );
    }
  }
  return null;
}
