import type { Context } from "../context";
import { getBudgetStatus, getDailyUsage } from "./budget";

export async function getDashboardStats(ctx: Context, userId: string) {
  const budget = await getBudgetStatus(ctx, userId);
  const daily = await getDailyUsage(ctx, userId);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalVideos,
    published,
    awaitingReview,
    failedJobs,
    recentProjects,
    recentJobs,
    usageSums,
  ] = await Promise.all([
    ctx.db.renderedVideo.count({
      where: { userId, kind: "FINAL", status: "COMPLETED" },
    }),
    ctx.db.publishingJob.count({
      where: { userId, status: "PUBLISHED" },
    }),
    ctx.db.renderedVideo.count({
      where: {
        userId,
        kind: "FINAL",
        status: "COMPLETED",
        isApproved: false,
      },
    }),
    ctx.db.generationJob.count({
      where: {
        userId,
        status: "FAILED",
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    ctx.db.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        thumbnailAsset: true,
        renderedVideos: {
          where: { kind: "FINAL", status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { videoAsset: true, thumbnailAsset: true },
        },
      },
    }),
    ctx.db.generationJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        project: { select: { id: true, title: true } },
      },
    }),
    ctx.db.usageRecord.aggregate({
      where: {
        userId,
        costType: "ACTUAL",
        createdAt: { gte: budget.periodStart, lt: budget.periodEnd },
      },
      _sum: {
        estimatedCostInrPaise: true,
        actualCostInrPaise: true,
      },
    }),
  ]);

  return {
    totals: {
      videosCreated: totalVideos,
      published,
      awaitingReview,
      failedJobs,
    },
    budget: {
      amountInrPaise: budget.amountInrPaise,
      spentInrPaise: budget.spentInrPaise,
      reservedInrPaise: budget.reservedInrPaise,
      availableInrPaise: budget.availableInrPaise,
      retryReserveInrPaise: budget.retryReserveInrPaise,
      spendableInrPaise: budget.spendableInrPaise,
      estimatedInrPaise: usageSums._sum.estimatedCostInrPaise ?? 0,
      actualInrPaise: usageSums._sum.actualCostInrPaise ?? 0,
      periodStart: budget.periodStart,
      periodEnd: budget.periodEnd,
    },
    daily: {
      generated: daily.count,
      limit: daily.limit,
      remaining: daily.remaining,
    },
    recentProjects,
    recentJobs,
    settings: {
      localOnly: budget.settings.localOnly,
      dailyLimit: budget.settings.dailyLimit,
      usdToInrRate: budget.settings.usdToInrRate,
    },
  };
}
