import type { MediaAsset } from "@video-generator/db";

import type { Context } from "../context";
import { signMediaToken } from "../lib/crypto";
import { NotFoundError } from "../lib/errors";

const ASSET_URL_TTL_MS = 60 * 60 * 1000;

export function assetUrl(assetId: string, env: Context["env"]): string {
  const token = signMediaToken(
    assetId,
    Date.now() + ASSET_URL_TTL_MS,
    env.MEDIA_SIGNING_SECRET,
  );
  return `${env.PUBLIC_API_URL.replace(/\/+$/, "")}/media/${token}`;
}

export function assetDto(asset: MediaAsset, env: Context["env"]) {
  return {
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    status: asset.status,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    sizeBytes: asset.sizeBytes,
    originalName: asset.originalName,
    attribution: asset.attribution,
    provider: asset.provider,
    providerModel: asset.providerModel,
    metadata: asset.metadata,
    createdAt: asset.createdAt,
    url: assetUrl(asset.id, env),
  };
}

export async function requireAsset(
  ctx: Context,
  userId: string,
  assetId: string,
  projectId?: string,
) {
  const asset = await ctx.db.mediaAsset.findFirst({
    where: {
      id: assetId,
      userId,
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
    },
  });
  if (!asset) throw new NotFoundError("Media asset not found");
  return asset;
}
