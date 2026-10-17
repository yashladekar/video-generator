import type { StepType } from "@video-generator/db";

import { protectedProcedure, router } from "../index";
import {
  cancelJobInputSchema,
  estimateGenerationInputSchema,
  jobIdSchema,
  jobListInputSchema,
  renderInputSchema,
  retryJobInputSchema,
  reconcileJobInputSchema,
  startGenerationInputSchema,
} from "../schemas/generation";
import { assetDto } from "../services/assets";
import {
  cancelJob,
  estimateForProject,
  getJob,
  listJobs,
  retryJob,
  startGeneration,
  startRenderJob,
} from "../services/generation";
import { reconcileJob } from "../services/reconcile";

type AssetLike = Parameters<typeof assetDto>[0];
type RenderLike = {
  videoAsset: AssetLike;
  thumbnailAsset: AssetLike | null;
} & Record<string, unknown>;

function serializeJob<T extends object>(
  job: T,
  env: Parameters<typeof assetDto>[1],
) {
  const value = job as T & { renderedVideos?: RenderLike[] };
  return {
    ...job,
    ...(value.renderedVideos
      ? {
          renderedVideos: value.renderedVideos.map((render) => ({
            ...render,
            videoAsset: assetDto(render.videoAsset, env),
            thumbnailAsset: render.thumbnailAsset
              ? assetDto(render.thumbnailAsset, env)
              : null,
          })),
        }
      : {}),
  };
}

export const generationRouter = router({
  estimate: protectedProcedure
    .input(estimateGenerationInputSchema)
    .query(async ({ ctx, input }) => {
      return estimateForProject(
        ctx,
        ctx.session.user.id,
        input.projectId,
        input.overrides,
      );
    }),
  start: protectedProcedure
    .input(startGenerationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await startGeneration(ctx, ctx.session.user.id, input);
      return serializeJob(job, ctx.env);
    }),
  getJob: protectedProcedure
    .input(jobIdSchema)
    .query(async ({ ctx, input }) => {
      const job = await getJob(ctx, ctx.session.user.id, input.jobId);
      return serializeJob(job, ctx.env);
    }),
  list: protectedProcedure
    .input(jobListInputSchema)
    .query(async ({ ctx, input }) => {
      return listJobs(ctx, ctx.session.user.id, input);
    }),
  cancel: protectedProcedure
    .input(cancelJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      return cancelJob(ctx, ctx.session.user.id, input.jobId);
    }),
  retry: protectedProcedure
    .input(retryJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      return retryJob(
        ctx,
        ctx.session.user.id,
        input.jobId,
        input.fromStep as StepType | undefined,
      );
    }),
  reconcile: protectedProcedure
    .input(reconcileJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      return reconcileJob(ctx, ctx.session.user.id, input.jobId);
    }),
  render: protectedProcedure
    .input(renderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return startRenderJob(ctx, ctx.session.user.id, {
        projectId: input.projectId,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
      });
    }),
  preview: protectedProcedure
    .input(renderInputSchema.omit({ kind: true }))
    .mutation(async ({ ctx, input }) => {
      return startRenderJob(ctx, ctx.session.user.id, {
        projectId: input.projectId,
        kind: "PREVIEW",
        idempotencyKey: input.idempotencyKey,
      });
    }),
  final: protectedProcedure
    .input(renderInputSchema.omit({ kind: true }))
    .mutation(async ({ ctx, input }) => {
      return startRenderJob(ctx, ctx.session.user.id, {
        projectId: input.projectId,
        kind: "FINAL",
        idempotencyKey: input.idempotencyKey,
      });
    }),
});
