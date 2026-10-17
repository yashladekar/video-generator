import { randomUUID } from "node:crypto";

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type {
  Context as ApiContext,
  RequestMeta,
} from "@video-generator/api/context";
import { fromNodeHeaders } from "better-auth/node";

import { auth, db, logger, runtimeEnv } from "./services";
import { dispatcher } from "./queue";

function requestMeta(req: CreateExpressContextOptions["req"]): RequestMeta {
  const withId = req as typeof req & { requestId?: string };
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? "",
    userAgent: req.headers["user-agent"] ?? "",
    requestId: withId.requestId ?? randomUUID(),
  };
}

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers),
  });
  const request = requestMeta(opts.req);
  return {
    session,
    db,
    env: runtimeEnv,
    dispatcher,
    request,
    logger: logger.child({ requestId: request.requestId }),
  };
}

export function createWorkerContext(jobId: string): ApiContext {
  return {
    session: null,
    db,
    env: runtimeEnv,
    dispatcher,
    request: {
      ip: "worker",
      userAgent: "bullmq-worker",
      requestId: jobId,
    },
    logger: logger.child({ jobId }),
  };
}

export function createUserContext(
  userId: string,
  requestId: string = randomUUID(),
): ApiContext {
  return {
    session: null,
    db,
    env: runtimeEnv,
    dispatcher,
    request: {
      ip: "internal",
      userAgent: "server-route",
      requestId,
    },
    logger: logger.child({ requestId, userId }),
  };
}
