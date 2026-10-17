import { describe, expect, it } from "vitest";

import { hashCacheKey, sanitizeFilename, stableStringify } from "./hash";

describe("hashing and idempotency keys", () => {
  it("stable-stringifies objects regardless of key order", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it("produces stable cache keys for equivalent inputs", () => {
    const a = hashCacheKey({ provider: "fal", prompt: "ocean", width: 1080 });
    const b = hashCacheKey({ width: 1080, prompt: "ocean", provider: "fal" });
    const c = hashCacheKey({ provider: "fal", prompt: "ocean", width: 720 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("sanitizes uploaded filenames", () => {
    expect(sanitizeFilename("../../my file?.png")).toBe("my-file-.png");
  });
});
