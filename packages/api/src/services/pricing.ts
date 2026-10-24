import type { ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { usdToPaise } from "../lib/money";
import { fetchJson } from "../providers/http";
import { resolveProviderChain } from "../providers/resolve";
import {
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  DEFAULT_KEYFRAME_MODEL,
} from "../providers/visual/model-tiers";
import { getWaveSpeedPriceQuote } from "../providers/visual/wavespeed";

const FREE_PROVIDERS = new Set([
  "template",
  "ollama",
  "macos-say",
  "espeak-ng",
  "piper",
  "procedural",
  "comfyui",
  "music-generator",
  "wikipedia",
  "pexels",
  "local",
]);

const quoteCache = new Map<
  string,
  { expiresAt: number; priceUsd: number; unit: string; sourceUrl?: string }
>();

export type PricingSource = "free" | "live" | "configured" | "unknown";

export type UnitPrice = {
  unitPriceUsd: number;
  unit: string;
  source: PricingSource;
  sourceUrl?: string;
};

function freePrice(unit: string): UnitPrice {
  return { unitPriceUsd: 0, unit: unit, source: "free" };
}

async function falQuote(
  model: string,
  apiKey: string,
  _ctx: Context,
): Promise<UnitPrice | null> {
  const cacheKey = `fal:${model}`;
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      unitPriceUsd: cached.priceUsd,
      unit: cached.unit,
      source: "live",
      sourceUrl: cached.sourceUrl,
    };
  }
  try {
    const url = new URL("https://api.fal.ai/v1/models/pricing");
    url.searchParams.set("endpoint_id", model);
    const response = await fetchJson<{
      prices?: Array<{
        unit_price?: number;
        unit?: string;
        currency?: string;
      }>;
    }>(
      url.toString(),
      { headers: { Authorization: `Key ${apiKey}` } },
      {
        provider: "fal",
        signal: AbortSignal.timeout(20_000),
        timeoutMs: 20_000,
      },
    );
    const price = response.data.prices?.[0];
    if (!price || typeof price.unit_price !== "number") return null;
    const result = {
      unitPriceUsd: price.unit_price,
      unit: price.unit ?? "request",
      source: "live" as const,
      sourceUrl: "https://fal.ai/pricing",
    };
    quoteCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      priceUsd: result.unitPriceUsd,
      unit: result.unit,
      sourceUrl: result.sourceUrl,
    });
    return result;
  } catch {
    return null;
  }
}

export async function getUnitPrice(
  ctx: Context,
  userId: string,
  provider: string,
  category: ProviderCategory,
  model: string | undefined,
  unit: string,
  quoteInputs?: Record<string, unknown>,
): Promise<UnitPrice> {
  if (FREE_PROVIDERS.has(provider)) {
    return freePrice(unit);
  }

  const chain = await resolveProviderChain(ctx, userId, category, provider);
  const resolved =
    chain.find((entry) => entry.provider === provider) ?? chain[0];
  if (!resolved) {
    return { unitPriceUsd: 0, unit: unit, source: "unknown" };
  }

  if (provider === "fal" && model && (ctx.env.FAL_KEY || resolved.secrets.apiKey)) {
    const live = await falQuote(
      model,
      ctx.env.FAL_KEY ?? resolved.secrets.apiKey ?? "",
      ctx,
    );
    if (live) return live;
  }

  if (
    provider === "wavespeed" &&
    model &&
    (ctx.env.WAVESPEED_API_KEY || resolved.secrets.apiKey)
  ) {
    const live = await getWaveSpeedPriceQuote(
      model,
      quoteInputs ?? {},
      resolved,
      {
        env: ctx.env,
        signal: AbortSignal.timeout(20_000),
        logger: ctx.logger,
        userId,
      },
    );
    if (live) {
      return {
        unitPriceUsd: live.discountedPriceUsd,
        unit,
        source: "live",
        sourceUrl: "https://wavespeed.ai/docs/pricing-api",
      };
    }
  }

  const row = await ctx.db.providerPricing.findUnique({
    where: {
      provider_model_unit: {
        provider,
        model: model ?? "default",
        unit,
      },
    },
  });
  if (row && row.active) {
    return {
      unitPriceUsd: row.unitPriceUsd,
      unit: row.unit,
      source: "configured",
      sourceUrl: row.sourceUrl ?? undefined,
    };
  }

  return { unitPriceUsd: 0, unit: unit, source: "unknown" };
}

export type EstimateLine = {
  label: string;
  provider: string;
  category: ProviderCategory;
  model?: string;
  unit: string;
  units: number;
  unitPriceUsd: number;
  amountUsd: number;
  amountInrPaise: number;
  pricingSource: PricingSource;
  sourceUrl?: string;
};

export type GenerationEstimate = {
  lines: EstimateLine[];
  estimatedCostUsd: number;
  estimatedCostInrPaise: number;
  usdToInrRate: number;
  taxPercent: number;
  feePercent: number;
  unknownPricing: boolean;
  assumptions: string[];
};

function providerForCategory(
  settings: {
    preferredLlmProvider?: string | null;
    preferredTtsProvider?: string | null;
    preferredVisualProvider?: string | null;
    preferredVideoProvider?: string | null;
  },
  category: ProviderCategory,
  chain: Array<{ provider: string; source?: string; isDefault?: boolean }>,
): string | undefined {
  const preferred =
    category === "LLM"
      ? settings.preferredLlmProvider
      : category === "TTS"
        ? settings.preferredTtsProvider
        : category === "IMAGE"
          ? settings.preferredVisualProvider
          : category === "TEXT_TO_VIDEO"
            ? settings.preferredVideoProvider
            : undefined;
  if (preferred && preferred !== "auto") return preferred;

  const userConfigured =
    chain.find((entry) => entry.source === "user" && entry.isDefault) ??
    chain.find((entry) => entry.source === "user");
  if (userConfigured) return userConfigured.provider;

  if (category === "LLM") {
    return (
      ["ollama", "openai-compatible", "template"].find((provider) =>
        chain.some((entry) => entry.provider === provider),
      ) ?? chain[0]?.provider
    );
  }
  if (category === "TTS") {
    return (
      ["macos-say", "piper", "espeak-ng", "openai", "elevenlabs"].find(
        (provider) => chain.some((entry) => entry.provider === provider),
      ) ?? chain[0]?.provider
    );
  }
  if (category === "IMAGE") {
    return (
      ["pexels", "procedural"].find((provider) =>
        chain.some((entry) => entry.provider === provider),
      ) ?? chain[0]?.provider
    );
  }
  return chain[0]?.provider;
}

export async function estimateGenerationCost(
  ctx: Context,
  userId: string,
  settings: {
    preferredLlmProvider?: string | null;
    preferredTtsProvider?: string | null;
    preferredVisualProvider?: string | null;
    preferredVideoProvider?: string | null;
    maxHostedVideoCalls: number;
    usdToInrRate: number;
    taxPercent: number;
    feePercent: number;
    localOnly: boolean;
  },
  options: {
    targetDurationSeconds: number;
    visualStyle?: string | null;
  },
): Promise<GenerationEstimate> {
  const target = options.targetDurationSeconds;
  const sceneCount = Math.max(4, Math.min(12, Math.round(target / 8)));
  const lines: EstimateLine[] = [];
  const assumptions: string[] = [
    `Estimated ${sceneCount} scenes for ${target}s.`,
    "Actual narration length, provider usage, and scene count may differ.",
  ];

  const categories: Array<{
    category: ProviderCategory;
    provider: string;
    unit: string;
    units: number;
    label: string;
    model?: string;
    quoteInputs?: Record<string, unknown>;
  }> = [];

  const llmChain = await resolveProviderChain(
    ctx,
    userId,
    "LLM",
    settings.preferredLlmProvider,
    { localOnly: settings.localOnly },
  );
  const llmProvider = providerForCategory(settings, "LLM", llmChain);
  const llmResolved = llmChain.find((entry) => entry.provider === llmProvider);
  const llmModel =
    typeof llmResolved?.config.model === "string"
      ? llmResolved.config.model
      : llmProvider === "openai-compatible"
        ? "gpt-4o-mini"
        : llmProvider === "ollama"
          ? "llama3.2:3b"
          : undefined;
  const estimatedTokens = Math.round(target * 55) + 1200;
  const llmUnit =
    llmProvider && ["openai-compatible"].includes(llmProvider)
      ? "1k_tokens"
      : "request";
  categories.push({
    category: "LLM",
    provider: llmProvider ?? "template",
    unit: llmUnit,
    units:
      llmProvider === "openai-compatible"
        ? Math.ceil(estimatedTokens / 1000)
        : 1,
    label: "Script generation",
    model: llmModel,
  });

  const ttsChain = await resolveProviderChain(
    ctx,
    userId,
    "TTS",
    settings.preferredTtsProvider,
    { localOnly: settings.localOnly },
  );
  const ttsProvider = providerForCategory(settings, "TTS", ttsChain);
  const ttsResolved = ttsChain.find((entry) => entry.provider === ttsProvider);
  const ttsModel =
    typeof ttsResolved?.config.model === "string"
      ? ttsResolved.config.model
      : undefined;
  const estimatedCharacters = Math.round(target * 15);
  categories.push({
    category: "TTS",
    provider: ttsProvider ?? "macos-say",
    unit: "character",
    units: estimatedCharacters,
    label: "Narration",
    model: ttsModel,
  });

  const imageChain = await resolveProviderChain(
    ctx,
    userId,
    "IMAGE",
    settings.preferredVisualProvider,
    { localOnly: settings.localOnly },
  );
  const imageProvider = providerForCategory(
    settings,
    "IMAGE",
    imageChain,
  );
  const imageResolved = imageChain.find(
    (entry) => entry.provider === imageProvider,
  );
  const imageModel =
    typeof imageResolved?.config.model === "string"
      ? imageResolved.config.model
      : imageProvider === "fal"
        ? DEFAULT_KEYFRAME_MODEL
        : imageProvider === "wavespeed"
          ? "wavespeed-ai/z-image/turbo"
          : undefined;
  categories.push({
    category: "IMAGE",
    provider: imageProvider ?? "procedural",
    unit: "image",
    units: sceneCount,
    label: "Scene visuals",
    model: imageModel,
  });

  const wantsHostedVideo =
    settings.maxHostedVideoCalls > 0 &&
    settings.preferredVideoProvider !== undefined &&
    settings.preferredVideoProvider !== null &&
    settings.preferredVideoProvider !== "" &&
    settings.preferredVideoProvider !== "none" &&
    settings.preferredVideoProvider !== "auto";
  if (wantsHostedVideo) {
    const chain = await resolveProviderChain(
      ctx,
      userId,
      "TEXT_TO_VIDEO",
      settings.preferredVideoProvider,
      { localOnly: settings.localOnly },
    );
    const provider = providerForCategory(
      settings,
      "TEXT_TO_VIDEO",
      chain,
    );
    const resolved = chain.find((entry) => entry.provider === provider);
    const model =
      typeof resolved?.config.imageToVideoModel === "string"
        ? resolved.config.imageToVideoModel
        : provider === "fal"
          ? DEFAULT_IMAGE_TO_VIDEO_MODEL
          : provider === "wavespeed"
            ? "pixverse/pixverse-v5.5/image-to-video"
            : undefined;
    const seconds = settings.maxHostedVideoCalls * 5;
    categories.push({
      category: "TEXT_TO_VIDEO",
      provider: provider ?? "fal",
      unit: "second",
      units: seconds,
      label: "Hosted AI video clips",
      model,
      quoteInputs: {
        duration: 5,
        aspect_ratio: "9:16",
      },
    });
    categories.push({
      category: "IMAGE",
      provider: provider ?? "fal",
      unit: "image",
      units: settings.maxHostedVideoCalls,
      label: "Video keyframes",
      model:
        typeof resolved?.config.keyframeModel === "string"
          ? resolved.config.keyframeModel
          : provider === "fal"
            ? DEFAULT_KEYFRAME_MODEL
            : imageModel,
    });
    assumptions.push(
      `Hosted AI video is limited to ${settings.maxHostedVideoCalls} clip(s) of ~5s, each animated from one cheap keyframe.`,
    );
  }

  for (const item of categories) {
    if (item.units <= 0) continue;
    const unitPrice = await getUnitPrice(
      ctx,
      userId,
      item.provider,
      item.category,
      item.model,
      item.unit,
      item.quoteInputs,
    );
    const amountUsd = item.units * unitPrice.unitPriceUsd;
    lines.push({
      label: item.label,
      provider: item.provider,
      category: item.category,
      model: item.model,
      unit: item.unit,
      units: item.units,
      unitPriceUsd: unitPrice.unitPriceUsd,
      amountUsd,
      amountInrPaise: usdToPaise(
        amountUsd,
        settings.usdToInrRate,
        settings.taxPercent,
        settings.feePercent,
      ),
      pricingSource: unitPrice.source,
      sourceUrl: unitPrice.sourceUrl,
    });
    if (unitPrice.source === "unknown" && item.units > 0) {
      assumptions.push(
        `${item.label}: pricing is not configured for ${item.provider}${item.model ? ` / ${item.model}` : ""}. Add a price in Settings or use a local provider.`,
      );
    }
  }

  const estimatedCostUsd = lines.reduce((sum, line) => sum + line.amountUsd, 0);
  const estimatedCostInrPaise = lines.reduce(
    (sum, line) => sum + line.amountInrPaise,
    0,
  );
  return {
    lines,
    estimatedCostUsd,
    estimatedCostInrPaise,
    usdToInrRate: settings.usdToInrRate,
    taxPercent: settings.taxPercent,
    feePercent: settings.feePercent,
    unknownPricing: lines.some(
      (line) => line.pricingSource === "unknown" && line.units > 0,
    ),
    assumptions,
  };
}
