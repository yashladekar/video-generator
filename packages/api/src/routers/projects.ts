import { protectedProcedure, router } from "../index";
import {
  createProjectWithBudgetInputSchema,
  duplicateProjectInputSchema,
  projectIdSchema,
  projectListInputSchema,
  renameProjectInputSchema,
  setThumbnailInputSchema,
  updateProjectInputSchema,
} from "../schemas/project";
import { assetDto } from "../services/assets";
import {
  archiveProject,
  createDraftProject,
  duplicateProject,
  getProjectDetail,
  listProjects,
  purgeProject,
  renameProject,
  restoreProject,
  setProjectThumbnail,
  softDeleteProject,
  updateProject,
} from "../services/projects";

type AssetLike = Parameters<typeof assetDto>[0];
type SerializableProject = {
  assets?: AssetLike[];
  thumbnailAsset?: AssetLike | null;
};

function serializeProject<T extends object>(
  project: T,
  env: Parameters<typeof assetDto>[1],
) {
  const value = project as T & SerializableProject;
  return {
    ...project,
    ...(value.assets
      ? { assets: value.assets.map((asset) => assetDto(asset, env)) }
      : {}),
    ...(value.thumbnailAsset !== undefined
      ? {
          thumbnailAsset: value.thumbnailAsset
            ? assetDto(value.thumbnailAsset, env)
            : null,
        }
      : {}),
  };
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(projectListInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await listProjects(ctx, ctx.session.user.id, input);
      return {
        ...result,
        items: result.items.map((project) => ({
          ...serializeProject(project, ctx.env),
          renderedVideos: project.renderedVideos.map((render) => ({
            ...render,
            videoAsset: assetDto(render.videoAsset, ctx.env),
            thumbnailAsset: render.thumbnailAsset
              ? assetDto(render.thumbnailAsset, ctx.env)
              : null,
          })),
        })),
      };
    }),
  get: protectedProcedure
    .input(projectIdSchema)
    .query(async ({ ctx, input }) => {
      const project = await getProjectDetail(
        ctx,
        ctx.session.user.id,
        input.projectId,
      );
      return {
        ...serializeProject(project, ctx.env),
        renderedVideos: project.renderedVideos.map((render) => ({
          ...render,
          videoAsset: assetDto(render.videoAsset, ctx.env),
          thumbnailAsset: render.thumbnailAsset
            ? assetDto(render.thumbnailAsset, ctx.env)
            : null,
        })),
      };
    }),
  createDraft: protectedProcedure
    .input(createProjectWithBudgetInputSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await createDraftProject(
        ctx,
        ctx.session.user.id,
        input,
      );
      return serializeProject(project, ctx.env);
    }),
  create: protectedProcedure
    .input(createProjectWithBudgetInputSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await createDraftProject(
        ctx,
        ctx.session.user.id,
        input,
      );
      return serializeProject(project, ctx.env);
    }),
  update: protectedProcedure
    .input(updateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await updateProject(ctx, ctx.session.user.id, input);
      return serializeProject(project, ctx.env);
    }),
  rename: protectedProcedure
    .input(renameProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      return renameProject(ctx, ctx.session.user.id, input.projectId, input.title);
    }),
  archive: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      return archiveProject(ctx, ctx.session.user.id, input.projectId);
    }),
  restore: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      return restoreProject(ctx, ctx.session.user.id, input.projectId);
    }),
  delete: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await softDeleteProject(
        ctx,
        ctx.session.user.id,
        input.projectId,
      );
      await ctx.db.auditLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "project.soft_delete",
          entityType: "Project",
          entityId: input.projectId,
          ipAddress: ctx.request.ip,
          userAgent: ctx.request.userAgent,
        },
      });
      return result;
    }),
  purge: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      await purgeProject(ctx, ctx.session.user.id, input.projectId);
      await ctx.db.auditLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "project.purge",
          entityType: "Project",
          entityId: input.projectId,
          ipAddress: ctx.request.ip,
          userAgent: ctx.request.userAgent,
        },
      });
      return { ok: true };
    }),
  duplicate: protectedProcedure
    .input(duplicateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const project = await duplicateProject(
        ctx,
        ctx.session.user.id,
        input.projectId,
        input.title,
      );
      return serializeProject(project, ctx.env);
    }),
  setThumbnail: protectedProcedure
    .input(setThumbnailInputSchema)
    .mutation(async ({ ctx, input }) => {
      return setProjectThumbnail(
        ctx,
        ctx.session.user.id,
        input.projectId,
        input.assetId,
      );
    }),
});
