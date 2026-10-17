import type { NextFunction, Request, Response } from "express";

import { logger } from "./services";
import { redis } from "./queue";

export function rateLimit(options: {
  prefix: string;
  limit: number;
  windowSeconds: number;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `ratelimit:${options.prefix}:${req.ip ?? "unknown"}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }
      if (count > options.limit) {
        res.setHeader("Retry-After", String(options.windowSeconds));
        res.status(429).json({
          error: "Too many requests. Please slow down and try again.",
        });
        return;
      }
    } catch (error) {
      logger.warn({ error, key }, "rate limiter unavailable; allowing request");
    }
    next();
  };
}
