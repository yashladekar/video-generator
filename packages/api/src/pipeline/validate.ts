import { getFileSize, probeMedia, runFfmpeg } from "../lib/ffmpeg";

export type ValidationExpected = {
  durationSeconds: number;
  width: number;
  height: number;
  minFileSizeBytes?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type ValidationResult = {
  passed: boolean;
  issues: string[];
  details: {
    durationSeconds?: number;
    width?: number;
    height?: number;
    fps?: number;
    videoCodec?: string;
    audioCodec?: string;
    pixFmt?: string;
    fileSizeBytes?: number;
    meanVolumeDb?: number;
    maxVolumeDb?: number;
    blackFrameDurations?: number[];
  };
};

function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [numerator, denominator] = rate.split("/");
  const n = Number(numerator);
  const d = Number(denominator ?? 1);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return undefined;
  return n / d;
}

export async function validateRenderedVideo(
  filePath: string,
  expected: ValidationExpected,
): Promise<ValidationResult> {
  const issues: string[] = [];
  const details: ValidationResult["details"] = {};

  const info = await probeMedia(filePath, {
    ffprobePath: expected.ffprobePath,
  });
  const video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(info.format.duration ?? 0);
  const fileSize = await getFileSize(filePath);

  details.durationSeconds = Number.isFinite(duration) ? duration : undefined;
  details.width = video?.width;
  details.height = video?.height;
  details.fps = parseRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  details.videoCodec = video?.codec_name;
  details.audioCodec = audio?.codec_name;
  details.pixFmt = video?.pix_fmt;
  details.fileSizeBytes = fileSize;

  if (!video) issues.push("No video stream found.");
  if (!audio) issues.push("No audio stream found.");
  if (!Number.isFinite(duration) || duration <= 0) {
    issues.push("Could not read a valid duration.");
  } else {
    const tolerance = Math.max(2, expected.durationSeconds * 0.05);
    if (Math.abs(duration - expected.durationSeconds) > tolerance) {
      issues.push(
        `Duration is ${duration.toFixed(2)}s; expected ${expected.durationSeconds}s ± ${tolerance.toFixed(1)}s.`,
      );
    }
  }
  if (video) {
    if (video.width !== expected.width || video.height !== expected.height) {
      issues.push(
        `Resolution is ${video.width}x${video.height}; expected ${expected.width}x${expected.height}.`,
      );
    }
    if ((details.fps ?? 0) < 24) {
      issues.push(`Frame rate is ${(details.fps ?? 0).toFixed(2)}fps; expected at least 24fps.`);
    }
    if (video.codec_name !== "h264") {
      issues.push(`Video codec is ${video.codec_name ?? "unknown"}; expected h264.`);
    }
    if (video.pix_fmt !== "yuv420p") {
      issues.push(`Pixel format is ${video.pix_fmt ?? "unknown"}; expected yuv420p.`);
    }
  }
  if (audio && audio.codec_name !== "aac") {
    issues.push(`Audio codec is ${audio.codec_name ?? "unknown"}; expected aac.`);
  }
  const minFileSize = expected.minFileSizeBytes ?? 100_000;
  if (fileSize < minFileSize) {
    issues.push(
      `Output file is smaller than the minimum expected size (${minFileSize} bytes); it may be empty or truncated.`,
    );
  }

  if (audio) {
    try {
      const volume = await runFfmpeg(
        ["-i", filePath, "-af", "volumedetect", "-vn", "-f", "null", "-"],
        { ffmpegPath: expected.ffmpegPath, timeoutMs: 120_000 },
      );
      const meanMatch = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(volume.stderr);
      const maxMatch = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(volume.stderr);
      const mean = meanMatch ? Number(meanMatch[1]) : undefined;
      const max = maxMatch ? Number(maxMatch[1]) : undefined;
      details.meanVolumeDb = mean;
      details.maxVolumeDb = max;
      if (mean !== undefined && mean < -45) {
        issues.push(`Mean audio volume is ${mean.toFixed(1)}dB; narration may be too quiet.`);
      }
      if (max !== undefined && max > -0.1) {
        issues.push(`Peak audio volume is ${max.toFixed(1)}dB; the audio may be clipping.`);
      }
    } catch {
      issues.push("Could not analyze audio levels.");
    }
  }

  try {
    const black = await runFfmpeg(
      [
        "-i",
        filePath,
        "-vf",
        "blackdetect=d=1:pix_th=0.10",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { ffmpegPath: expected.ffmpegPath, timeoutMs: 120_000 },
    );
    const durations = [...black.stderr.matchAll(/black_duration:([\d.]+)/g)].map(
      (match) => Number(match[1]),
    );
    details.blackFrameDurations = durations;
    if (durations.some((value) => value >= 1)) {
      issues.push(
        `Detected black frames lasting ${durations.filter((value) => value >= 1).join(", ")}s.`,
      );
    }
  } catch {
    // Black-frame detection is best-effort; failure to run it is not a render failure.
  }

  return {
    passed: issues.length === 0,
    issues,
    details,
  };
}
