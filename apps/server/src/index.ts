import { randomUUID } from "node:crypto";

import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "@video-generator/api/routers/index";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import pinoHttp from "pino-http";

import { createContext } from "./context";
import { ENV } from "./env.server";
import { mediaHandler } from "./media";
import { youtubeOAuthCallback, startYouTubeOAuth } from "./oauth";
import { closeQueues } from "./queue";
import { rateLimit } from "./rate-limit";
import { db, auth, logger } from "./services";
import { uploadHandler, uploadMiddleware } from "./uploads";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
});
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: req.requestId }),
  }),
);
app.use(
  cors({
    origin: ENV.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(
  "/api/auth",
  rateLimit({ prefix: "auth", limit: 30, windowSeconds: 60 }),
);
app.all("/api/auth{/*path}", toNodeHandler(auth));

app.use(express.json({ limit: "2mb" }));

app.use(
  "/trpc",
  rateLimit({ prefix: "trpc", limit: 180, windowSeconds: 60 }),
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.get("/media/:token", mediaHandler);

app.post(
  "/api/uploads",
  rateLimit({ prefix: "upload", limit: 15, windowSeconds: 60 }),
  uploadMiddleware.single("file"),
  uploadHandler,
);

app.get(
  "/api/oauth/youtube/start",
  rateLimit({ prefix: "oauth", limit: 20, windowSeconds: 60 }),
  startYouTubeOAuth,
);
app.get(
  "/api/oauth/youtube/callback",
  rateLimit({ prefix: "oauth", limit: 20, windowSeconds: 60 }),
  youtubeOAuthCallback,
);

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error(
    { error, requestId: req.requestId, path: req.path },
    "unhandled request error",
  );
  if (res.headersSent) return;
  if (message.includes("File too large") || (error as { code?: string }).code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "The uploaded file exceeds the size limit." });
    return;
  }
  res.status(500).json({
    error: "Internal server error",
    requestId: req.requestId,
  });
});

const server = app.listen(3000, () => {
  logger.info("server listening on http://localhost:3000");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down server");
  server.close();
  await Promise.allSettled([closeQueues(), db.$disconnect()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
