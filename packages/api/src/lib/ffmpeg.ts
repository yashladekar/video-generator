import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffprobeStatic from "ffprobe-static";

import { MediaError } from "./errors";

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function resolveFfmpegPath(override?: string): string {
  return override || ffmpegStatic || "ffmpeg";
}

export function resolveFfprobePath(override?: string): string {
  return override || ffprobeInstaller.path || ffprobeStatic.path || "ffprobe";
}

export async function runProcess(
  bin: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    cwd?: string;
    maxOutputBytes?: number;
    env?: NodeJS.ProcessEnv;
    input?: string | Buffer;
  },
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const maxOutputBytes = options?.maxOutputBytes ?? 8 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (options?.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new MediaError(
          "PROCESS_TIMEOUT",
          `${path.basename(bin)} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const collect = (chunks: Buffer[], chunk: Buffer, total: number) => {
      if (total >= maxOutputBytes) return total;
      const remaining = maxOutputBytes - total;
      chunks.push(chunk.subarray(0, remaining));
      return total + Math.min(chunk.length, remaining);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = collect(stdout, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = collect(stderr, chunk, stderrBytes);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new MediaError("PROCESS_SPAWN_FAILED", `Failed to run ${bin}`, {
          cause: error,
        }),
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: exitCode ?? -1,
      });
    });
  });
}

export async function runFfmpeg(
  args: string[],
  options?: {
    ffmpegPath?: string;
    timeoutMs?: number;
    cwd?: string;
  },
): Promise<ProcessResult> {
  const result = await runProcess(
    resolveFfmpegPath(options?.ffmpegPath),
    ["-hide_banner", "-nostdin", ...args],
    {
      timeoutMs: options?.timeoutMs ?? 20 * 60 * 1000,
      cwd: options?.cwd,
    },
  );
  if (result.exitCode !== 0) {
    throw new MediaError(
      "FFMPEG_FAILED",
      `FFmpeg failed with exit code ${result.exitCode}: ${result.stderr.slice(-4000)}`,
    );
  }
  return result;
}

export async function runFfprobe(
  args: string[],
  options?: { ffprobePath?: string; timeoutMs?: number },
): Promise<ProcessResult> {
  const result = await runProcess(
    resolveFfprobePath(options?.ffprobePath),
    ["-v", "error", ...args],
    { timeoutMs: options?.timeoutMs ?? 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new MediaError(
      "FFPROBE_FAILED",
      `ffprobe failed with exit code ${result.exitCode}: ${result.stderr.slice(-4000)}`,
    );
  }
  return result;
}

export type MediaInfo = {
  format: {
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name?: string;
  };
  streams: Array<{
    index: number;
    codec_type: "video" | "audio" | string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
  }>;
};

export async function probeMedia(
  filePath: string,
  options?: { ffprobePath?: string },
): Promise<MediaInfo> {
  const result = await runFfprobe(
    [
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ],
    { ffprobePath: options?.ffprobePath },
  );
  try {
    return JSON.parse(result.stdout) as MediaInfo;
  } catch (error) {
    throw new MediaError("FFPROBE_BAD_JSON", "Could not parse ffprobe output", {
      cause: error,
    });
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function getFileSize(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.size;
}

export async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export function concatFileLine(filePath: string): string {
  const absolute = path.resolve(filePath).replace(/'/g, "'\\''");
  return `file '${absolute}'`;
}
