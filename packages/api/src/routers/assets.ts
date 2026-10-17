import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { idSchema } from "../schemas/common";
import { projectIdSchema } from "../schemas/project";
import { assetDto, requireAsset } from "../services/assets";
import { requireProject } from "../services/projects";
import {
  createStorageService,
  providerCallContextForStorage,
} from "../providers/storage";

export const assetsRouter = router({
  url: protectedProcedure
    .input(z.object({ assetId: idSchema }))
    .query(async ({ ctx, input }) => {
      const asset = await requireAsset(
        ctx,
        ctx.session.user.id,
        input.assetId,
      );
      return assetDto(asset, ctx.env);
    }),
  list: protectedProcedure
    .input(projectIdSchema)
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, ctx.session.user.id, input.projectId);
      const assets = await ctx.db.mediaAsset.findMany({
        where: { projectId: input.projectId, userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
      });
      return assets.map((asset) => assetDto(asset, ctx.env));
    }),
  delete: protectedProcedure
    .input(z.object({ assetId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const asset = await requireAsset(
        ctx,
        ctx.session.user.id,
        input.assetId,
      );
      try {
        const storage = await createStorageService(
          ctx,
          ctx.session.user.id,
          providerCallContextForStorage(ctx, ctx.session.user.id),
        );
        await storage.delete(asset.storageKey);
      } catch (error) {
        ctx.logger.warn(
          { error, assetId: asset.id },
          "could not delete asset file",
        );
      }
      await ctx.db.mediaAsset.delete({ where: { id: asset.id } });
      await ctx.db.auditLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "asset.delete",
          entityType: "MediaAsset",
          entityId: asset.id,
          ipAddress: ctx.request.ip,
          userAgent: ctx.request.userAgent,
        },
      });
      return { ok: true };
    }),
});
