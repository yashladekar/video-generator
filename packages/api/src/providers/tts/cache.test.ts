import { describe, expect, it, vi } from "vitest";

import {
  findCachedNarration,
  legacyNarrationCacheKey,
  narrationCacheKey,
  narrationCacheKeys,
  normalizeSpeed,
} from "./cache";

const base = {
  text: "Solar panels turn sunlight into electricity.",
  voice: "Samantha",
  language: "en",
  speed: 1,
  provider: "openai",
  format: "wav",
};

describe("narration content-hash caching", () => {
  it("is stable for identical script text and voice parameters", () => {
    expect(narrationCacheKey({ ...base })).toBe(narrationCacheKey({ ...base }));
  });

  it("ignores whitespace-only differences in the script text", () => {
    expect(narrationCacheKey(base)).toBe(
      narrationCacheKey({ ...base, text: "  Solar panels turn   sunlight into electricity. " }),
    );
  });

  it("changes when the spoken text or voice parameters change", () => {
    expect(narrationCacheKey(base)).not.toBe(
      narrationCacheKey({ ...base, text: `${base.text} Extra.` }),
    );
    expect(narrationCacheKey(base)).not.toBe(
      narrationCacheKey({ ...base, voice: "Alex" }),
    );
    expect(narrationCacheKey(base)).not.toBe(
      narrationCacheKey({ ...base, speed: 1.1 }),
    );
    expect(narrationCacheKey(base)).not.toBe(
      narrationCacheKey({ ...base, provider: "elevenlabs" }),
    );
    expect(narrationCacheKey(base)).not.toBe(
      narrationCacheKey({ ...base, format: "mp3" }),
    );
  });

  it("normalizes tempo so the speed-up pass reuses its own stem", () => {
    expect(normalizeSpeed(undefined)).toBe(1);
    expect(normalizeSpeed(1.04001)).toBe(1.04);
    expect(narrationCacheKey({ ...base, speed: 1.04001 })).toBe(
      narrationCacheKey({ ...base, speed: 1.04 }),
    );
  });

  it("offers the legacy key as a fallback so upgrades never re-pay for audio", () => {
    const params = {
      text: base.text,
      voice: base.voice,
      language: base.language,
      speed: 1,
    };
    const keys = narrationCacheKeys(base, { preferredProvider: "auto" });
    expect(keys[0]).toBe(narrationCacheKey(base));
    expect(keys).toContain(legacyNarrationCacheKey(params, { preferredProvider: "auto" }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("scopes regenerated narration away from the shared cache", () => {
    const params = {
      text: base.text,
      voice: base.voice,
      language: base.language,
      speed: 1,
    };
    expect(legacyNarrationCacheKey(params, { regenerate: "job-1" })).not.toBe(
      legacyNarrationCacheKey(params, {}),
    );
  });

  it("returns the first ready stem across primary and legacy keys", async () => {
    const keys = narrationCacheKeys(base, { preferredProvider: "auto" });
    const findUnique = vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
      if (where.cacheKey === keys[1]) {
        return { id: "asset-1", status: "READY", durationSeconds: 4.2 };
      }
      return null;
    });
    const found = await findCachedNarration({ findUnique }, keys);
    expect(found).toEqual({
      id: "asset-1",
      durationSeconds: 4.2,
      cacheKey: keys[1],
    });
  });

  it("does not reuse a stem that is not ready", async () => {
    const findUnique = vi.fn(async () => ({
      id: "asset-1",
      status: "FAILED",
      durationSeconds: null,
    }));
    expect(
      await findCachedNarration({ findUnique }, narrationCacheKeys(base)),
    ).toBeNull();
  });
});
