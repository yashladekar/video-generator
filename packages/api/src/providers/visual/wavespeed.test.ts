import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { ProviderError } from "../../lib/errors";
import { testCallContext, testProvider } from "../../test/helpers";
import {
  getWaveSpeedPriceQuote,
  waveSpeedImageProvider,
} from "./wavespeed";

vi.mock("../media-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media-helpers")>();
  return {
    ...actual,
    sleepWithSignal: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function samplePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 30, g: 60, b: 120 },
    },
  })
    .png()
    .toBuffer();
}

describe("WaveSpeedAI adapter", () => {
  it("submits, polls, downloads, and returns the task id", async () => {
    const png = await samplePng();
    let submitted: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/wavespeed-ai/z-image/turbo") &&
          init?.method === "POST"
        ) {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({ code: 200, data: { id: "task-1" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/predictions/task-1/result")) {
          return new Response(
            JSON.stringify({
              code: 200,
              data: {
                status: "completed",
                outputs: ["https://cdn.example.com/result.png"],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://cdn.example.com/result.png") {
          return new Response(png, {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = testProvider("wavespeed", "IMAGE", {
      model: "wavespeed-ai/z-image/turbo",
      baseUrl: "https://api.wavespeed.ai/api/v3",
    });
    provider.secrets.apiKey = "test-key";
    const ctx = testCallContext();

    const result = await waveSpeedImageProvider.generateImage(
      { prompt: "a deep ocean", width: 108, height: 192 },
      provider,
      ctx,
    );

    expect(submitted).toEqual({ prompt: "a deep ocean" });
    expect(result.requestId).toBe("task-1");
    expect(result.provider).toBe("wavespeed");
    expect(result.width).toBe(108);
    expect(result.height).toBe(192);
    expect(result.image.byteLength).toBeGreaterThan(0);
  });

  it("returns a price quote when the provider supplies one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        expect(String(input)).toBe(
          "https://api.wavespeed.ai/api/v3/model/price",
        );
        return new Response(
          JSON.stringify({
            code: 200,
            data: { price: 0.05, discounted_price: 0.04, currency: "USD" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const provider = testProvider("wavespeed", "IMAGE", {
      baseUrl: "https://api.wavespeed.ai/api/v3",
    });
    provider.secrets.apiKey = "test-key";

    await expect(
      getWaveSpeedPriceQuote(
        "pixverse/pixverse-v5.5/text-to-video",
        { duration: 5 },
        provider,
        testCallContext(),
      ),
    ).resolves.toEqual({
      priceUsd: 0.05,
      discountedPriceUsd: 0.04,
      currency: "USD",
    });
  });

  it("rejects when no API key is configured", async () => {
    const provider = testProvider("wavespeed", "IMAGE", {
      model: "wavespeed-ai/z-image/turbo",
    });

    await expect(
      waveSpeedImageProvider.generateImage(
        { prompt: "test", width: 108, height: 192 },
        provider,
        testCallContext(),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH" } satisfies Partial<ProviderError>);
  });
});
