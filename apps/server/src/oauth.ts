import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { createOAuthState, encryptSecret, verifyOAuthState } from "@video-generator/api/lib/crypto";
import { toJsonValue } from "@video-generator/api/lib/json";
import {
  buildYouTubeAuthUrl,
  exchangeYouTubeCode,
  getYouTubeChannel,
  YOUTUBE_SCOPE,
} from "@video-generator/api/providers/publishing/youtube";

import { ENV } from "./env.server";
import { auth, db, logger } from "./services";

function settingsRedirect(params: Record<string, string>): string {
  const url = new URL("/settings", ENV.CORS_ORIGIN);
  url.searchParams.set("tab", "publishing");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function startYouTubeOAuth(req: Request, res: Response) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    res.redirect(`${ENV.CORS_ORIGIN}/login?next=/settings`);
    return;
  }
  if (!ENV.YOUTUBE_CLIENT_ID || !ENV.YOUTUBE_CLIENT_SECRET || !ENV.YOUTUBE_REDIRECT_URI) {
    res.redirect(
      settingsRedirect({
        youtube: "error",
        message:
          "YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI on the server.",
      }),
    );
    return;
  }
  const state = createOAuthState(
    session.user.id,
    ENV.MEDIA_SIGNING_SECRET,
  );
  const url = buildYouTubeAuthUrl(state, ENV);
  res.redirect(url);
}

export async function youtubeOAuthCallback(req: Request, res: Response) {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  if (error) {
    res.redirect(settingsRedirect({ youtube: "error", message: error }));
    return;
  }
  if (!code || !state) {
    res.redirect(
      settingsRedirect({
        youtube: "error",
        message: "YouTube did not return an authorization code.",
      }),
    );
    return;
  }
  const verified = verifyOAuthState(state, ENV.MEDIA_SIGNING_SECRET);
  if (!verified) {
    res.redirect(
      settingsRedirect({
        youtube: "error",
        message: "The OAuth state is invalid or expired. Try connecting again.",
      }),
    );
    return;
  }

  try {
    const tokens = await exchangeYouTubeCode(code, ENV);
    const channel = await getYouTubeChannel(tokens.accessToken);
    if (!tokens.refreshToken) {
      throw new Error(
        "Google did not return a refresh token. Remove the app's prior consent and reconnect with prompt=consent.",
      );
    }
    const credentials = {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
      channelId: channel.channelId,
      channelName: channel.channelName,
      scope: tokens.scope ?? YOUTUBE_SCOPE,
    };
    await db.publishingAccount.upsert({
      where: {
        userId_platform_externalAccountId: {
          userId: verified.userId,
          platform: "YOUTUBE",
          externalAccountId: channel.channelId,
        },
      },
      update: {
        accountName: channel.channelName,
        encryptedCredentials: encryptSecret(
          JSON.stringify(credentials),
          ENV.APP_ENCRYPTION_KEY,
        ),
        scopes: (tokens.scope ?? YOUTUBE_SCOPE).split(/\s+/).filter(Boolean),
        tokenExpiresAt: tokens.expiresAt
          ? new Date(tokens.expiresAt)
          : undefined,
        status: "CONNECTED",
        metadata: toJsonValue({ connectedAt: new Date().toISOString() }),
      },
      create: {
        userId: verified.userId,
        platform: "YOUTUBE",
        accountName: channel.channelName,
        externalAccountId: channel.channelId,
        encryptedCredentials: encryptSecret(
          JSON.stringify(credentials),
          ENV.APP_ENCRYPTION_KEY,
        ),
        scopes: (tokens.scope ?? YOUTUBE_SCOPE).split(/\s+/).filter(Boolean),
        tokenExpiresAt: tokens.expiresAt
          ? new Date(tokens.expiresAt)
          : undefined,
        status: "CONNECTED",
        metadata: toJsonValue({ connectedAt: new Date().toISOString() }),
      },
    });
    await db.auditLog.create({
      data: {
        userId: verified.userId,
        action: "publishing_account.connected",
        entityType: "PublishingAccount",
        entityId: channel.channelId,
        metadata: toJsonValue({ platform: "YOUTUBE", channelName: channel.channelName }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });
    res.redirect(
      settingsRedirect({
        youtube: "connected",
        channel: channel.channelName,
      }),
    );
  } catch (callbackError) {
    logger.error({ error: callbackError }, "YouTube OAuth callback failed");
    res.redirect(
      settingsRedirect({
        youtube: "error",
        message:
          callbackError instanceof Error
            ? callbackError.message
            : "YouTube connection failed",
      }),
    );
  }
}
