import { hashCacheKey } from "../../lib/hash";

export type NarrationCacheParams = {
  text: string;
  voice?: string | null;
  language?: string | null;
  speed?: number;
  provider?: string | null;
  model?: string | null;
  format?: string;
};

export type NarrationCacheOptions = {
  preferredProvider?: string | null;
  regenerate?: string | null;
};

export const NARRATION_CACHE_VERSION = 2;

export function normalizeSpeed(speed?: number): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1;
  return Math.round(Math.max(0.5, Math.min(2, speed)) * 100) / 100;
}

function normalizeKey(params: NarrationCacheParams): Record<string, unknown> {
  return {
    version: NARRATION_CACHE_VERSION,
    type: "narration",
    text: params.text.replace(/\s+/g, " ").trim(),
    voice: params.voice ?? null,
    language: params.language ?? null,
    speed: normalizeSpeed(params.speed),
    provider: params.provider ?? null,
    model: params.model ?? null,
    format: params.format ?? "wav",
  };
}

/**
 * Content hash for a narration stem. Any change to the spoken text, voice,
 * language, tempo, provider, or output format produces a new key; everything
 * else (project, job, scene order) is deliberately excluded so identical lines
 * are synthesized once and reused everywhere.
 */
export function narrationCacheKey(params: NarrationCacheParams): string {
  return hashCacheKey(normalizeKey(params));
}

/**
 * Cache keys used before {@link NARRATION_CACHE_VERSION}. Kept as a read-only
 * fallback so upgrading the cache layout never forces a duplicate paid TTS call.
 */
export function legacyNarrationCacheKey(
  params: Pick<NarrationCacheParams, "text" | "voice" | "language" | "speed">,
  options: NarrationCacheOptions = {},
): string {
  const key: Record<string, unknown> = {
    type: "narration",
    text: params.text,
    voice: params.voice ?? undefined,
    language: params.language,
    preferredProvider: options.preferredProvider ?? "auto",
    speed: params.speed === undefined ? 1 : params.speed,
  };
  if (options.regenerate) key.regenerate = options.regenerate;
  return hashCacheKey(key);
}

export function narrationCacheKeys(
  params: NarrationCacheParams,
  options: NarrationCacheOptions = {},
): string[] {
  const keys = [narrationCacheKey(params)];
  const legacy = legacyNarrationCacheKey(params, options);
  if (!keys.includes(legacy)) keys.push(legacy);
  return keys;
}

export type NarrationCacheRecord = {
  id: string;
  status: string;
  durationSeconds: number | null;
};

export type NarrationCacheLookup = {
  findUnique(args: { where: { cacheKey: string } }): Promise<unknown>;
};

export type CachedNarration = {
  id: string;
  durationSeconds: number | null;
  cacheKey: string;
};

function isReadyNarration(value: unknown): value is NarrationCacheRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const duration = record.durationSeconds;
  return (
    typeof record.id === "string" &&
    record.status === "READY" &&
    (duration === null || duration === undefined || typeof duration === "number")
  );
}

export async function findCachedNarration(
  db: NarrationCacheLookup,
  keys: string[],
): Promise<CachedNarration | null> {
  for (const key of keys) {
    const asset = await db.findUnique({ where: { cacheKey: key } });
    if (!isReadyNarration(asset)) continue;
    return {
      id: asset.id,
      durationSeconds: asset.durationSeconds ?? null,
      cacheKey: key,
    };
  }
  return null;
}

export function narrationUnits(text: string): number {
  return text.length;
}
