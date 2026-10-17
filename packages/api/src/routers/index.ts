import { protectedProcedure, publicProcedure, router } from "../index";
import { assetsRouter } from "./assets";
import { auditRouter, notificationsRouter } from "./notifications";
import { budgetRouter } from "./budget";
import { dashboardRouter } from "./dashboard";
import { generationRouter } from "./generation";
import { meRouter } from "./me";
import { projectsRouter } from "./projects";
import { providersRouter } from "./providers";
import { publishingRouter } from "./publishing";
import { settingsRouter } from "./settings";
import { studioRouter } from "./studio";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),
  privateData: protectedProcedure.query(({ ctx }) => ({
    message: "This is private",
    user: ctx.session.user,
  })),
  me: meRouter,
  settings: settingsRouter,
  dashboard: dashboardRouter,
  projects: projectsRouter,
  generation: generationRouter,
  studio: studioRouter,
  assets: assetsRouter,
  providers: providersRouter,
  budget: budgetRouter,
  publishing: publishingRouter,
  notifications: notificationsRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
