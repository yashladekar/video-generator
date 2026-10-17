import { protectedProcedure, router } from "../index";
import {
  approveVideoSchema,
  regenerateSceneSchema,
  regenerateVoiceoverSchema,
  reorderScenesSchema,
  replaceVisualSchema,
  sceneUpdateSchema,
  updateCaptionStyleSchema,
  updateMusicSchema,
} from "../schemas/script";
import { projectIdSchema } from "../schemas/project";
import { assetDto } from "../services/assets";
import { createRegenerateSceneJob } from "../services/generation";
import {
  approveRenderedVideo,
  getStudioData,
  replaceSceneVisual,
  reorderScenes,
  updateCaptionStyle,
  updateMusic,
  updateScene,
} from "../services/studio";

export const studioRouter = router({
  get: protectedProcedure
    .input(projectIdSchema)
    .query(async ({ ctx, input }) => {
      const data = await getStudioData(
        ctx,
        ctx.session.user.id,
        input.projectId,
      );
      return {
        ...data,
        assets: data.assets.map((asset) => assetDto(asset, ctx.env)),
        subtitleAsset: data.subtitleAsset
          ? assetDto(data.subtitleAsset, ctx.env)
          : null,
        script: data.script
          ? {
              ...data.script,
              scenes: data.script.scenes.map((scene) => ({
                ...scene,
                visualAsset: scene.visualAsset
                  ? assetDto(scene.visualAsset, ctx.env)
                  : null,
                narrationAsset: scene.narrationAsset
                  ? assetDto(scene.narrationAsset, ctx.env)
                  : null,
                clipAsset: scene.clipAsset
                  ? assetDto(scene.clipAsset, ctx.env)
                  : null,
              })),
            }
          : null,
        renderedVideos: data.renderedVideos.map((render) => ({
          ...render,
          videoAsset: assetDto(render.videoAsset, ctx.env),
          thumbnailAsset: render.thumbnailAsset
            ? assetDto(render.thumbnailAsset, ctx.env)
            : null,
        })),
      };
    }),
  updateScene: protectedProcedure
    .input(sceneUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return updateScene(ctx, ctx.session.user.id, input);
    }),
  reorderScenes: protectedProcedure
    .input(reorderScenesSchema)
    .mutation(async ({ ctx, input }) => {
      return reorderScenes(ctx, ctx.session.user.id, input);
    }),
  replaceVisual: protectedProcedure
    .input(replaceVisualSchema)
    .mutation(async ({ ctx, input }) => {
      return replaceSceneVisual(ctx, ctx.session.user.id, input);
    }),
  regenerateScene: protectedProcedure
    .input(regenerateSceneSchema)
    .mutation(async ({ ctx, input }) => {
      return createRegenerateSceneJob(ctx, ctx.session.user.id, {
        sceneId: input.sceneId,
        parts: input.parts,
        idempotencyKey: input.idempotencyKey,
      });
    }),
  regenerateVoiceover: protectedProcedure
    .input(regenerateVoiceoverSchema)
    .mutation(async ({ ctx, input }) => {
      return createRegenerateSceneJob(ctx, ctx.session.user.id, {
        sceneId: input.sceneId,
        parts: ["narration"],
        idempotencyKey: input.idempotencyKey,
      });
    }),
  approveVideo: protectedProcedure
    .input(approveVideoSchema)
    .mutation(async ({ ctx, input }) => {
      return approveRenderedVideo(ctx, ctx.session.user.id, input);
    }),
  updateCaptionStyle: protectedProcedure
    .input(updateCaptionStyleSchema)
    .mutation(async ({ ctx, input }) => {
      return updateCaptionStyle(ctx, ctx.session.user.id, input);
    }),
  updateMusic: protectedProcedure
    .input(updateMusicSchema)
    .mutation(async ({ ctx, input }) => {
      return updateMusic(ctx, ctx.session.user.id, input);
    }),
});
