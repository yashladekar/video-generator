import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { testCallContext, testProvider } from "../../test/helpers";
import { falImageProvider, falVideoProvider, falVideoModelFor, toDataUri } from "./fal";
import {
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  DEFAULT_KEYFRAME_MODEL,
  DEFAULT_TEXT_TO_VIDEO_MODEL,
} from "./model-tiers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("fal.ai image-to-video adapter", () => {
  it("defaults text-to-video requests to the cheap tier and no keyframe", () => {
    const resolved = testProvider("fal", "TEXT_TO_VIDEO", {});
    expect(
      falVideoModelFor(
        {
          prompt: "a calm ocean",
          durationSeconds: 5,
          aspectRatio: "9:16",
          width: 1080,
          height: 1920,
        },
        resolved,
      ),
    ).toBe(DEFAULT_TEXT_TO_VIDEO_MODEL);
  });

  it("switches to the turbo image-to-video model when a keyframe is supplied", () => {
    const resolved = testProvider("fal", "TEXT_TO_VIDEO", {});
    expect(
      falVideoModelFor(
        {
          prompt: "a calm ocean",
          durationSeconds: 5,
          aspectRatio: "9:16",
          width: 1080,
          height: 1920,
          image: { data: Buffer.from("jpeg"), mimeType: "image/jpeg" },
        },
        resolved,
      ),
    ).toBe(DEFAULT_IMAGE_TO_VIDEO_MODEL);
  });

  it("lets an explicit imageToVideoModel override the tier default", () => {
    const resolved = testProvider("fal", "TEXT_TO_VIDEO", {
      imageToVideoModel: "fal-ai/wan/v2.2-5b/image-to-video",
    });
    expect(
      falVideoModelFor(
        {
          prompt: "x",
          durationSeconds: 5,
          aspectRatio: "9:16",
          width: 720,
          height: 1280,
          image: { data: Buffer.from("jpeg"), mimeType: "image/jpeg" },
        },
        resolved,
      ),
    ).toBe("fal-ai/wan/v2.2-5b/image-to-video");
  });

  it("sends the keyframe as a data URI to the turbo endpoint", async () => {
    const mp4 = Buffer.from("fake-mp4-bytes");
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.endsWith(`/${DEFAULT_IMAGE_TO_VIDEO_MODEL}`) && init?.method === "POST") {
          return jsonResponse({
            request_id: "req-i2v",
            status_url: `https://queue.fal.run/${DEFAULT_IMAGE_TO_VIDEO_MODEL}/requests/req-i2v/status`,
            response_url: `https://queue.fal.run/${DEFAULT_IMAGE_TO_VIDEO_MODEL}/requests/req-i2v`,
          });
        }
        if (url.includes("/status")) {
          return jsonResponse({ status: "COMPLETED" });
        }
        if (url.endsWith("/requests/req-i2v")) {
          return jsonResponse({ video: { url: "https://cdn.example.com/clip.mp4" } });
        }
        if (url === "https://cdn.example.com/clip.mp4") {
          return new Response(mp4, {
            status: 200,
            headers: { "content-type": "video/mp4" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = testProvider("fal", "TEXT_TO_VIDEO", {
      baseUrl: "https://queue.fal.run",
    });
    provider.secrets.apiKey = "test-key";

    const result = await falVideoProvider.generateVideo(
      {
        prompt: "a calm ocean at sunrise",
        durationSeconds: 5,
        aspectRatio: "9:16",
        width: 1080,
        height: 1920,
        image: { data: Buffer.from("keyframe-bytes"), mimeType: "image/jpeg" },
      },
      provider,
      testCallContext(),
    );

    expect(result.provider).toBe("fal");
    expect(result.requestId).toBe("req-i2v");
    expect(result.usage?.metadata?.mode).toBe("image-to-video");
    expect(result.video.byteLength).toBe(mp4.byteLength);

    const submit = requests.find(
      (request) => request.url.endsWith(`/${DEFAULT_IMAGE_TO_VIDEO_MODEL}`),
    );
    const body = submit?.body as { prompt: string; image_url: string };
    expect(body.prompt).toBe("a calm ocean at sunrise");
    expect(body.image_url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(body.image_url).toContain(
      Buffer.from("keyframe-bytes").toString("base64"),
    );
  });

  it("keeps the cheap keyframe model as the image default", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith(`/${DEFAULT_KEYFRAME_MODEL}`) && init?.method === "POST") {
          return jsonResponse({
            request_id: "req-img",
            status_url: `https://queue.fal.run/${DEFAULT_KEYFRAME_MODEL}/requests/req-img/status`,
            response_url: `https://queue.fal.run/${DEFAULT_KEYFRAME_MODEL}/requests/req-img`,
          });
        }
        if (url.includes("/status")) return jsonResponse({ status: "COMPLETED" });
        if (url.endsWith("/requests/req-img")) {
          return jsonResponse({ images: [{ url: "https://cdn.example.com/k.png" }] });
        }
        if (url === "https://cdn.example.com/k.png") {
          return new Response(png, {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const provider = testProvider("fal", "IMAGE", {
      baseUrl: "https://queue.fal.run",
    });
    provider.secrets.apiKey = "test-key";

    await falImageProvider.generateImage(
      { prompt: "a calm ocean", width: 64, height: 64 },
      provider,
      testCallContext(),
    );

    expect(urls).toContain(`https://queue.fal.run/${DEFAULT_KEYFRAME_MODEL}`);
  });

  it("builds a data URI that preserves the declared mime type", () => {
    const uri = toDataUri(Buffer.from("abc"), "image/webp");
    expect(uri).toBe("data:image/webp;base64,YWJj");
  });
});
