import type { Context } from "../context";
import {
  createStorageService,
  providerCallContextForStorage,
  type StorageService,
} from "../providers/storage";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionOptions = {
  now?: Date;
  retentionDays?: number;
  limit?: number;
  storageFor?: (userId: string) => Promise<StorageService>;
};

export type RetentionResult = {
  disabled: boolean;
  retentionDays: number;
  cutoff: string;
  previewRendersDeleted: number;
  orphanAssetsDeleted: number;
  filesDeleted: number;
  errors: number;
};

export function retentionCutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function resolvedRetentionDays(
  configured: number | undefined,
  fallback = 30,
): number {
  if (configured === undefined || !Number.isFinite(configured)) return fallback;
  return Math.floor(configured);
}

export async function runRetentionCleanup(
  ctx: Context,
  options: RetentionOptions = {},
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const retentionDays = resolvedRetentionDays(
    options.retentionDays ?? ctx.env.MEDIA_RETENTION_DAYS,
  );
  const cutoff = retentionCutoff(retentionDays, now);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const result: RetentionResult = {
    disabled: retentionDays <= 0,
    retentionDays,
    cutoff: cutoff.toISOString(),
    previewRendersDeleted: 0,
    orphanAssetsDeleted: 0,
    filesDeleted: 0,
    errors: 0,
  };
  if (result.disabled) return result;

  const storageCache = new Map<string, Promise<StorageService>>();
  const storageFor =
    options.storageFor ??
    ((userId: string) => {
      let storage = storageCache.get(userId);
      if (!storage) {
        storage = createStorageService(
          ctx,
          userId,
          providerCallContextForStorage(ctx, userId),
        );
        storageCache.set(userId, storage);
      }
      return storage;
    });

  async function deleteAsset(
    storage: StorageService,
    asset: { id: string; storageKey: string },
  ): Promise<boolean> {
    try {
      await storage.delete(asset.storageKey);
      result.filesDeleted += 1;
    } catch (error) {
      result.errors += 1;
      ctx.logger.warn(
        { error, assetId: asset.id, storageKey: asset.storageKey },
        "retention could not delete media file",
      );
    }
    try {
      await ctx.db.mediaAsset.delete({ where: { id: asset.id } });
      return true;
    } catch (error) {
      result.errors += 1;
      ctx.logger.warn(
        { error, assetId: asset.id },
        "retention could not delete media record",
      );
      return false;
    }
  }

  const previews = await ctx.db.renderedVideo.findMany({
    where: {
      kind: "PREVIEW",
      createdAt: { lt: cutoff },
      publishingJobs: { none: {} },
    },
    select: {
      id: true,
      userId: true,
      videoAssetId: true,
      thumbnailAssetId: true,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const preview of previews) {
    const assetIds = [preview.videoAssetId, preview.thumbnailAssetId].filter(
      (id): id is string => Boolean(id),
    );
    const assets = await ctx.db.mediaAsset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, storageKey: true },
    });
    try {
      await ctx.db.renderedVideo.delete({ where: { id: preview.id } });
      result.previewRendersDeleted += 1;
    } catch (error) {
      // The render may already have been removed by a cascade.
      ctx.logger.warn(
        { error, renderedVideoId: preview.id },
        "retention could not delete preview render",
      );
    }

    const storage = await storageFor(preview.userId).catch((error) => {
      result.errors += 1;
      ctx.logger.warn(
        { error, userId: preview.userId },
        "retention could not create storage service",
      );
      return null;
    });
    if (storage) {
      for (const asset of assets) {
        await deleteAsset(storage, asset);
      }
    }
  }

  const orphanAssets = await ctx.db.mediaAsset.findMany({
    where: {
      createdAt: { lt: cutoff },
      status: { not: "DELETED" },
      projectId: null,
      scenesUsingAsVisual: { none: {} },
      scenesUsingAsNarration: { none: {} },
      scenesUsingAsClip: { none: {} },
      renderedVideos: { none: {} },
      renderedThumbnails: { none: {} },
      projectThumbnailFor: null,
    },
    select: { id: true, userId: true, storageKey: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const asset of orphanAssets) {
    const storage = await storageFor(asset.userId).catch((error) => {
      result.errors += 1;
      ctx.logger.warn(
        { error, userId: asset.userId },
        "retention could not create storage service",
      );
      return null;
    });
    if (!storage) continue;
    if (await deleteAsset(storage, asset)) {
      result.orphanAssetsDeleted += 1;
    }
  }

  return result;
}
