import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PublishingError } from "../../lib/errors";
import { testCallContext } from "../../test/helpers";
import {
  buildYouTubeAuthUrl,
  exchangeYouTubeCode,
  getYouTubeChannel,
  uploadYouTubeVideo,
  YOUTUBE_SCOPE,
} from "./youtube";

const oauthEnv = {
  YOUTUBE_CLIENT_ID: "client-id",
  YOUTUBE_CLIENT_SECRET: "client-secret",
  YOUTUBE_REDIRECT_URI: "http://localhost:3000/api/publishing/youtube/callback",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("YouTube OAuth and upload adapter", () => {
  it("builds the documented authorization URL", () => {
    const url = new URL(buildYouTubeAuthUrl("state-123", oauthEnv));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(oauthEnv.YOUTUBE_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("refuses to build a URL without client configuration", () => {
    expect(() =>
      buildYouTubeAuthUrl("state", {
        YOUTUBE_CLIENT_ID: undefined,
        YOUTUBE_REDIRECT_URI: undefined,
      }),
    ).toThrow(PublishingError);
  });

  it("exchanges an authorization code for tokens", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("client_id")).toBe("client-id");
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: YOUTUBE_SCOPE,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeYouTubeCode("auth-code", oauthEnv);
    expect(tokens.accessToken).toBe("access-token");
    expect(tokens.refreshToken).toBe("refresh-token");
    expect(tokens.scope).toBe(YOUTUBE_SCOPE);
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("reads the connected channel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [{ id: "channel-1", snippet: { title: "Test Channel" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(getYouTubeChannel("access-token")).resolves.toEqual({
      channelId: "channel-1",
      channelName: "Test Channel",
    });
  });

  it("uploads with resumable chunks and marks synthetic media", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-adapter-"));
    const filePath = path.join(dir, "reel.mp4");
    await writeFile(filePath, Buffer.alloc(32, 7));
    let startPayload: Record<string, unknown> | null = null;
    let uploadCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("upload/youtube/v3/videos")) {
          startPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(null, {
            status: 200,
            headers: { location: "https://upload.example.com/session" },
          });
        }
        if (url === "https://upload.example.com/session") {
          uploadCalls += 1;
          if (uploadCalls === 1) {
            return new Response(null, {
              status: 308,
              headers: { range: "bytes=0-15" },
            });
          }
          return new Response(JSON.stringify({ id: "video-123" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected upload URL: ${url}`);
      }),
    );

    try {
      const result = await uploadYouTubeVideo(
        {
          filePath,
          title: "A test reel",
          description: "Description",
          tags: ["test"],
          privacyStatus: "public",
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        {
          refreshToken: "refresh-token",
          accessToken: "access-token",
          accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
        },
        testCallContext(),
      );

      expect(result.externalPostId).toBe("video-123");
      expect(result.externalUrl).toBe("https://www.youtube.com/watch?v=video-123");
      expect(uploadCalls).toBe(2);
      const status = (
        startPayload as unknown as { status: Record<string, unknown> }
      ).status;
      expect(status.containsSyntheticMedia).toBe(true);
      expect(status.privacyStatus).toBe("private");
      expect(status.publishAt).toBeTruthy();
      expect(status.selfDeclaredMadeForKids).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
