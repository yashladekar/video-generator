export type RenderProfileName = "DRAFT" | "PRODUCTION";

export type RenderProfile = {
  name: RenderProfileName;
  label: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  audioBitrate: string;
  thumbnailQuality: string;
};

export const DRAFT_WIDTH = 480;
export const DRAFT_HEIGHT = 854;

export const RENDER_PROFILES: Record<RenderProfileName, RenderProfile> = {
  DRAFT: {
    name: "DRAFT",
    label: "Draft 480p",
    width: DRAFT_WIDTH,
    height: DRAFT_HEIGHT,
    fps: 30,
    crf: 30,
    preset: "ultrafast",
    audioBitrate: "96k",
    thumbnailQuality: "5",
  },
  PRODUCTION: {
    name: "PRODUCTION",
    label: "Production 1080p",
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 20,
    preset: "veryfast",
    audioBitrate: "192k",
    thumbnailQuality: "2",
  },
};

export type RenderKindName = "PREVIEW" | "FINAL";

/**
 * Studio iterations render as a 480p draft so editors can review fast and cheap;
 * full-resolution encoding only happens for the export a user actually keeps.
 */
export function renderProfileFor(
  kind: RenderKindName,
  options?: { resolution?: string | null },
): RenderProfile {
  if (kind === "PREVIEW") return RENDER_PROFILES.DRAFT;
  const base = RENDER_PROFILES.PRODUCTION;
  if (options?.resolution === "720p") {
    return { ...base, width: 720, height: 1280, label: "Production 720p" };
  }
  return base;
}

export function renderProfileByName(
  name: RenderProfileName,
  options?: { resolution?: string | null },
): RenderProfile {
  return renderProfileFor(name === "DRAFT" ? "PREVIEW" : "FINAL", options);
}

export function isDraftProfile(profile: RenderProfile): boolean {
  return profile.name === "DRAFT";
}
