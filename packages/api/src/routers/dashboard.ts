import { protectedProcedure, router } from "../index";
import { assetDto } from "../services/assets";
import { getDashboardStats } from "../services/dashboard";

export const dashboardRouter = router({
  stats: protectedProcedure.query(async ({ ctx }) => {
    const stats = await getDashboardStats(ctx, ctx.session.user.id);
    return {
      ...stats,
      recentProjects: stats.recentProjects.map((project) => ({
        ...project,
        thumbnailAsset: project.thumbnailAsset
          ? assetDto(project.thumbnailAsset, ctx.env)
          : null,
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
});
