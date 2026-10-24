import { describe, expect, it, vi } from "vitest";

import type { Context } from "../context";
import type { StorageService } from "../providers/storage";
import { silentLogger, testEnv } from "../test/helpers";
import {
  DEFAULT_INTERMEDIATE_RETENTION_HOURS,
  intermediateCutoff,
  resolvedIntermediateRetentionHours,
  resolvedRetentionDays,
  retentionCutoff,
  runRetentionCleanup,
} from "./retention";

function fakeContext(
  db: Context["db"],
  retentionDays = 30,
  intermediateHours?: number,
): Context {
  return {
    env: {
      ...testEnv,
      MEDIA_RETENTION_DAYS: retentionDays,
      ...(intermediateHours === undefined
        ? {}
        : { MEDIA_INTERMEDIATE_RETENTION_HOURS: intermediateHours }),
    },
    db,
    logger: silentLogger(),
  } as unknown as Context;
}

function mockStorage() {
  const deleteFile = vi.fn(async () => undefined);
  return {
    deleteFile,
    storageFor: async () =>
      ({ delete: deleteFile }) as unknown as StorageService,
  };
}

function mockDb(input: {
  previews?: unknown[];
  renderAssets?: unknown[];
  orphanAssets?: unknown[];
  intermediateAssets?: unknown[];
}) {
  const findMany = vi.fn(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if (where.kind && typeof where.kind === "object") {
      return input.intermediateAssets ?? [];
    }
    if (where.projectId === null) return input.orphanAssets ?? [];
    return input.renderAssets ?? [];
  });
  return {
    renderedVideo: {
      findMany: vi.fn().mockResolvedValue(input.previews ?? []),
      delete: vi.fn().mockResolvedValue({}),
    },
    mediaAsset: {
      findMany,
      delete: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Context["db"];
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

  it("defaults intermediate working files to a 48 hour window", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(DEFAULT_INTERMEDIATE_RETENTION_HOURS).toBe(48);
    expect(intermediateCutoff(48, now).toISOString()).toBe(
      "2026-01-30T00:00:00.000Z",
    );
    expect(resolvedIntermediateRetentionHours(undefined)).toBe(48);
    expect(resolvedIntermediateRetentionHours(6)).toBe(6);
  });

  it("deletes old preview renders and their assets", async () => {
    const { deleteFile, storageFor } = mockStorage();
    const db = mockDb({
      previews: [
        {
          id: "render-1",
          userId: "user-1",
          videoAssetId: "video-1",
          thumbnailAssetId: "thumb-1",
        },
      ],
      renderAssets: [
        { id: "video-1", storageKey: "renders/render-1.mp4" },
        { id: "thumb-1", storageKey: "renders/render-1.jpg" },
      ],
    });

    const result = await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor,
    });

    expect(result.previewRendersDeleted).toBe(1);
    expect(result.filesDeleted).toBe(2);
    expect(result.orphanAssetsDeleted).toBe(0);
    expect(result.intermediateAssetsDeleted).toBe(0);
    expect(result.intermediateRetentionHours).toBe(48);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(db.renderedVideo.delete).toHaveBeenCalledWith({
      where: { id: "render-1" },
    });
  });

  it("purges preview drafts after the intermediate window, not the full retention period", async () => {
    const { storageFor } = mockStorage();
    const db = mockDb({});
    await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor,
    });

    const previewQuery = (db.renderedVideo.findMany as unknown as {
      mock: { calls: Array<[{ where: { kind: string; createdAt: { lt: Date } } }]> };
    }).mock.calls[0]?.[0];
    expect(previewQuery?.where.kind).toBe("PREVIEW");
    expect(previewQuery?.where.createdAt.lt.toISOString()).toBe(
      "2026-01-30T00:00:00.000Z",
    );
  });

  it("deletes unreferenced assets that have no project", async () => {
    const { deleteFile, storageFor } = mockStorage();
    const db = mockDb({
      orphanAssets: [
        { id: "asset-1", userId: "user-1", storageKey: "uploads/a.png" },
      ],
    });

    const result = await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor,
    });

    expect(result.previewRendersDeleted).toBe(0);
    expect(result.orphanAssetsDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(deleteFile).toHaveBeenCalledWith("uploads/a.png");
  });

  it("purges unreferenced project intermediates such as superseded clips", async () => {
    const { deleteFile, storageFor } = mockStorage();
    const db = mockDb({
      intermediateAssets: [
        { id: "clip-1", userId: "user-1", storageKey: "projects/p1/visuals/a.mp4" },
      ],
    });

    const result = await runRetentionCleanup(fakeContext(db), {
      now: new Date("2026-02-01T00:00:00.000Z"),
      storageFor,
    });

    expect(result.intermediateAssetsDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(deleteFile).toHaveBeenCalledWith("projects/p1/visuals/a.mp4");

    const findMany = db.mediaAsset.findMany as unknown as {
      mock: { calls: Array<[{ where: Record<string, unknown> }]> };
    };
    const intermediateQuery = findMany.mock.calls.find(
      ([args]) => args?.where?.kind !== undefined,
    )?.[0];
    expect(intermediateQuery?.where.kind).toEqual({
      in: ["IMAGE", "VIDEO", "CLIP", "OTHER"],
    });
    expect(
      (
        intermediateQuery?.where.createdAt as { lt: Date }
      ).lt.toISOString(),
    ).toBe("2026-01-30T00:00:00.000Z");
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
