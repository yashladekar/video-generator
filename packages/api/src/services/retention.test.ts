import { describe, expect, it, vi } from "vitest";

import type { Context } from "../context";
import type { StorageService } from "../providers/storage";
import { silentLogger, testEnv } from "../test/helpers";
import {
  resolvedRetentionDays,
  retentionCutoff,
  runRetentionCleanup,
} from "./retention";

function fakeContext(db: Context["db"], retentionDays = 30): Context {
  return {
    env: { ...testEnv, MEDIA_RETENTION_DAYS: retentionDays },
    db,
    logger: silentLogger(),
  } as unknown as Context;
}

describe("retention cleanup", () => {
  it("computes the cutoff from the configured retention days", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(retentionCutoff(30, now).toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(resolvedRetentionDays(undefined)).toBe(30);
    expect(resolvedRetentionDays(0)).toBe(0);
  });

  it("deletes old preview renders and their assets", async () => {
    const deleteFile = vi.fn(async () => undefined);
    const db = {
      renderedVideo: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "render-1",
            userId: "user-1",
            videoAssetId: "video-1",
            thumbnailAssetId: "thumb-1",
          },
        ]),
        delete: vi.fn().mockResolvedValue({ id: "render-1" }),
      },
      mediaAsset: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { id: "video-1", storageKey: "renders/render-1.mp4" },
            { id: "thumb-1", storageKey: "renders/render-1.jpg" },
          ])
          .mockResolvedValueOnce([]),
        delete: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Context["db"];

    const result = await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor: async () =>
        ({ delete: deleteFile }) as unknown as StorageService,
    });

    expect(result.previewRendersDeleted).toBe(1);
    expect(result.filesDeleted).toBe(2);
    expect(result.orphanAssetsDeleted).toBe(0);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(db.renderedVideo.delete).toHaveBeenCalledWith({
      where: { id: "render-1" },
    });
    expect(db.mediaAsset.delete).toHaveBeenCalledTimes(2);
  });

  it("deletes unreferenced assets that have no project", async () => {
    const deleteFile = vi.fn(async () => undefined);
    const db = {
      renderedVideo: {
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      },
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          { id: "asset-1", userId: "user-1", storageKey: "uploads/a.png" },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Context["db"];

    const result = await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor: async () =>
        ({ delete: deleteFile }) as unknown as StorageService,
    });

    expect(result.previewRendersDeleted).toBe(0);
    expect(result.orphanAssetsDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(deleteFile).toHaveBeenCalledWith("uploads/a.png");
  });

  it("does not query or delete when retention is disabled", async () => {
    const db = {
      renderedVideo: { findMany: vi.fn(), delete: vi.fn() },
      mediaAsset: { findMany: vi.fn(), delete: vi.fn() },
    } as unknown as Context["db"];

    const result = await runRetentionCleanup(fakeContext(db, 0), {
      storageFor: vi.fn(),
    });

    expect(result.disabled).toBe(true);
    expect(db.renderedVideo.findMany).not.toHaveBeenCalled();
    expect(db.mediaAsset.findMany).not.toHaveBeenCalled();
  });
});
