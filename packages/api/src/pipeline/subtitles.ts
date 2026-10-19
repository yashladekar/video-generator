import type { Scene } from "@video-generator/db";

import type { Context } from "../context";
import { renderTextPng, wrapText } from "../lib/text";
import { hashCacheKey } from "../lib/hash";
import type { StorageService } from "../providers/storage";
import { storeAsset } from "./asset-store";

export type CaptionChunk = {
  key: string;
  width: number;
  height: number;
  x: number;
  y: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type SubtitleResult = {
  srtAssetId: string;
  srtKey: string;
  chunksByScene: Record<string, CaptionChunk[]>;
};

const REFERENCE_WIDTH = 1080;
const REFERENCE_HEIGHT = 1920;
const BLOCK_WIDTH = 960;

function splitIntoChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(" ");
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > 72 || current.split(" ").length >= 10) {
        if (current) chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

function allocateTimes(
  chunks: string[],
  sceneStart: number,
  sceneDuration: number,
): Array<{ startSeconds: number; endSeconds: number }> {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  let cursor = sceneStart;
  return chunks.map((chunk) => {
    const duration = Math.max(0.6, (chunk.length / totalChars) * sceneDuration);
    const start = cursor;
    const end = Math.min(sceneStart + sceneDuration, cursor + duration);
    cursor = end;
    return { startSeconds: start, endSeconds: end };
  });
}

function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function captionStyle(style: string) {
  switch (style) {
    case "clean":
      return {
        fontSize: 54,
        lineHeight: 66,
        color: "#ffffff",
        stroke: "#000000",
        strokeWidth: 5,
        background: "rgba(0,0,0,0.28)",
      };
    case "karaoke":
      return {
        fontSize: 60,
        lineHeight: 72,
        color: "#facc15",
        stroke: "#111111",
        strokeWidth: 6,
        background: "rgba(0,0,0,0.5)",
      };
    case "minimal":
      return {
        fontSize: 46,
        lineHeight: 58,
        color: "#f8fafc",
        stroke: "#000000",
        strokeWidth: 3,
        background: "rgba(0,0,0,0.18)",
      };
    default:
      return {
        fontSize: 58,
        lineHeight: 70,
        color: "#ffffff",
        stroke: "#000000",
        strokeWidth: 6,
        background: "rgba(0,0,0,0.48)",
      };
  }
}

export async function generateSubtitles(
  ctx: Context,
  input: {
    userId: string;
    projectId: string;
    scenes: Scene[];
    style: string;
    position: string;
    storage: StorageService;
    workDir: string;
  },
): Promise<SubtitleResult> {
  const style = captionStyle(input.style);
  const chunksByScene: Record<string, CaptionChunk[]> = {};
  const srtEntries: string[] = [];
  let srtIndex = 1;

  for (const scene of input.scenes) {
    const text = scene.subtitleText || scene.narration;
    const rawChunks = splitIntoChunks(text);
    const times = allocateTimes(
      rawChunks,
      scene.startSeconds,
      scene.durationSeconds,
    );
    const chunks: CaptionChunk[] = [];

    for (let index = 0; index < rawChunks.length; index += 1) {
      const chunk = rawChunks[index];
      const timing = times[index];
      if (!chunk || !timing) continue;
      const lines = wrapText(chunk, {
        fontSize: style.fontSize,
        maxWidth: BLOCK_WIDTH - 80,
        maxLines: 2,
      });
      const blockHeight = lines.length * style.lineHeight + 56;
      const png = await renderTextPng({
        lines,
        width: BLOCK_WIDTH,
        height: blockHeight,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
        align: "center",
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        topPadding: 26,
        background: {
          color: style.background,
          radius: 20,
          paddingX: 8,
          paddingY: 8,
        },
      });
      const y =
        input.position === "top"
          ? 150
          : input.position === "center"
            ? Math.round((REFERENCE_HEIGHT - blockHeight) / 2)
            : REFERENCE_HEIGHT - blockHeight - 210;
      const key = `projects/${input.projectId}/subtitles/${hashCacheKey({
        text: chunk,
        style: input.style,
        index,
        sceneId: scene.id,
      })}.png`;
      await input.storage.put(key, png, "image/png");
      chunks.push({
        key,
        width: BLOCK_WIDTH,
        height: blockHeight,
        x: Math.round((REFERENCE_WIDTH - BLOCK_WIDTH) / 2),
        y,
        startSeconds: timing.startSeconds,
        endSeconds: timing.endSeconds,
        text: chunk,
      });
      srtEntries.push(
        `${srtIndex}\n${formatSrtTime(timing.startSeconds)} --> ${formatSrtTime(timing.endSeconds)}\n${chunk}\n`,
      );
      srtIndex += 1;
    }
    chunksByScene[scene.id] = chunks;
  }

  const srtKey = `projects/${input.projectId}/subtitles/captions.srt`;
  const srtContent = srtEntries.join("\n");
  const srtAsset = await storeAsset(ctx, {
    userId: input.userId,
    projectId: input.projectId,
    kind: "SUBTITLE",
    source: "LOCAL",
    storageKey: srtKey,
    data: srtContent,
    mimeType: "application/x-subrip",
    provider: "local",
    storage: input.storage,
  });

  return {
    srtAssetId: srtAsset.id,
    srtKey,
    chunksByScene,
  };
}
