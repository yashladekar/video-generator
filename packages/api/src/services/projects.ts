import type { Prisma } from "@video-generator/db";

import type { Context } from "../context";
import { NotFoundError } from "../lib/errors";
import type {
  CreateProjectInput,
  ProjectListInput,
} from "../schemas/project";
import { ensureUserSettings, updateSettings } from "./budget";
import {
  createStorageService,
  providerCallContextForStorage,
} from "../providers/storage";

export async function requireProject(
  ctx: Context,
  userId: string,
  projectId: string,
  options?: { includeDeleted?: boolean },
) {
  const project = await ctx.db.project.findFirst({
    where: {
      id: projectId,
      userId,
      ...(options?.includeDeleted ? {} : { deletedAt: null }),
    },
  });
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

export async function createDraftProject(
  ctx: Context,
  userId: string,
  input: CreateProjectInput,
) {
  await ensureUserSettings(ctx, userId);
  if (input.budget) {
    await updateSettings(ctx, userId, input.budget);
  }
  const { brief, config } = input;
  const project = await ctx.db.project.create({
    data: {
      userId,
      title: brief.title,
      topic: brief.topic,
      niche: brief.niche,
      targetAudience: brief.targetAudience,
      objective: brief.objective,
      language: brief.language,
      tone: brief.tone,
      cta: brief.callToAction,
      status: "DRAFT",
      durationSeconds: config.durationSeconds,
      aspectRatio: config.aspectRatio,
      resolution: config.resolution,
      narrationStyle: config.narrationStyle,
      voice: config.voice,
      subtitleStyle: config.subtitleStyle,
      visualStyle: config.visualStyle,
      musicMood: config.musicMood,
      platform: config.platform,
      brief: {
        create: {
          topic: brief.topic,
          targetAudience: brief.targetAudience,
          objective: brief.objective,
          niche: brief.niche,
          language: brief.language,
          tone: brief.tone,
          style: brief.style,
          callToAction: brief.callToAction,
          referenceText: brief.referenceText,
          referenceAssets: brief.referenceAssetIds ?? [],
          researchEnabled: brief.researchEnabled,
        },
      },
    },
    include: { brief: true, thumbnailAsset: true },
  });

  if (brief.referenceAssetIds?.length) {
    await ctx.db.mediaAsset.updateMany({
      where: {
        id: { in: brief.referenceAssetIds },
        userId,
        projectId: null,
      },
      data: { projectId: project.id },
    });
  }

  return project;
}

export async function updateProject(
  ctx: Context,
  userId: string,
  input: {
    projectId: string;
    title?: string;
    brief?: Partial<{
      title: string;
      topic: string;
      niche: string;
      targetAudience: string;
      objective: string;
      language: string;
      tone: string;
      style: string;
      callToAction: string;
      referenceText: string;
      researchEnabled: boolean;
    }>;
    config?: Partial<{
      durationSeconds: number;
      aspectRatio: string;
      resolution: string;
      narrationStyle: string;
      voice: string;
      subtitleStyle: string;
      visualStyle: string;
      musicMood: string;
      platform: string;
    }>;
  },
) {
  await requireProject(ctx, userId, input.projectId);
  const { brief, config } = input;
  const project = await ctx.db.project.update({
    where: { id: input.projectId },
    data: {
      ...(input.title ? { title: input.title } : {}),
      ...(brief?.topic ? { topic: brief.topic } : {}),
      ...(brief?.niche !== undefined ? { niche: brief.niche } : {}),
      ...(brief?.targetAudience !== undefined
        ? { targetAudience: brief.targetAudience }
        : {}),
      ...(brief?.objective !== undefined
        ? { objective: brief.objective }
        : {}),
      ...(brief?.language ? { language: brief.language } : {}),
      ...(brief?.tone !== undefined ? { tone: brief.tone } : {}),
      ...(brief?.callToAction !== undefined ? { cta: brief.callToAction } : {}),
      ...(config?.durationSeconds !== undefined
        ? { durationSeconds: config.durationSeconds }
        : {}),
      ...(config?.aspectRatio ? { aspectRatio: config.aspectRatio } : {}),
      ...(config?.resolution ? { resolution: config.resolution } : {}),
      ...(config?.narrationStyle
        ? { narrationStyle: config.narrationStyle }
        : {}),
      ...(config?.voice !== undefined ? { voice: config.voice } : {}),
      ...(config?.subtitleStyle
        ? { subtitleStyle: config.subtitleStyle }
        : {}),
      ...(config?.visualStyle ? { visualStyle: config.visualStyle } : {}),
      ...(config?.musicMood ? { musicMood: config.musicMood } : {}),
      ...(config?.platform ? { platform: config.platform } : {}),
      brief: {
        upsert: {
          create: {
            topic: brief?.topic ?? "Untitled",
            targetAudience: brief?.targetAudience,
            objective: brief?.objective,
            niche: brief?.niche,
            language: brief?.language ?? "en",
            tone: brief?.tone,
            style: brief?.style,
            callToAction: brief?.callToAction,
            referenceText: brief?.referenceText,
            researchEnabled: brief?.researchEnabled ?? false,
          },
          update: {
            ...(brief?.topic ? { topic: brief.topic } : {}),
            ...(brief?.niche !== undefined ? { niche: brief.niche } : {}),
            ...(brief?.targetAudience !== undefined
              ? { targetAudience: brief.targetAudience }
              : {}),
            ...(brief?.objective !== undefined
              ? { objective: brief.objective }
              : {}),
            ...(brief?.language ? { language: brief.language } : {}),
            ...(brief?.tone !== undefined ? { tone: brief.tone } : {}),
            ...(brief?.style !== undefined ? { style: brief.style } : {}),
            ...(brief?.callToAction !== undefined
              ? { callToAction: brief.callToAction }
              : {}),
            ...(brief?.referenceText !== undefined
              ? { referenceText: brief.referenceText }
              : {}),
            ...(brief?.researchEnabled !== undefined
              ? { researchEnabled: brief.researchEnabled }
              : {}),
          },
        },
      },
    },
    include: { brief: true, thumbnailAsset: true },
  });
  return project;
}

export async function listProjects(
  ctx: Context,
  userId: string,
  input: ProjectListInput,
) {
  const where: Prisma.ProjectWhereInput = {
    userId,
    ...(input.includeDeleted ? {} : { deletedAt: null }),
    ...(input.search
      ? {
          OR: [
            { title: { contains: input.search, mode: "insensitive" } },
            { topic: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(input.status === "ALL"
      ? input.includeArchived
        ? {}
        : { archivedAt: null }
      : input.status === "ARCHIVED"
        ? { archivedAt: { not: null } }
        : { status: input.status }),
    ...(input.platform !== "ALL" ? { platform: input.platform } : {}),
  };

  const orderBy: Prisma.ProjectOrderByWithRelationInput =
    input.sort === "oldest"
      ? { createdAt: "asc" }
      : input.sort === "title"
        ? { title: "asc" }
        : input.sort === "duration"
          ? { durationSeconds: "desc" }
          : input.sort === "cost"
            ? { actualCostInrPaise: "desc" }
            : { createdAt: "desc" };

  const skip = (input.page - 1) * input.pageSize;
  const [items, total] = await Promise.all([
    ctx.db.project.findMany({
      where,
      orderBy,
      skip,
      take: input.pageSize,
      include: {
        brief: true,
        thumbnailAsset: true,
        renderedVideos: {
          where: { kind: "FINAL", status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { videoAsset: true, thumbnailAsset: true },
        },
        generationJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            progress: true,
            currentStep: true,
            errorMessage: true,
            createdAt: true,
          },
        },
        publishingJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            platform: true,
            status: true,
            externalUrl: true,
            createdAt: true,
          },
        },
      },
    }),
    ctx.db.project.count({ where }),
  ]);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function getProjectDetail(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  const project = await ctx.db.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    include: {
      brief: true,
      thumbnailAsset: true,
      scripts: {
        orderBy: { version: "desc" },
        take: 1,
        include: { scenes: { orderBy: { orderIndex: "asc" } } },
      },
      assets: { orderBy: { createdAt: "desc" } },
      generationJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { steps: { orderBy: { orderIndex: "asc" } } },
      },
      renderedVideos: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { videoAsset: true, thumbnailAsset: true },
      },
      publishingJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      usageRecords: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

export async function renameProject(
  ctx: Context,
  userId: string,
  projectId: string,
  title: string,
) {
  await requireProject(ctx, userId, projectId);
  return ctx.db.project.update({
    where: { id: projectId },
    data: { title },
  });
}

export async function archiveProject(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  await requireProject(ctx, userId, projectId);
  return ctx.db.project.update({
    where: { id: projectId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

export async function restoreProject(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  await requireProject(ctx, userId, projectId, { includeDeleted: true });
  return ctx.db.project.update({
    where: { id: projectId },
    data: { status: "DRAFT", archivedAt: null, deletedAt: null },
  });
}

export async function softDeleteProject(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  await requireProject(ctx, userId, projectId);
  return ctx.db.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date(), status: "ARCHIVED", archivedAt: new Date() },
  });
}

export async function purgeProject(
  ctx: Context,
  userId: string,
  projectId: string,
) {
  await requireProject(ctx, userId, projectId, { includeDeleted: true });
  const assets = await ctx.db.mediaAsset.findMany({
    where: { projectId, userId },
    select: { storageKey: true },
  });
  try {
    const storage = await createStorageService(
      ctx,
      userId,
      providerCallContextForStorage(ctx, userId),
    );
    for (const asset of assets) {
      await storage.delete(asset.storageKey).catch(() => undefined);
    }
  } catch (error) {
    ctx.logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "failed to delete project media",
    );
  }
  await ctx.db.project.delete({ where: { id: projectId } });
}

export async function duplicateProject(
  ctx: Context,
  userId: string,
  projectId: string,
  title?: string,
) {
  const original = await ctx.db.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    include: {
      brief: true,
      scripts: {
        orderBy: { version: "desc" },
        take: 1,
        include: { scenes: { orderBy: { orderIndex: "asc" } } },
      },
    },
  });
  if (!original) throw new NotFoundError("Project not found");

  return ctx.db.project.create({
    data: {
      userId,
      title: title ?? `${original.title} (copy)`,
      topic: original.topic,
      niche: original.niche,
      targetAudience: original.targetAudience,
      objective: original.objective,
      language: original.language,
      tone: original.tone,
      cta: original.cta,
      status: "DRAFT",
      durationSeconds: original.durationSeconds,
      aspectRatio: original.aspectRatio,
      resolution: original.resolution,
      narrationStyle: original.narrationStyle,
      voice: original.voice,
      subtitleStyle: original.subtitleStyle,
      visualStyle: original.visualStyle,
      musicMood: original.musicMood,
      captionPosition: original.captionPosition,
      musicVolume: original.musicVolume,
      platform: original.platform,
      brief: original.brief
        ? {
            create: {
              topic: original.brief.topic,
              targetAudience: original.brief.targetAudience,
              objective: original.brief.objective,
              niche: original.brief.niche,
              language: original.brief.language,
              tone: original.brief.tone,
              style: original.brief.style,
              callToAction: original.brief.callToAction,
              referenceText: original.brief.referenceText,
              researchEnabled: original.brief.researchEnabled,
            },
          }
        : undefined,
      scripts: original.scripts[0]
        ? {
            create: {
              version: 1,
              status: "DRAFT",
              title: original.scripts[0].title,
              hook: original.scripts[0].hook,
              targetDurationSeconds: original.scripts[0].targetDurationSeconds,
              aspectRatio: original.scripts[0].aspectRatio,
              language: original.scripts[0].language,
              provider: original.scripts[0].provider,
              model: original.scripts[0].model,
              researchSummary: original.scripts[0].researchSummary,
              researchSources: original.scripts[0].researchSources ?? undefined,
              scenes: {
                create: original.scripts[0].scenes.map((scene) => ({
                  sceneNumber: scene.sceneNumber,
                  orderIndex: scene.orderIndex,
                  durationSeconds: scene.durationSeconds,
                  startSeconds: scene.startSeconds,
                  endSeconds: scene.endSeconds,
                  narration: scene.narration,
                  visualDescription: scene.visualDescription,
                  visualType: scene.visualType,
                  subtitleText: scene.subtitleText,
                  transition: scene.transition,
                  motion: scene.motion,
                  status: "PLANNED",
                })),
              },
            },
          }
        : undefined,
    },
    include: { brief: true, scripts: { include: { scenes: true } } },
  });
}

export async function setProjectThumbnail(
  ctx: Context,
  userId: string,
  projectId: string,
  assetId: string,
) {
  await requireProject(ctx, userId, projectId);
  const asset = await ctx.db.mediaAsset.findFirst({
    where: { id: assetId, userId },
  });
  if (!asset) throw new NotFoundError("Thumbnail asset not found");
  return ctx.db.project.update({
    where: { id: projectId },
    data: { thumbnailAssetId: assetId },
  });
}
