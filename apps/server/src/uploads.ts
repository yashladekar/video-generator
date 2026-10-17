import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { Request, Response } from "express";
import { fileTypeFromFile } from "file-type";
import multer from "multer";

import { fromNodeHeaders } from "better-auth/node";

import { probeMedia } from "@video-generator/api/lib/ffmpeg";
import { sanitizeFilename } from "@video-generator/api/lib/hash";
import { storeAsset } from "@video-generator/api/pipeline/asset-store";
import {
  createStorageService,
  providerCallContextForStorage,
} from "@video-generator/api/providers/storage";
import { assetDto } from "@video-generator/api/services/assets";

import { createUserContext } from "./context";
import { ENV } from "./env.server";
import { auth, db, logger } from "./services";

const maxUploadMb = Math.max(1, Number(ENV.MAX_UPLOAD_MB ?? 200));
const uploadDir = `${tmpdir()}/reel-uploads`;
mkdirSync(uploadDir, { recursive: true });

export const uploadMiddleware = multer({
  dest: uploadDir,
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
});

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aiff",
  "text/plain",
  "application/pdf",
]);

function kindFromMime(mime: string, requested?: string): "IMAGE" | "VIDEO" | "REFERENCE" {
  if (requested === "visual") {
    if (mime.startsWith("image/")) return "IMAGE";
    if (mime.startsWith("video/")) return "VIDEO";
  }
  return "REFERENCE";
}

export async function uploadHandler(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const userId = session.user.id;
    const detected = await fileTypeFromFile(file.path);
    const mime = detected?.mime ?? file.mimetype;
    if (!ALLOWED_MIME.has(mime)) {
      res.status(415).json({
        error: `Unsupported file type: ${mime}. Allowed: images, MP4/MOV, MP3/WAV/AIFF, text, and PDF.`,
      });
      return;
    }

    const projectIdRaw =
      typeof req.body?.projectId === "string" ? req.body.projectId : undefined;
    let projectId: string | undefined;
    if (projectIdRaw) {
      const project = await db.project.findFirst({
        where: { id: projectIdRaw, userId, deletedAt: null },
        select: { id: true },
      });
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      projectId = project.id;
    }

    let width: number | undefined;
    let height: number | undefined;
    let durationSeconds: number | undefined;
    if (
      mime.startsWith("image/") ||
      mime.startsWith("video/") ||
      mime.startsWith("audio/")
    ) {
      const info = await probeMedia(file.path, {
        ffprobePath: ENV.FFPROBE_PATH,
      });
      const videoStream = info.streams.find((stream) => stream.codec_type === "video");
      const audioStream = info.streams.find((stream) => stream.codec_type === "audio");
      width = videoStream?.width;
      height = videoStream?.height;
      durationSeconds = Number(info.format.duration ?? 0) || undefined;
      if (!videoStream && !audioStream) {
        res.status(415).json({ error: "The file has no readable media streams" });
        return;
      }
    }

    const requestedKind =
      typeof req.body?.kind === "string" ? req.body.kind : undefined;
    const kind = kindFromMime(mime, requestedKind);
    const data = await readFile(file.path);
    const safeName = sanitizeFilename(file.originalname || "upload");
    const storageKey = `users/${userId}/uploads/${randomUUID()}-${safeName}`;
    const ctx = createUserContext(userId);
    const storage = await createStorageService(
      ctx,
      userId,
      providerCallContextForStorage(ctx, userId),
    );
    const asset = await storeAsset(ctx, {
      userId,
      projectId: projectId ?? null,
      kind,
      source: "UPLOAD",
      storageKey,
      data,
      mimeType: mime,
      width,
      height,
      durationSeconds,
      originalName: file.originalname,
      storage,
    });
    res.status(201).json(assetDto(asset, ENV));
  } catch (error) {
    logger.error({ error }, "upload failed");
    res.status(500).json({ error: "Upload failed" });
  } finally {
    await unlink(file.path).catch(() => undefined);
  }
}
