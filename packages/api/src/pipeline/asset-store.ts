import path from "node:path";

import type { AssetKind, AssetSource, MediaAsset } from "@video-generator/db";

import type { Context } from "../context";
import { ensureDir, writeTempFile } from "../lib/fs";
import { safeJoin } from "../lib/fs";
import { toJsonValue } from "../lib/json";
import type { StorageService } from "../providers/storage";

export async function storeAsset(
  ctx: Context,
  input: {
    userId: string;
    projectId?: string | null;
    kind: AssetKind;
    source: AssetSource;
    storageKey: string;
    data: Buffer | string;
    mimeType: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    attribution?: string;
    provider?: string;
    providerModel?: string;
    providerRequestId?: string;
    cacheKey?: string;
    metadata?: Record<string, unknown>;
    originalName?: string;
    storage: StorageService;
  },
): Promise<MediaAsset> {
  if (input.cacheKey) {
    const cached = await ctx.db.mediaAsset.findUnique({
      where: { cacheKey: input.cacheKey },
    });
    if (cached && cached.status === "READY") return cached;
  }

  await input.storage.put(input.storageKey, input.data, input.mimeType);
  const sizeBytes =
    typeof input.data === "string"
      ? Buffer.byteLength(input.data)
      : input.data.byteLength;
  const data = {
    userId: input.userId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    source: input.source,
    status: "READY" as const,
    storageKey: input.storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes,
    width: input.width,
    height: input.height,
    durationSeconds: input.durationSeconds,
    attribution: input.attribution,
    provider: input.provider,
    providerModel: input.providerModel,
    providerRequestId: input.providerRequestId,
    cacheKey: input.cacheKey,
    metadata: toJsonValue(input.metadata),
  };
  const existingByKey = await ctx.db.mediaAsset.findUnique({
    where: { storageKey: input.storageKey },
  });
  if (existingByKey) {
    return ctx.db.mediaAsset.update({
      where: { id: existingByKey.id },
      data,
    });
  }
  try {
    return await ctx.db.mediaAsset.create({ data });
  } catch (error) {
    if (input.cacheKey) {
      const cached = await ctx.db.mediaAsset.findUnique({
        where: { cacheKey: input.cacheKey },
      });
      if (cached) return cached;
    }
    const raced = await ctx.db.mediaAsset.findUnique({
      where: { storageKey: input.storageKey },
    });
    if (raced) {
      return ctx.db.mediaAsset.update({
        where: { id: raced.id },
        data,
      });
    }
    throw error;
  }
}

export async function materializeAsset(
  storage: StorageService,
  key: string,
  workDir: string,
  filename: string,
): Promise<string> {
  await ensureDir(workDir);
  const target = path.join(workDir, filename);
  try {
    const local = await storage.localPath(key);
    return local;
  } catch {
    const data = await storage.get(key);
    await writeTempFile(workDir, filename, data);
    return target;
  }
}

export function mediaKey(projectId: string, kind: string, filename: string): string {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  return `projects/${projectId}/${kind}/${safeName}`;
}

export function resolveMediaPath(root: string, key: string): string {
  return safeJoin(root, key);
}
