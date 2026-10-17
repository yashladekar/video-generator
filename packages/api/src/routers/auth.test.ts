import { describe, expect, it } from "vitest";

import { appRouter } from "./index";
import { createNoopDispatcher } from "../jobs";
import { createLogger } from "../lib/logger";
import { testEnv } from "../test/helpers";

function context(session: unknown = null) {
  return {
    session,
    db: {} as never,
    env: testEnv,
    dispatcher: createNoopDispatcher(),
    request: {
      ip: "127.0.0.1",
      userAgent: "vitest",
      requestId: "test-request",
    },
    logger: createLogger("test", "silent"),
  };
}

describe("tRPC auth guards", () => {
  it("allows public health checks", async () => {
    const caller = appRouter.createCaller(context() as never);
    await expect(caller.healthCheck()).resolves.toBe("OK");
  });

  it("rejects protected procedures without a session", async () => {
    const caller = appRouter.createCaller(context() as never);
    await expect(caller.me.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("passes a session through to protected procedures", async () => {
    const session = {
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "session-1",
        token: "token",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const caller = appRouter.createCaller(context(session) as never);
    const result = await caller.privateData();
    expect(result.user.id).toBe("user-1");
  });
});
