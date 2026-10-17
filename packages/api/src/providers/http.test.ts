import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchBuffer,
  fetchJson,
  joinUrl,
  parseJsonLoose,
  stripJsonFences,
} from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider HTTP helpers", () => {
  it("parses a successful JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req-1" },
        }),
      ),
    );
    const result = await fetchJson<{ ok: boolean }>(
      "https://example.com/api",
      {},
      {
        provider: "test",
        signal: new AbortController().signal,
        requestIdHeader: "x-request-id",
      },
    );
    expect(result.data.ok).toBe(true);
    expect(result.requestId).toBe("req-1");
  });

  it("classifies 5xx as a transient provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("server error", { status: 500 }),
      ),
    );
    await expect(
      fetchJson("https://example.com/api", {}, {
        provider: "test",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      kind: "PROVIDER_TRANSIENT",
      status: 500,
    });
  });

  it("classifies unknown outcomes when a request id exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("gateway error", {
          status: 502,
          headers: { "x-request-id": "req-unknown" },
        }),
      ),
    );
    await expect(
      fetchJson("https://example.com/api", {}, {
        provider: "test",
        signal: new AbortController().signal,
        requestIdHeader: "x-request-id",
      }),
    ).rejects.toMatchObject({
      kind: "PROVIDER_UNKNOWN_OUTCOME",
      requestId: "req-unknown",
    });
  });

  it("rejects invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>nope</html>", { status: 200 })),
    );
    await expect(
      fetchJson("https://example.com/api", {}, {
        provider: "test",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_BAD_JSON" });
  });

  it("downloads a buffer and respects content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
      ),
    );
    const result = await fetchBuffer(
      "https://example.com/video.mp4",
      {},
      { provider: "test", signal: new AbortController().signal },
    );
    expect(result.data.byteLength).toBe(3);
    expect(result.mimeType).toBe("video/mp4");
  });

  it("joins URLs without duplicate slashes", () => {
    expect(joinUrl("https://example.com/", "/v1/chat")).toBe(
      "https://example.com/v1/chat",
    );
  });

  it("strips JSON code fences and parses loose JSON", () => {
    expect(stripJsonFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(parseJsonLoose("prefix {\"a\":1} suffix")).toEqual({ a: 1 });
  });
});
