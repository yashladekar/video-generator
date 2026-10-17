import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { toTRPCError } from "./lib/errors";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

const loggingMiddleware = t.middleware(async ({ ctx, next, path, type }) => {
  const startedAt = Date.now();
  const result = await next();
  const durationMs = Date.now() - startedAt;
  if (result.ok) {
    ctx.logger.debug({ path, type, durationMs }, "trpc request");
  } else {
    ctx.logger.warn(
      {
        path,
        type,
        durationMs,
        code: result.error.code,
        message: result.error.message,
      },
      "trpc request failed",
    );
  }
  return result;
});

const errorMapper = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toTRPCError(error);
  }
});

export const publicProcedure = t.procedure
  .use(loggingMiddleware)
  .use(errorMapper);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
