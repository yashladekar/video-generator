import type { Request, Response } from "express";

import { verifyMediaToken } from "@video-generator/api/lib/crypto";
import {
  createStorageService,
  providerCallContextForStorage,
} from "@video-generator/api/providers/storage";

import { createUserContext } from "./context";
import { ENV } from "./env.server";
import { db, logger } from "./services";

export async function mediaHandler(req: Request, res: Response) {
  const tokenParam = req.params.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  if (!token) {
    res.status(400).json({ error: "Missing media token" });
    return;
  }
  const verified = verifyMediaToken(token, ENV.MEDIA_SIGNING_SECRET);
  if (!verified) {
    res.status(403).json({ error: "Invalid or expired media token" });
    return;
  }
  const asset = await db.mediaAsset.findFirst({
    where: { id: verified.assetId, status: "READY" },
  });
  if (!asset) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }

  const ctx = createUserContext(asset.userId, verified.assetId);
  try {
    const storage = await createStorageService(
      ctx,
      asset.userId,
      providerCallContextForStorage(ctx, asset.userId),
    );
    const total = await storage.size(asset.storageKey);
    const range = req.headers.range;
    const download = req.query.download === "1";
    const filename =
      asset.originalName ??
      `${asset.id}.${asset.mimeType.split("/")[1]?.replace("+xml", "") ?? "bin"}`;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (download) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
      );
    }

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= total
      ) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const buffer = await storage.getRange(asset.storageKey, start, end);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(buffer.byteLength));
      res.end(buffer);
      return;
    }

    res.setHeader("Content-Length", String(total));
    const stream = await storage.stream(asset.storageKey);
    stream.on("error", (error: Error) => {
      logger.error({ error, assetId: asset.id }, "media stream failed");
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error(
      { error, assetId: asset.id },
      "could not serve media asset",
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not read media asset" });
    }
  }
}
