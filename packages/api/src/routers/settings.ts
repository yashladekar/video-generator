import { protectedProcedure, router } from "../index";
import { settingsUpdateSchema } from "../schemas/project";
import { ensureUserSettings, updateSettings } from "../services/budget";

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    return ensureUserSettings(ctx, ctx.session.user.id);
  }),
  update: protectedProcedure
    .input(settingsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return updateSettings(ctx, ctx.session.user.id, input);
    }),
});
