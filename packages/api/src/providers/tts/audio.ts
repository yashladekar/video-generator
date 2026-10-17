import { readFile } from "node:fs/promises";
import path from "node:path";

import { probeMedia, runFfmpeg } from "../../lib/ffmpeg";
import { cleanupDir, createTempDir, writeTempFile } from "../../lib/fs";
import type { ProviderCallContext } from "../types";

export async function normalizeAudioBuffer(
  input: Buffer,
  inputExtension: string,
  ctx: ProviderCallContext,
): Promise<{ audio: Buffer; durationSeconds: number; mimeType: string }> {
  const dir = await createTempDir("tts-");
  try {
    const inputPath = await writeTempFile(dir, `input.${inputExtension}`, input);
    const outputPath = path.join(dir, "normalized.wav");
    await runFfmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      { ffmpegPath: ctx.env.FFMPEG_PATH },
    );
    const info = await probeMedia(outputPath, {
      ffprobePath: ctx.env.FFPROBE_PATH,
    });
    const durationSeconds = Number(info.format.duration ?? 0);
    return {
      audio: await readFile(outputPath),
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      mimeType: "audio/wav",
    };
  } finally {
    await cleanupDir(dir);
  }
}

export async function normalizeAudioFile(
  inputPath: string,
  ctx: ProviderCallContext,
): Promise<{ audio: Buffer; durationSeconds: number; mimeType: string }> {
  const dir = await createTempDir("tts-");
  try {
    const outputPath = path.join(dir, "normalized.wav");
    await runFfmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      { ffmpegPath: ctx.env.FFMPEG_PATH },
    );
    const info = await probeMedia(outputPath, {
      ffprobePath: ctx.env.FFPROBE_PATH,
    });
    const durationSeconds = Number(info.format.duration ?? 0);
    return {
      audio: await readFile(outputPath),
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      mimeType: "audio/wav",
    };
  } finally {
    await cleanupDir(dir);
  }
}
