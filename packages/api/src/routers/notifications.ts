import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { idSchema, paginationSchema } from "../schemas/common";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.notification.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }),
  markRead: protectedProcedure
    .input(z.object({ notificationId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.notification.updateMany({
        where: { id: input.notificationId, userId: ctx.session.user.id },
        data: { readAt: new Date() },
      });
      return { ok: true };
    }),
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }),
});

export const auditRouter = router({
  list: protectedProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      const where = { userId: ctx.session.user.id };
      const [items, total] = await Promise.all([
        ctx.db.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.auditLog.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: input.pageSize };
    }),
});
