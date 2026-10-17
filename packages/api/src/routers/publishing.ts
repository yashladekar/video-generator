import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { idSchema } from "../schemas/common";
import {
  connectAccountInputSchema,
  createPublishingJobInputSchema,
  disconnectAccountInputSchema,
  manualExportInputSchema,
  publishingJobIdSchema,
  setupRequirementsInputSchema,
} from "../schemas/publishing";
import {
  cancelPublishingJob,
  createPublishingJob,
  createYouTubeConnectUrl,
  disconnectPublishingAccount,
  listPublishingAccounts,
  listPublishingJobs,
  listReadyVideos,
  retryPublishingJob,
  setupRequirements,
  testPublishingAccount,
} from "../services/publishing";
import { assetDto } from "../services/assets";

export const publishingRouter = router({
  ready: protectedProcedure.query(async ({ ctx }) => {
    const videos = await listReadyVideos(ctx, ctx.session.user.id);
    return videos.map((video) => ({
      ...video,
      videoAsset: assetDto(video.videoAsset, ctx.env),
      thumbnailAsset: video.thumbnailAsset
        ? assetDto(video.thumbnailAsset, ctx.env)
        : null,
    }));
  }),
  accounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return listPublishingAccounts(ctx, ctx.session.user.id);
    }),
    connectUrl: protectedProcedure
      .input(connectAccountInputSchema)
      .query(async ({ ctx }) => {
        return {
          url: createYouTubeConnectUrl(ctx, ctx.session.user.id),
        };
      }),
    disconnect: protectedProcedure
      .input(disconnectAccountInputSchema)
      .mutation(async ({ ctx, input }) => {
        return disconnectPublishingAccount(
          ctx,
          ctx.session.user.id,
          input.accountId,
        );
      }),
    test: protectedProcedure
      .input(z.object({ accountId: idSchema }))
      .mutation(async ({ ctx, input }) => {
        return testPublishingAccount(
          ctx,
          ctx.session.user.id,
          input.accountId,
        );
      }),
  }),
  jobs: router({
    create: protectedProcedure
      .input(createPublishingJobInputSchema)
      .mutation(async ({ ctx, input }) => {
        return createPublishingJob(ctx, ctx.session.user.id, input);
      }),
    list: protectedProcedure.query(async ({ ctx }) => {
      const jobs = await listPublishingJobs(ctx, ctx.session.user.id);
      return jobs.map((job) => ({
        ...job,
        renderedVideo: job.renderedVideo
          ? {
              ...job.renderedVideo,
              videoAsset: assetDto(job.renderedVideo.videoAsset, ctx.env),
              thumbnailAsset: job.renderedVideo.thumbnailAsset
                ? assetDto(job.renderedVideo.thumbnailAsset, ctx.env)
                : null,
            }
          : null,
      }));
    }),
    cancel: protectedProcedure
      .input(publishingJobIdSchema)
      .mutation(async ({ ctx, input }) => {
        return cancelPublishingJob(
          ctx,
          ctx.session.user.id,
          input.publishingJobId,
        );
      }),
    retry: protectedProcedure
      .input(publishingJobIdSchema)
      .mutation(async ({ ctx, input }) => {
        return retryPublishingJob(
          ctx,
          ctx.session.user.id,
          input.publishingJobId,
        );
      }),
  }),
  export: protectedProcedure
    .input(manualExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      return createPublishingJob(ctx, ctx.session.user.id, {
        renderedVideoId: input.renderedVideoId,
        platform: input.platform,
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        privacyStatus: "private",
        idempotencyKey: input.idempotencyKey,
      });
    }),
  setup: protectedProcedure
    .input(setupRequirementsInputSchema)
    .query(({ input }) => setupRequirements(input.platform)),
});
