import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  concatFileLine,
  getFileSize,
  probeMedia,
  runFfmpeg,
} from "../lib/ffmpeg";
import { MediaError } from "../lib/errors";
import { RENDER_PROFILES, type RenderProfile } from "./render-profiles";

export type RenderCaption = {
  path: string;
  width: number;
  height: number;
  x: number;
  y: number;
  startSeconds: number;
  endSeconds: number;
};

export type RenderScene = {
  index: number;
  visualPath: string;
  visualMimeType: string;
  narrationPath: string;
  durationSeconds: number;
  captions: RenderCaption[];
  motion?: string | null;
};

export type RenderInput = {
  workDir: string;
  scenes: RenderScene[];
  musicPath?: string | null;
  musicVolume?: number;
  profile?: RenderProfile;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type RenderOutput = {
  filePath: string;
  thumbnailPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  fileSizeBytes: number;
  profile: RenderProfile["name"];
};

function motionFilter(
  motion: string | null | undefined,
  width: number,
  height: number,
  duration: number,
  fps: number,
): string {
  const frames = Math.max(1, Math.round(duration * fps));
  const center = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  const base = `scale=${Math.round(width * 1.08)}:${Math.round(height * 1.08)}:force_original_aspect_ratio=increase,crop=${Math.round(width * 1.08)}:${Math.round(height * 1.08)}`;
  if (motion === "zoom_out") {
    return `${base},zoompan=z='max(1.06-0.00055*on,1)':${center}:d=1:s=${width}x${height}:fps=${fps},format=yuv420p`;
  }
  if (motion === "pan_left" || motion === "pan_right") {
    const xExpr =
      motion === "pan_left"
        ? `x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`
        : `x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)'`;
    return `${base},zoompan=z='1.04':${xExpr}:d=1:s=${width}x${height}:fps=${fps},format=yuv420p`;
  }
  if (motion === "static") {
    return `${base},zoompan=z='1':${center}:d=1:s=${width}x${height}:fps=${fps},format=yuv420p`;
  }
  return `${base},zoompan=z='min(1+0.00045*on,1.06)':${center}:d=1:s=${width}x${height}:fps=${fps},format=yuv420p`;
}

function buildSceneArgs(
  scene: RenderScene,
  profile: RenderProfile,
  outputPath: string,
): string[] {
  const { width, height, fps } = profile;
  const duration = Math.max(0.5, scene.durationSeconds);
  const isVideo = scene.visualMimeType.startsWith("video/");
  const args: string[] = ["-y"];

  if (isVideo) {
    args.push("-stream_loop", "-1", "-i", scene.visualPath);
  } else {
    args.push("-loop", "1", "-framerate", String(fps), "-i", scene.visualPath);
  }
  args.push("-i", scene.narrationPath);

  for (const caption of scene.captions) {
    args.push("-loop", "1", "-framerate", String(fps), "-i", caption.path);
  }

  const filterParts: string[] = [];
  if (isVideo) {
    filterParts.push(
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setpts=PTS-STARTPTS[base]`,
    );
  } else {
    filterParts.push(
      `[0:v]${motionFilter(scene.motion, width, height, duration, fps)}[base]`,
    );
  }

  let lastVideoLabel = "base";
  const scale = width / 1080;
  scene.captions.forEach((caption, index) => {
    const inputIndex = 2 + index;
    const capLabel = `cap${index}`;
    const outLabel = `v${index}`;
    const capWidth = Math.max(1, Math.round(caption.width * scale));
    const capHeight = Math.max(1, Math.round(caption.height * scale));
    const capX = Math.max(0, Math.round(caption.x * scale));
    const capY = Math.max(0, Math.round(caption.y * scale));
    filterParts.push(
      `[${inputIndex}:v]scale=${capWidth}:${capHeight},format=rgba[${capLabel}]`,
    );
    filterParts.push(
      `[${lastVideoLabel}][${capLabel}]overlay=${capX}:${capY}:eof_action=repeat:enable='between(t,${caption.startSeconds.toFixed(3)},${caption.endSeconds.toFixed(3)})'[${outLabel}]`,
    );
    lastVideoLabel = outLabel;
  });

  filterParts.push(
    `[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad=pad_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`,
  );

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    `[${lastVideoLabel}]`,
    "-map",
    "[a]",
    "-t",
    duration.toFixed(3),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    outputPath,
  );
  return args;
}

export async function renderReel(input: RenderInput): Promise<RenderOutput> {
  if (input.scenes.length === 0) {
    throw new MediaError("RENDER_NO_SCENES", "No scenes to render");
  }
  const profile = input.profile ?? RENDER_PROFILES.PRODUCTION;
  const scenePaths: string[] = [];
  let totalDuration = 0;

  for (const scene of input.scenes) {
    const narration = await probeMedia(scene.narrationPath, {
      ffprobePath: input.ffprobePath,
    });
    const narrationDuration = Number(narration.format.duration ?? 0);
    if (narrationDuration > scene.durationSeconds + 0.2) {
      throw new MediaError(
        "NARRATION_CLIPPED",
        `Scene ${scene.index + 1} narration is ${narrationDuration.toFixed(2)}s but the scene is only ${scene.durationSeconds.toFixed(2)}s`,
      );
    }
    const scenePath = path.join(input.workDir, `scene-${scene.index}.mp4`);
    const args = buildSceneArgs(scene, profile, scenePath);
    await runFfmpeg(args, {
      ffmpegPath: input.ffmpegPath,
      timeoutMs: 10 * 60 * 1000,
    });
    scenePaths.push(scenePath);
    totalDuration += scene.durationSeconds;
  }

  const concatPath = path.join(input.workDir, "concat.txt");
  await writeFile(
    concatPath,
    `${scenePaths.map((file) => concatFileLine(file)).join("\n")}\n`,
    "utf8",
  );
  const basePath = path.join(input.workDir, "base.mp4");
  try {
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", basePath],
      { ffmpegPath: input.ffmpegPath, timeoutMs: 10 * 60 * 1000 },
    );
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatPath,
        "-c:v",
        "libx264",
        "-preset",
        profile.preset,
        "-crf",
        String(profile.crf),
        "-c:a",
        "aac",
        "-b:a",
        profile.audioBitrate,
        "-pix_fmt",
        "yuv420p",
        basePath,
      ],
      { ffmpegPath: input.ffmpegPath, timeoutMs: 15 * 60 * 1000 },
    );
  }

  const finalPath = path.join(input.workDir, "final.mp4");
  if (input.musicPath) {
    const volume = Math.max(0, Math.min(1, input.musicVolume ?? 0.15));
    const fadeStart = Math.max(0, totalDuration - 1.5);
    await runFfmpeg(
      [
        "-y",
        "-i",
        basePath,
        "-stream_loop",
        "-1",
        "-i",
        input.musicPath,
        "-filter_complex",
        `[1:a]volume=${volume.toFixed(3)},atrim=0:${totalDuration.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        profile.audioBitrate,
        "-movflags",
        "+faststart",
        finalPath,
      ],
      { ffmpegPath: input.ffmpegPath, timeoutMs: 10 * 60 * 1000 },
    );
  } else {
    await runFfmpeg(
      ["-y", "-i", basePath, "-c", "copy", "-movflags", "+faststart", finalPath],
      { ffmpegPath: input.ffmpegPath, timeoutMs: 5 * 60 * 1000 },
    );
  }

  const info = await probeMedia(finalPath, { ffprobePath: input.ffprobePath });
  const videoStream = info.streams.find((stream) => stream.codec_type === "video");
  const durationSeconds = Number(info.format.duration ?? totalDuration);
  const thumbnailPath = path.join(input.workDir, "thumbnail.jpg");
  await runFfmpeg(
    [
      "-y",
      "-ss",
      String(Math.min(1, Math.max(0, durationSeconds / 2))),
      "-i",
      finalPath,
      "-frames:v",
      "1",
      "-q:v",
      profile.thumbnailQuality,
      thumbnailPath,
    ],
    { ffmpegPath: input.ffmpegPath, timeoutMs: 60_000 },
  );

  const rateParts = (videoStream?.avg_frame_rate ?? "30/1").split("/");
  const rateNumerator = Number(rateParts[0] ?? 30);
  const rateDenominator = Number(rateParts[1] ?? 1);
  const fps =
    Number.isFinite(rateNumerator) && Number.isFinite(rateDenominator) && rateDenominator > 0
      ? rateNumerator / rateDenominator
      : profile.fps;

  return {
    filePath: finalPath,
    thumbnailPath,
    durationSeconds,
    width: videoStream?.width ?? profile.width,
    height: videoStream?.height ?? profile.height,
    fps,
    fileSizeBytes: await getFileSize(finalPath),
    profile: profile.name,
  };
}

