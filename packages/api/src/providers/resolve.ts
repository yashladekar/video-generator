import type { ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { decryptSecret } from "../lib/crypto";
import { isPaidProvider } from "./catalog";
import type { ResolvedProvider } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseSecrets(
  encrypted: string | null,
  encryptionKey: string,
): Record<string, string> {
  if (!encrypted) return {};
  try {
    const parsed = JSON.parse(
      decryptSecret(encrypted, encryptionKey),
    ) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function envProvider(
  category: ProviderCategory,
  provider: string,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): ResolvedProvider {
  return {
    provider,
    category,
    config,
    secrets,
    source: "env",
    enabled: true,
    isDefault: false,
  };
}

function builtinProvider(
  category: ProviderCategory,
  provider: string,
  config: Record<string, unknown> = {},
): ResolvedProvider {
  return {
    provider,
    category,
    config,
    secrets: {},
    source: "builtin",
    enabled: true,
    isDefault: false,
  };
}

function addFromEnv(
  ctx: Context,
  category: ProviderCategory,
  add: (provider: ResolvedProvider) => void,
) {
  const env = ctx.env;
  if (category === "LLM" && env.OPENAI_API_KEY) {
    add(
      envProvider(
        category,
        "openai-compatible",
        {
          baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
          model: "gpt-4o-mini",
        },
        { apiKey: env.OPENAI_API_KEY },
      ),
    );
  }
  if (category === "TTS" && env.OPENAI_API_KEY) {
    add(
      envProvider(
        category,
        "openai",
        { model: "tts-1", voice: "alloy" },
        { apiKey: env.OPENAI_API_KEY },
      ),
    );
  }
  if (category === "TTS" && env.ELEVENLABS_API_KEY) {
    add(
      envProvider(
        category,
        "elevenlabs",
        { modelId: "eleven_multilingual_v2" },
        { apiKey: env.ELEVENLABS_API_KEY },
      ),
    );
  }
  if (category === "RESEARCH" && env.TAVILY_API_KEY) {
    add(
      envProvider(
        category,
        "tavily",
        { maxResults: 5 },
        { apiKey: env.TAVILY_API_KEY },
      ),
    );
  }
  if (
    (category === "IMAGE" || category === "TEXT_TO_VIDEO") &&
    env.PEXELS_API_KEY
  ) {
    add(
      envProvider(category, "pexels", {}, { apiKey: env.PEXELS_API_KEY }),
    );
  }
  if ((category === "IMAGE" || category === "TEXT_TO_VIDEO") && env.FAL_KEY) {
    add(
      envProvider(
        category,
        "fal",
        {
          model:
            category === "IMAGE"
              ? "fal-ai/flux/schnell"
              : "fal-ai/wan/v2.2-5b/text-to-video",
        },
        { apiKey: env.FAL_KEY },
      ),
    );
  }
  if (
    (category === "IMAGE" || category === "TEXT_TO_VIDEO") &&
    env.WAVESPEED_API_KEY
  ) {
    add(
      envProvider(
        category,
        "wavespeed",
        {
          model:
            category === "IMAGE"
              ? "wavespeed-ai/z-image/turbo"
              : "pixverse/pixverse-v5.5/text-to-video",
        },
        { apiKey: env.WAVESPEED_API_KEY },
      ),
    );
  }
  if (
    (category === "IMAGE" || category === "TEXT_TO_VIDEO") &&
    env.COMFYUI_BASE_URL
  ) {
    add(
      envProvider(
        category,
        "comfyui",
        { baseUrl: env.COMFYUI_BASE_URL },
        {},
      ),
    );
  }
  if (category === "PUBLISHING" && env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET) {
    add(
      envProvider(
        category,
        "youtube",
        { redirectUri: env.YOUTUBE_REDIRECT_URI },
        {
          clientId: env.YOUTUBE_CLIENT_ID,
          clientSecret: env.YOUTUBE_CLIENT_SECRET,
        },
      ),
    );
  }
  if (category === "STORAGE" && env.S3_BUCKET) {
    add(
      envProvider(
        category,
        "s3",
        {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          forcePathStyle: env.S3_FORCE_PATH_STYLE ?? false,
        },
        {
          accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
        },
      ),
    );
  }
}

function addBuiltins(
  category: ProviderCategory,
  add: (provider: ResolvedProvider) => void,
) {
  if (category === "LLM") {
    add(builtinProvider(category, "ollama", {
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2:3b",
    }));
    add(builtinProvider(category, "template", { model: "rule-based" }));
  }
  if (category === "TTS") {
    add(builtinProvider(category, "macos-say", { voice: "Samantha" }));
    add(builtinProvider(category, "espeak-ng", { voice: "en" }));
    add(builtinProvider(category, "piper", {}));
  }
  if (category === "RESEARCH") {
    add(builtinProvider(category, "wikipedia", {}));
  }
  if (category === "IMAGE") {
    add(builtinProvider(category, "procedural", { style: "cinematic" }));
  }
  if (category === "MUSIC") {
    add(builtinProvider(category, "music-generator", { mood: "ambient" }));
  }
  if (category === "STORAGE") {
    add(builtinProvider(category, "local", {}));
  }
}

export async function resolveProviderChain(
  ctx: Context,
  userId: string,
  category: ProviderCategory,
  preferred?: string | null,
  options?: { localOnly?: boolean },
): Promise<ResolvedProvider[]> {
  const rows = await ctx.db.providerConfiguration.findMany({
    where: {
      userId,
      category,
      enabled: true,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const seen = new Set<string>();
  const chain: ResolvedProvider[] = [];
  const add = (provider: ResolvedProvider) => {
    const key = `${provider.category}:${provider.provider}`;
    if (seen.has(key)) return;
    seen.add(key);
    chain.push(provider);
  };

  for (const row of rows) {
    add({
      provider: row.provider,
      category: row.category,
      config: asRecord(row.config),
      secrets: parseSecrets(
        row.encryptedSecret,
        ctx.env.APP_ENCRYPTION_KEY,
      ),
      source: "user",
      enabled: row.enabled,
      isDefault: row.isDefault,
    });
  }

  addFromEnv(ctx, category, add);
  addBuiltins(category, add);

  let filtered = options?.localOnly
    ? chain.filter((entry) => !isPaidProvider(entry.provider))
    : chain;

  if (preferred && preferred !== "auto") {
    const index = filtered.findIndex(
      (entry) => entry.provider === preferred,
    );
    if (index > 0) {
      const [chosen] = filtered.splice(index, 1);
      if (chosen) filtered = [chosen, ...filtered];
    }
  }

  if (filtered.length === 0) {
    if (category === "LLM") {
      filtered = [builtinProvider(category, "template", { model: "rule-based" })];
    } else {
      throw new Error(`No provider available for category ${category}`);
    }
  }

  return filtered;
}

export async function resolveSingleProvider(
  ctx: Context,
  userId: string,
  category: ProviderCategory,
  preferred?: string | null,
  options?: { localOnly?: boolean },
): Promise<ResolvedProvider> {
  const chain = await resolveProviderChain(ctx, userId, category, preferred, options);
  const first = chain[0];
  if (!first) {
    throw new Error(`No provider available for category ${category}`);
  }
  return first;
}

export function configString(
  resolved: ResolvedProvider,
  key: string,
  fallback?: string,
): string | undefined {
  const value = resolved.config[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function configNumber(
  resolved: ResolvedProvider,
  key: string,
  fallback?: number,
): number | undefined {
  const value = resolved.config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function configBoolean(
  resolved: ResolvedProvider,
  key: string,
  fallback = false,
): boolean {
  const value = resolved.config[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function secretValue(
  resolved: ResolvedProvider,
  key: string,
  envValue?: string,
): string | undefined {
  return resolved.secrets[key] || envValue;
}
