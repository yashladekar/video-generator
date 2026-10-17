import type { SceneStatus } from "@video-generator/db";

import type { Context } from "../context";
import { NotFoundError, ValidationError } from "../lib/errors";
import {
  approveVideoSchema,
  reorderScenesSchema,
  replaceVisualSchema,
  sceneUpdateSchema,
  updateCaptionStyleSchema,
  updateMusicSchema,
} from "../schemas/script";
import type { z } from "zod";
import { requireProject } from "./projects";

async function loadSceneForUser(ctx: Context, userId: string, sceneId: string) {
  const scene = await ctx.db.scene.findUnique({
    where: { id: sceneId },
    include: { script: { include: { project: true } } },
  });
  if (!scene || scene.script.project.userId !== userId) {
    throw new NotFoundError("Scene not found");
  }
  return scene;
}

async function resequenceScenes(
  ctx: Context,
  scriptId: string,
  targetDuration: number,
  changedSceneId?: string,
) {
  const scenes = await ctx.db.scene.findMany({
    where: { scriptId },
    orderBy: { orderIndex: "asc" },
  });
  const minDuration = 1;
  let cursor = 0;
  for (const scene of scenes) {
    const duration = Math.max(minDuration, scene.durationSeconds);
    await ctx.db.scene.update({
      where: { id: scene.id },
      data: { startSeconds: cursor, endSeconds: cursor + duration },
    });
    cursor += duration;
  }
  const total = cursor;
  const delta = targetDuration - total;
  if (Math.abs(delta) > 0.01) {
    const adjustable = [...scenes]
      .reverse()
      .find((scene) => scene.id !== changedSceneId);
    if (!adjustable) {
      throw new ValidationError("Could not balance scene durations");
    }
    const newDuration = Math.max(
      minDuration,
      adjustable.durationSeconds + delta,
    );
    if (newDuration < minDuration) {
      throw new ValidationError(
        "The edited duration would make another scene too short",
      );
    }
    await ctx.db.scene.update({
      where: { id: adjustable.id },
      data: { durationSeconds: newDuration },
    });
    const updated = await ctx.db.scene.findMany({
      where: { scriptId },
      orderBy: { orderIndex: "asc" },
    });
    let nextCursor = 0;
    for (const scene of updated) {
      await ctx.db.scene.update({
        where: { id: scene.id },
        data: {
          startSeconds: nextCursor,
          endSeconds: nextCursor + scene.durationSeconds,
        },
      });
      nextCursor += scene.durationSeconds;
    }
  }
}

export async function getStudioData(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  const project = await requireProject(ctx, userId, projectId);
  const script = await ctx.db.script.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    include: {
      scenes: {
        orderBy: { orderIndex: "asc" },
        include: {
          visualAsset: true,
          narrationAsset: true,
          clipAsset: true,
        },
      },
    },
  });
  const [assets, renderedVideos, jobs, publishJobs, subtitleAsset] =
    await Promise.all([
      ctx.db.mediaAsset.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      }),
      ctx.db.renderedVideo.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { videoAsset: true, thumbnailAsset: true },
      }),
      ctx.db.generationJob.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { steps: { orderBy: [{ orderIndex: "asc" }, { attempt: "desc" }] } },
      }),
      ctx.db.publishingJob.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      ctx.db.mediaAsset.findFirst({
        where: { projectId, kind: "SUBTITLE" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
  return {
    project,
    script,
    assets,
    renderedVideos,
    jobs,
    publishJobs,
    subtitleAsset,
  };
}

export async function updateScene(
  ctx: Context,
  userId: string,
  input: z.infer<typeof sceneUpdateSchema>,
) {
  const scene = await loadSceneForUser(ctx, userId, input.sceneId);
  const projectId = scene.script.projectId;
  const updated = await ctx.db.scene.update({
    where: { id: scene.id },
    data: {
      ...(input.narration !== undefined ? { narration: input.narration } : {}),
      ...(input.subtitleText !== undefined
        ? { subtitleText: input.subtitleText }
        : {}),
      ...(input.durationSeconds !== undefined
        ? { durationSeconds: input.durationSeconds }
        : {}),
      ...(input.transition !== undefined ? { transition: input.transition } : {}),
      ...(input.motion !== undefined ? { motion: input.motion } : {}),
      ...(input.visualDescription !== undefined
        ? { visualDescription: input.visualDescription }
        : {}),
      ...(input.visualType !== undefined
        ? {
            visualType: input.visualType,
            ...(input.visualType !== scene.visualType
              ? { status: "PLANNED" as SceneStatus }
              : {}),
          }
        : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
    },
  });
  if (input.durationSeconds !== undefined) {
    await resequenceScenes(
      ctx,
      scene.scriptId,
      scene.script.targetDurationSeconds,
      scene.id,
    );
  }
  await ctx.db.project.update({
    where: { id: projectId },
    data: { status: "CONFIGURED" },
  });
  return updated;
}

export async function reorderScenes(
  ctx: Context,
  userId: string,
  input: z.infer<typeof reorderScenesSchema>,
) {
  await requireProject(ctx, userId, input.projectId);
  const script = await ctx.db.script.findFirst({
    where: { projectId: input.projectId },
    orderBy: { version: "desc" },
    include: { scenes: true },
  });
  if (!script) throw new NotFoundError("Script not found");
  const sceneIds = new Set(script.scenes.map((scene) => scene.id));
  if (
    input.sceneIds.length !== sceneIds.size ||
    input.sceneIds.some((id) => !sceneIds.has(id))
  ) {
    throw new ValidationError("Scene list does not match the project");
  }
  let cursor = 0;
  for (const [index, sceneId] of input.sceneIds.entries()) {
    const scene = script.scenes.find((item) => item.id === sceneId);
    if (!scene) continue;
    await ctx.db.scene.update({
      where: { id: sceneId },
      data: {
        orderIndex: index,
        sceneNumber: index + 1,
        startSeconds: cursor,
        endSeconds: cursor + scene.durationSeconds,
      },
    });
    cursor += scene.durationSeconds;
  }
  await ctx.db.project.update({
    where: { id: input.projectId },
    data: { status: "CONFIGURED" },
  });
  return { ok: true, totalDuration: cursor };
}

export async function replaceSceneVisual(
  ctx: Context,
  userId: string,
  input: z.infer<typeof replaceVisualSchema>,
) {
  const scene = await loadSceneForUser(ctx, userId, input.sceneId);
  if (!input.assetId) {
    throw new ValidationError(
      "Upload a replacement image/video first, then select it",
    );
  }
  const asset = await ctx.db.mediaAsset.findFirst({
    where: { id: input.assetId, userId },
  });
  if (!asset) throw new NotFoundError("Replacement asset not found");
  const updated = await ctx.db.scene.update({
    where: { id: scene.id },
    data: {
      visualAssetId: asset.id,
      status: "ASSETS_READY",
      ...(input.visualType ? { visualType: input.visualType } : {}),
    },
  });
  await ctx.db.project.update({
    where: { id: scene.script.projectId },
    data: { status: "CONFIGURED" },
  });
  return updated;
}

export async function approveRenderedVideo(
  ctx: Context,
  userId: string,
  input: z.infer<typeof approveVideoSchema>,
) {
  const video = await ctx.db.renderedVideo.findFirst({
    where: { id: input.renderedVideoId, userId },
  });
  if (!video) throw new NotFoundError("Rendered video not found");
  return ctx.db.renderedVideo.update({
    where: { id: video.id },
    data: { isApproved: true, approvedAt: new Date() },
  });
}

export async function updateCaptionStyle(
  ctx: Context,
  userId: string,
  input: z.infer<typeof updateCaptionStyleSchema>,
) {
  await requireProject(ctx, userId, input.projectId);
  return ctx.db.project.update({
    where: { id: input.projectId },
    data: {
      subtitleStyle: input.style,
      ...(input.position ? { captionPosition: input.position } : {}),
    },
  });
}

export async function updateMusic(
  ctx: Context,
  userId: string,
  input: z.infer<typeof updateMusicSchema>,
) {
  await requireProject(ctx, userId, input.projectId);
  return ctx.db.project.update({
    where: { id: input.projectId },
    data: {
      ...(input.mood ? { musicMood: input.mood } : {}),
      ...(input.volume !== undefined
        ? { musicVolume: Math.max(0, Math.min(1, input.volume)) }
        : {}),
    },
  });
}

export async function updateSceneVisualFromAsset(
  ctx: Context,
  userId: string,
  sceneId: string,
  assetId: string,
) {
  return replaceSceneVisual(ctx, userId, { sceneId, assetId });
}
