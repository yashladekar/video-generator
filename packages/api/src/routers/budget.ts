import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { paginationSchema } from "../schemas/common";
import { settingsUpdateSchema } from "../schemas/project";
import {
  getBudgetStatus,
  getDailyUsage,
  updateSettings,
} from "../services/budget";

export const budgetRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [budget, daily, usage] = await Promise.all([
      getBudgetStatus(ctx, ctx.session.user.id),
      getDailyUsage(ctx, ctx.session.user.id),
      ctx.db.usageRecord.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
    ]);
    return {
      ...budget,
      daily,
      recentUsage: usage,
    };
  }),
  daily: protectedProcedure.query(async ({ ctx }) => {
    return getDailyUsage(ctx, ctx.session.user.id);
  }),
  updateSettings: protectedProcedure
    .input(settingsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return updateSettings(ctx, ctx.session.user.id, input);
    }),
  usage: protectedProcedure
    .input(
      paginationSchema.extend({
        costType: z.enum(["ALL", "ESTIMATE", "ACTUAL", "ADJUSTMENT"]).default("ALL"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        userId: ctx.session.user.id,
        ...(input.costType !== "ALL" ? { costType: input.costType } : {}),
      };
      const [items, total] = await Promise.all([
        ctx.db.usageRecord.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.usageRecord.count({ where }),
      ]);
      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),
});
