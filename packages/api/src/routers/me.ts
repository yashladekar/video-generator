import { protectedProcedure, router } from "../index";
import { ensureUserSettings } from "../services/budget";

export const meRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => ({
    user: ctx.session.user,
    settings: await ensureUserSettings(ctx, ctx.session.user.id),
  })),
});
