import type { Context } from "../context";
import { createOAuthState, decryptSecret } from "../lib/crypto";
import {
  NotFoundError,
  PublishingError,
  ValidationError,
} from "../lib/errors";
import { toJsonValue } from "../lib/json";
import { buildYouTubeAuthUrl, testYouTubeConnection } from "../providers/publishing/youtube";
import type { YouTubeCredentials } from "../providers/publishing/youtube";
import { assetDto } from "./assets";

const YOUTUBE_SETUP = [
  "Create a Google Cloud project.",
  "Enable the YouTube Data API v3.",
  "Configure the OAuth consent screen and add the scope https://www.googleapis.com/auth/youtube.upload.",
  "Create an OAuth 2.0 Client ID of type Web application.",
  "Add the redirect URI that matches YOUTUBE_REDIRECT_URI (default: http://localhost:3000/api/oauth/youtube/callback).",
  "Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI on the server.",
  "Add your Google account as a test user while the app is in testing mode.",
  "Connect the account from Settings → Publishing.",
  "Check the current YouTube API upload quota; uploads are limited per day.",
];

const INSTAGRAM_SETUP = [
  "Instagram Reels publishing requires an Instagram Business or Creator account linked to a Facebook Page.",
  "Create a Meta app and request the instagram_basic, instagram_content_publish, pages_show_list, and business_management permissions.",
  "Complete Meta app review and business verification before publishing to accounts you do not own.",
  "This build intentionally provides manual export for Instagram; download the MP4 and upload it in the Instagram app.",
];

const TIKTOK_SETUP = [
  "Create a TikTok for Developers app and request the Content Posting API (video.publish scope).",
  "Complete TikTok app review/audit and verify your domain before direct posting is enabled.",
  "This build intentionally provides manual export for TikTok; download the MP4 and upload it in the TikTok app.",
];

export function setupRequirements(platform: string) {
  if (platform === "YOUTUBE") {
    return {
      platform,
      supported: true,
      steps: YOUTUBE_SETUP,
      docs: "https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol",
      notes:
        "The app sets status.containsSyntheticMedia=true and defaults to private visibility. Scheduled uploads are sent as private with publishAt.",
    };
  }
  if (platform === "INSTAGRAM_REELS") {
    return {
      platform,
      supported: false,
      steps: INSTAGRAM_SETUP,
      docs: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
      notes: "Manual export only in this build. Never marked as published.",
    };
  }
  if (platform === "TIKTOK") {
    return {
      platform,
      supported: false,
      steps: TIKTOK_SETUP,
      docs: "https://developers.tiktok.com/doc/content-posting-api-get-started",
      notes: "Manual export only in this build. Never marked as published.",
    };
  }
  return {
    platform: "MANUAL",
    supported: true,
    steps: [
      "Download the final MP4 and SRT.",
      "Upload the video manually in the target platform.",
      "The app records this as EXPORTED, not PUBLISHED.",
    ],
    docs: null,
    notes: "Manual export does not call a platform API.",
  };
}

export async function listPublishingAccounts(ctx: Context, userId: string) {
  const accounts = await ctx.db.publishingAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return accounts.map((account) => ({
    id: account.id,
    platform: account.platform,
    accountName: account.accountName,
    externalAccountId: account.externalAccountId,
    scopes: account.scopes,
    tokenExpiresAt: account.tokenExpiresAt,
    status: account.status,
    createdAt: account.createdAt,
  }));
}

export function createYouTubeConnectUrl(ctx: Context, userId: string) {
  const state = createOAuthState(userId, ctx.env.MEDIA_SIGNING_SECRET);
  return buildYouTubeAuthUrl(state, ctx.env);
}

export async function disconnectPublishingAccount(
  ctx: Context,
  userId: string,
  accountId: string,
) {
  const account = await ctx.db.publishingAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new NotFoundError("Publishing account not found");
  await ctx.db.publishingAccount.delete({ where: { id: account.id } });
  await ctx.db.auditLog.create({
    data: {
      userId,
      action: "publishing_account.disconnected",
      entityType: "PublishingAccount",
      entityId: account.id,
      metadata: toJsonValue({ platform: account.platform }),
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.userAgent,
    },
  });
  return { ok: true };
}

export async function testPublishingAccount(
  ctx: Context,
  userId: string,
  accountId: string,
) {
  const account = await ctx.db.publishingAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new NotFoundError("Publishing account not found");
  if (account.platform !== "YOUTUBE") {
    return {
      ok: false,
      message: "Only YouTube accounts can be tested; other platforms use manual export.",
    };
  }
  const credentials = JSON.parse(
    decryptSecret(account.encryptedCredentials, ctx.env.APP_ENCRYPTION_KEY),
  ) as YouTubeCredentials;
  return testYouTubeConnection(credentials, {
    env: ctx.env,
    signal: AbortSignal.timeout(30_000),
    logger: ctx.logger,
    userId,
  });
}

async function requireFinalRender(
  ctx: Context,
  userId: string,
  renderedVideoId: string,
) {
  const render = await ctx.db.renderedVideo.findFirst({
    where: { id: renderedVideoId, userId },
    include: { videoAsset: true, project: true },
  });
  if (!render) throw new NotFoundError("Rendered video not found");
  if (render.kind !== "FINAL") {
    throw new ValidationError(
      "Only a final render can be published. Render the final video first.",
    );
  }
  if (render.status !== "COMPLETED") {
    throw new ValidationError("The final render is not completed");
  }
  return render;
}

export async function createPublishingJob(
  ctx: Context,
  userId: string,
  input: {
    renderedVideoId: string;
    platform: "YOUTUBE" | "INSTAGRAM_REELS" | "TIKTOK" | "MANUAL";
    title: string;
    caption: string;
    hashtags: string[];
    scheduledAt?: Date;
    privacyStatus: "public" | "unlisted" | "private";
    publishingAccountId?: string;
    idempotencyKey: string;
  },
) {
  const existing = await ctx.db.publishingJob.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    const render = await ctx.db.renderedVideo.findFirst({
      where: { id: existing.renderedVideoId },
      include: { videoAsset: true },
    });
    return {
      job: existing,
      downloadUrl: render?.videoAsset
        ? `${assetDto(render.videoAsset, ctx.env).url}?download=1`
        : null,
    };
  }

  const render = await requireFinalRender(ctx, userId, input.renderedVideoId);
  const scheduledAt = input.scheduledAt ?? new Date();
  const isManual = input.platform !== "YOUTUBE";

  if (isManual) {
    const job = await ctx.db.publishingJob.create({
      data: {
        userId,
        projectId: render.projectId,
        renderedVideoId: render.id,
        platform: input.platform,
        status: "EXPORTED",
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        privacyStatus: input.privacyStatus,
        scheduledAt: input.scheduledAt,
        completedAt: new Date(),
        idempotencyKey: input.idempotencyKey,
        metadata: toJsonValue({
          manualExport: true,
          note: "Downloaded for manual publishing; this is not a platform publish.",
        }),
      },
    });
    await ctx.db.auditLog.create({
      data: {
        userId,
        action: "publishing.manual_export",
        entityType: "PublishingJob",
        entityId: job.id,
        metadata: toJsonValue({ platform: input.platform }),
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.userAgent,
      },
    });
    return {
      job,
      downloadUrl: `${assetDto(render.videoAsset, ctx.env).url}?download=1`,
      setup: setupRequirements(input.platform),
    };
  }

  const account = input.publishingAccountId
    ? await ctx.db.publishingAccount.findFirst({
        where: { id: input.publishingAccountId, userId, platform: "YOUTUBE" },
      })
    : await ctx.db.publishingAccount.findFirst({
        where: { userId, platform: "YOUTUBE" },
        orderBy: { createdAt: "desc" },
      });
  if (!account) {
    throw new PublishingError(
      "YOUTUBE_NOT_CONNECTED",
      "Connect a YouTube account in Settings → Publishing before publishing. If you have not configured the OAuth app, see the setup requirements.",
      setupRequirements("YOUTUBE"),
    );
  }

  const job = await ctx.db.publishingJob.create({
    data: {
      userId,
      projectId: render.projectId,
      renderedVideoId: render.id,
      publishingAccountId: account.id,
      platform: "YOUTUBE",
      status: "SCHEDULED",
      title: input.title,
      caption: input.caption,
      hashtags: input.hashtags,
      privacyStatus: input.privacyStatus,
      scheduledAt,
      idempotencyKey: input.idempotencyKey,
      metadata: toJsonValue({ syntheticMediaDisclosure: true }),
    },
  });

  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
  const enqueued = await ctx.dispatcher.enqueuePublishing(job.id, {
    attempts: job.maxAttempts,
    delayMs,
  });
  if (enqueued.bullJobId) {
    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: { bullJobId: enqueued.bullJobId },
    });
  }
  await ctx.db.auditLog.create({
    data: {
      userId,
      action: "publishing.youtube_scheduled",
      entityType: "PublishingJob",
      entityId: job.id,
      metadata: toJsonValue({
        scheduledAt: scheduledAt.toISOString(),
        privacyStatus: input.privacyStatus,
      }),
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.userAgent,
    },
  });
  return {
    job: await ctx.db.publishingJob.findUniqueOrThrow({ where: { id: job.id } }),
    downloadUrl: `${assetDto(render.videoAsset, ctx.env).url}?download=1`,
    setup: setupRequirements("YOUTUBE"),
  };
}

export async function listReadyVideos(ctx: Context, userId: string) {
  return ctx.db.renderedVideo.findMany({
    where: { userId, kind: "FINAL", status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      project: { select: { id: true, title: true } },
      videoAsset: true,
      thumbnailAsset: true,
      publishingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

export async function listPublishingJobs(
  ctx: Context,
  userId: string,
  limit = 50,
) {
  return ctx.db.publishingJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: { select: { id: true, title: true } },
      renderedVideo: { include: { videoAsset: true, thumbnailAsset: true } },
    },
  });
}

export async function cancelPublishingJob(
  ctx: Context,
  userId: string,
  jobId: string,
) {
  const job = await ctx.db.publishingJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) throw new NotFoundError("Publishing job not found");
  if (job.status === "UPLOADING") {
    throw new ValidationError(
      "The upload is already in progress and cannot be cancelled safely.",
    );
  }
  if (["PUBLISHED", "CANCELLED", "EXPORTED"].includes(job.status)) return job;
  if (job.bullJobId) {
    await ctx.dispatcher
      .cancelQueued("publishing", job.bullJobId)
      .catch(() => undefined);
  }
  return ctx.db.publishingJob.update({
    where: { id: job.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}

export async function retryPublishingJob(
  ctx: Context,
  userId: string,
  jobId: string,
) {
  const job = await ctx.db.publishingJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) throw new NotFoundError("Publishing job not found");
  if (job.status !== "FAILED") {
    throw new ValidationError("Only failed publishing jobs can be retried");
  }
  const updated = await ctx.db.publishingJob.update({
    where: { id: job.id },
    data: {
      status: "SCHEDULED",
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    },
  });
  const enqueued = await ctx.dispatcher.enqueuePublishing(job.id, {
    attempts: job.maxAttempts,
  });
  if (enqueued.bullJobId) {
    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: { bullJobId: enqueued.bullJobId },
    });
  }
  return updated;
}
