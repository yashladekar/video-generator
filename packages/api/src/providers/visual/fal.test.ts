import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { falImageProvider } from "./fal";
import { testCallContext, testProvider } from "../../test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fal.ai image adapter", () => {
  it("submits, polls, downloads, and returns a request id", async () => {
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 20, g: 40, b: 90 },
      },
    })
      .png()
      .toBuffer();

    let statusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/fal-ai/flux/schnell") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              request_id: "req-1",
              status_url:
                "https://queue.fal.run/fal-ai/flux/schnell/requests/req-1/status",
              response_url:
                "https://queue.fal.run/fal-ai/flux/schnell/requests/req-1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/status")) {
          statusCalls += 1;
          return new Response(JSON.stringify({ status: "COMPLETED" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/requests/req-1")) {
          return new Response(
            JSON.stringify({
              images: [{ url: "https://cdn.example.com/image.png" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://cdn.example.com/image.png") {
          return new Response(png, {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = testProvider("fal", "IMAGE", {
      model: "fal-ai/flux/schnell",
      baseUrl: "https://queue.fal.run",
    });
    provider.secrets.apiKey = "test-key";

    const result = await falImageProvider.generateImage(
      {
        prompt: "a calm ocean",
        width: 108,
        height: 192,
      },
      provider,
      testCallContext(),
    );

    expect(statusCalls).toBeGreaterThanOrEqual(1);
    expect(result.requestId).toBe("req-1");
    expect(result.provider).toBe("fal");
    expect(result.image.byteLength).toBeGreaterThan(0);
    expect(result.width).toBe(108);
    expect(result.height).toBe(192);
  });
});
