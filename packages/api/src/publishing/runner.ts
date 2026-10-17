import type { Context } from "../context";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { PublishingError } from "../lib/errors";
import { cleanupDir, createTempDir } from "../lib/fs";
import { toJsonValue } from "../lib/json";
import {
  createStorageService,
  materializeAsset,
  providerCallContextForStorage,
} from "../providers/storage";
import {
  uploadYouTubeVideo,
  type YouTubeCredentials,
} from "../providers/publishing/youtube";

export async function runPublishingJob(params: {
  ctx: Context;
  jobId: string;
}): Promise<void> {
  const { ctx, jobId } = params;
  const job = await ctx.db.publishingJob.findUnique({
    where: { id: jobId },
    include: {
      publishingAccount: true,
      renderedVideo: { include: { videoAsset: true } },
      project: true,
    },
  });
  if (!job) throw new PublishingError("PUBLISH_JOB_NOT_FOUND", "Publishing job not found");
  if (["PUBLISHED", "CANCELLED", "EXPORTED"].includes(job.status)) return;

  if (job.platform !== "YOUTUBE") {
    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: {
        status: "NEEDS_ATTENTION",
        errorCode: "MANUAL_PLATFORM",
        errorMessage:
          "This platform is supported through manual export only. Download the video and upload it in the platform app.",
        completedAt: new Date(),
      },
    });
    return;
  }

  if (!job.publishingAccount) {
    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "YOUTUBE_NOT_CONNECTED",
        errorMessage:
          "Connect a YouTube account in Settings before publishing.",
        completedAt: new Date(),
      },
    });
    return;
  }

  await ctx.db.publishingJob.update({
    where: { id: job.id },
    data: {
      status: "UPLOADING",
      startedAt: new Date(),
      attempt: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    },
  });

  const tempDir = await createTempDir(`publish-${job.id.slice(0, 8)}-`);
  try {
    if (job.renderedVideo.kind !== "FINAL") {
      throw new PublishingError(
        "FINAL_RENDER_REQUIRED",
        "Only a final render can be published. Render the final video first.",
      );
    }
    const storage = await createStorageService(
      ctx,
      job.userId,
      providerCallContextForStorage(ctx, job.userId),
    );
    const videoPath = await materializeAsset(
      storage,
      job.renderedVideo.videoAsset.storageKey,
      tempDir,
      "publish.mp4",
    );
    const credentials = JSON.parse(
      decryptSecret(
        job.publishingAccount.encryptedCredentials,
        ctx.env.APP_ENCRYPTION_KEY,
      ),
    ) as YouTubeCredentials;
    if (!credentials.refreshToken) {
      throw new PublishingError(
        "YOUTUBE_REFRESH_TOKEN_MISSING",
        "The YouTube account is missing a refresh token. Reconnect the account.",
      );
    }
    const description = [job.caption.trim(), job.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")]
      .filter(Boolean)
      .join("\n\n");
    const result = await uploadYouTubeVideo(
      {
        filePath: videoPath,
        title: job.title,
        description,
        tags: job.hashtags,
        privacyStatus: job.privacyStatus as "public" | "unlisted" | "private",
        scheduledAt: job.scheduledAt ?? undefined,
      },
      credentials,
      {
        env: ctx.env,
        signal: AbortSignal.timeout(30 * 60 * 1000),
        logger: ctx.logger,
        userId: job.userId,
      },
    );

    if (result.refreshedTokens) {
      const updated: YouTubeCredentials = {
        ...credentials,
        accessToken: result.refreshedTokens.accessToken,
        accessTokenExpiresAt: result.refreshedTokens.expiresAt,
        scope: result.refreshedTokens.scope ?? credentials.scope,
      };
      await ctx.db.publishingAccount.update({
        where: { id: job.publishingAccount.id },
        data: {
          encryptedCredentials: encryptSecret(
            JSON.stringify(updated),
            ctx.env.APP_ENCRYPTION_KEY,
          ),
          tokenExpiresAt: result.refreshedTokens.expiresAt
            ? new Date(result.refreshedTokens.expiresAt)
            : undefined,
        },
      });
    }

    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: {
        status: "PUBLISHED",
        completedAt: new Date(),
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        errorCode: null,
        errorMessage: null,
        metadata: toJsonValue({ uploadedAt: new Date().toISOString() }),
      },
    });
    await ctx.db.notification.create({
      data: {
        userId: job.userId,
        type: "PUBLISH_SUCCEEDED",
        title: "Published to YouTube",
        body: job.title,
        link: "/publishing",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : String(error);
    await ctx.db.publishingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode:
          error instanceof PublishingError
            ? error.code
            : "PUBLISH_FAILED",
        errorMessage: message,
      },
    });
    await ctx.db.notification.create({
      data: {
        userId: job.userId,
        type: "PUBLISH_FAILED",
        title: "Publishing failed",
        body: message,
        link: "/publishing",
      },
    });
  } finally {
    await cleanupDir(tempDir);
  }
}
