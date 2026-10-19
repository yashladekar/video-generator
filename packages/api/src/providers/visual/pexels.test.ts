import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { testCallContext, testProvider } from "../../test/helpers";
import { pexelsImageProvider } from "./pexels";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Pexels image adapter", () => {
  it("searches, downloads, resizes, and records attribution", async () => {
    const png = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 3,
        background: { r: 10, g: 80, b: 70 },
      },
    })
      .png()
      .toBuffer();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "api.pexels.com") {
          expect(url.searchParams.get("query")).toBe("deep ocean");
          expect(url.searchParams.get("orientation")).toBe("portrait");
          expect(url.searchParams.get("per_page")).toBe("8");
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "pexels-key",
          );
          return new Response(
            JSON.stringify({
              photos: [
                {
                  id: 1,
                  width: 1200,
                  height: 1800,
                  url: "https://www.pexels.com/photo/1",
                  photographer: "Ada",
                  photographer_url: "https://www.pexels.com/@ada",
                  src: {
                    original: "https://images.pexels.com/photos/1/original.jpg",
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.hostname === "images.pexels.com") {
          return new Response(png, {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = testProvider("pexels", "IMAGE");
    provider.secrets.apiKey = "pexels-key";

    const result = await pexelsImageProvider.generateImage(
      { prompt: "deep ocean", width: 108, height: 192 },
      provider,
      testCallContext(),
    );

    expect(result.provider).toBe("pexels");
    expect(result.width).toBe(108);
    expect(result.height).toBe(192);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.image.byteLength).toBeGreaterThan(0);
    expect(result.attribution).toContain("Photo by Ada on Pexels");
  });

  it("rejects when no Pexels key is configured", async () => {
    await expect(
      pexelsImageProvider.generateImage(
        { prompt: "ocean", width: 108, height: 192 },
        testProvider("pexels", "IMAGE"),
        testCallContext(),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
});
