import { openAsBlob } from "node:fs";

import { PublishingError, ProviderError } from "../../lib/errors";
import type { ProviderCallContext } from "../types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export type YouTubeTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
};

export type YouTubeCredentials = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  channelId?: string;
  channelName?: string;
  scope?: string;
};

export function buildYouTubeAuthUrl(
  state: string,
  env: Pick<
    ProviderCallContext["env"],
    "YOUTUBE_CLIENT_ID" | "YOUTUBE_REDIRECT_URI"
  >,
): string {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_REDIRECT_URI) {
    throw new PublishingError(
      "YOUTUBE_NOT_CONFIGURED",
      "Set YOUTUBE_CLIENT_ID and YOUTUBE_REDIRECT_URI on the server before connecting YouTube.",
    );
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env.YOUTUBE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.YOUTUBE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function postToken(
  params: Record<string, string>,
  _provider: string,
): Promise<YouTubeTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new PublishingError(
      "YOUTUBE_TOKEN_ERROR",
      `YouTube OAuth token request failed (${response.status}): ${text.slice(0, 600)}`,
    );
  }
  const data = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new PublishingError(
      "YOUTUBE_TOKEN_ERROR",
      "YouTube OAuth token response did not include an access token",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    scope: data.scope,
  };
}

export async function exchangeYouTubeCode(
  code: string,
  env: Pick<
    ProviderCallContext["env"],
    | "YOUTUBE_CLIENT_ID"
    | "YOUTUBE_CLIENT_SECRET"
    | "YOUTUBE_REDIRECT_URI"
  >,
): Promise<YouTubeTokens> {
  if (
    !env.YOUTUBE_CLIENT_ID ||
    !env.YOUTUBE_CLIENT_SECRET ||
    !env.YOUTUBE_REDIRECT_URI
  ) {
    throw new PublishingError(
      "YOUTUBE_NOT_CONFIGURED",
      "YouTube OAuth client credentials and redirect URI are not configured.",
    );
  }
  return postToken(
    {
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.YOUTUBE_REDIRECT_URI,
    },
    "youtube",
  );
}

export async function refreshYouTubeAccessToken(
  refreshToken: string,
  env: Pick<ProviderCallContext["env"], "YOUTUBE_CLIENT_ID" | "YOUTUBE_CLIENT_SECRET">,
): Promise<YouTubeTokens> {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    throw new PublishingError(
      "YOUTUBE_NOT_CONFIGURED",
      "YouTube OAuth client credentials are not configured.",
    );
  }
  return postToken(
    {
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    "youtube",
  );
}

export async function getYouTubeChannel(
  accessToken: string,
): Promise<{ channelId: string; channelName: string }> {
  const response = await fetch(CHANNELS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new PublishingError(
      "YOUTUBE_CHANNEL_ERROR",
      `Could not read the YouTube channel (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  const data = JSON.parse(text) as {
    items?: Array<{
      id?: string;
      snippet?: { title?: string };
    }>;
  };
  const item = data.items?.[0];
  if (!item?.id) {
    throw new PublishingError(
      "YOUTUBE_CHANNEL_ERROR",
      "No YouTube channel is associated with this account",
    );
  }
  return {
    channelId: item.id,
    channelName: item.snippet?.title ?? "YouTube channel",
  };
}

async function getAccessToken(
  credentials: YouTubeCredentials,
  env: ProviderCallContext["env"],
): Promise<{ accessToken: string; refreshed?: YouTubeTokens }> {
  if (
    credentials.accessToken &&
    credentials.accessTokenExpiresAt &&
    credentials.accessTokenExpiresAt > Date.now() + 60_000
  ) {
    return { accessToken: credentials.accessToken };
  }
  const refreshed = await refreshYouTubeAccessToken(
    credentials.refreshToken,
    env,
  );
  return { accessToken: refreshed.accessToken, refreshed };
}

export async function uploadYouTubeVideo(
  input: {
    filePath: string;
    title: string;
    description: string;
    tags: string[];
    privacyStatus: "public" | "unlisted" | "private";
    scheduledAt?: Date;
  },
  credentials: YouTubeCredentials,
  ctx: ProviderCallContext,
): Promise<{
  externalPostId: string;
  externalUrl: string;
  refreshedTokens?: YouTubeTokens;
}> {
  const { accessToken, refreshed } = await getAccessToken(credentials, ctx.env);
  const blob = await openAsBlob(input.filePath, { type: "video/mp4" });
  const scheduled =
    input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 60_000;
  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 5000),
      tags: input.tags.slice(0, 30),
      categoryId: "22",
    },
    status: {
      privacyStatus: scheduled ? "private" : input.privacyStatus,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      ...(scheduled
        ? { publishAt: input.scheduledAt!.toISOString() }
        : {}),
    },
  };

  const start = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(blob.size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(60_000),
  });
  const startText = await start.text();
  if (!start.ok) {
    throw new PublishingError(
      "YOUTUBE_UPLOAD_START_FAILED",
      `YouTube upload session failed (${start.status}): ${startText.slice(0, 700)}`,
    );
  }
  const location = start.headers.get("location");
  if (!location) {
    throw new PublishingError(
      "YOUTUBE_UPLOAD_START_FAILED",
      "YouTube did not return a resumable upload URL",
    );
  }

  let offset = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const chunk = blob.slice(offset);
    const response = await fetch(location, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": String(chunk.size),
        "Content-Type": "video/mp4",
        ...(offset > 0
          ? {
              "Content-Range": `bytes ${offset}-${blob.size - 1}/${blob.size}`,
            }
          : {}),
      },
      body: chunk,
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });

    if (response.status === 200 || response.status === 201) {
      const text = await response.text();
      const data = JSON.parse(text) as { id?: string };
      if (!data.id) {
        throw new PublishingError(
          "YOUTUBE_UPLOAD_FAILED",
          "YouTube upload completed without a video id",
        );
      }
      return {
        externalPostId: data.id,
        externalUrl: `https://www.youtube.com/watch?v=${data.id}`,
        refreshedTokens: refreshed,
      };
    }

    if (response.status === 308) {
      const range = response.headers.get("range");
      if (range) {
        const match = /bytes=0-(\d+)/.exec(range);
        if (match?.[1]) {
          offset = Number(match[1]) + 1;
          continue;
        }
      }
      // No range yet: retry from the beginning.
      offset = 0;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    const text = await response.text();
    throw new PublishingError(
      "YOUTUBE_UPLOAD_FAILED",
      `YouTube upload failed (${response.status}): ${text.slice(0, 700)}`,
    );
  }

  throw new PublishingError(
    "YOUTUBE_UPLOAD_FAILED",
    "YouTube did not accept the video after multiple resume attempts",
  );
}

export async function testYouTubeConnection(
  credentials: YouTubeCredentials,
  ctx: ProviderCallContext,
): Promise<{ ok: boolean; message: string; channelName?: string }> {
  try {
    const { accessToken } = await getAccessToken(credentials, ctx.env);
    const channel = await getYouTubeChannel(accessToken);
    return {
      ok: true,
      message: `Connected to ${channel.channelName}`,
      channelName: channel.channelName,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "YouTube connection failed",
    };
  }
}

export function assertYouTubeConfigured(env: ProviderCallContext["env"]): void {
  if (
    !env.YOUTUBE_CLIENT_ID ||
    !env.YOUTUBE_CLIENT_SECRET ||
    !env.YOUTUBE_REDIRECT_URI
  ) {
    throw new ProviderError(
      "YOUTUBE_NOT_CONFIGURED",
      "YouTube publishing requires YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI.",
      { provider: "youtube", kind: "PROVIDER_PERMANENT" },
    );
  }
}
