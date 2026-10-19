import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/worker.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@video-generator\/.*/],
    neverBundle: [
      "sharp",
      "ffmpeg-static",
      "ffprobe-static",
      "@ffprobe-installer/ffprobe",
    ],
  },
});
