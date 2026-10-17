import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runFfmpeg } from "../lib/ffmpeg";
import { cleanupDir, createTempDir } from "../lib/fs";
import { validateRenderedVideo } from "./validate";

let dir: string;
let validPath: string;
let noAudioPath: string;

beforeAll(async () => {
  dir = await createTempDir("validate-test-");
  validPath = `${dir}/valid.mp4`;
  noAudioPath = `${dir}/no-audio.mp4`;
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=2:r=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    validPath,
  ]);
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=2:r=30",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    noAudioPath,
  ]);
});

afterAll(async () => {
  await cleanupDir(dir);
});

describe("rendered video validation", () => {
  it("passes a valid vertical-ready clip with audio", async () => {
    const result = await validateRenderedVideo(validPath, {
      durationSeconds: 2,
      width: 320,
      height: 240,
      minFileSizeBytes: 1000,
    });
    expect(result.issues).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.details.videoCodec).toBe("h264");
    expect(result.details.audioCodec).toBe("aac");
    expect(result.details.fps).toBeCloseTo(30, 1);
  });

  it("rejects a clip with no audio stream", async () => {
    const result = await validateRenderedVideo(noAudioPath, {
      durationSeconds: 2,
      width: 320,
      height: 240,
      minFileSizeBytes: 1000,
    });
    expect(result.passed).toBe(false);
    expect(result.issues.join(" ")).toMatch(/no audio stream/i);
  });

  it("rejects the wrong resolution", async () => {
    const result = await validateRenderedVideo(validPath, {
      durationSeconds: 2,
      width: 1920,
      height: 1080,
      minFileSizeBytes: 1000,
    });
    expect(result.passed).toBe(false);
    expect(result.issues.join(" ")).toMatch(/resolution/i);
  });
});
