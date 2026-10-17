import { createHash } from "node:crypto";

import sharp from "sharp";

import { renderTextPng, wrapText } from "../../lib/text";
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  ImageProvider,
  ProviderCallContext,
  ResolvedProvider,
} from "../types";

type Palette = {
  background: [string, string];
  accent: string;
  secondary: string;
  text: string;
};

const PALETTES: Record<string, Palette> = {
  cinematic: {
    background: ["#07121f", "#102a3a"],
    accent: "#f5b84b",
    secondary: "#4fd1c5",
    text: "#f8fafc",
  },
  minimal: {
    background: ["#f4f1ea", "#dcd7cc"],
    accent: "#1f2937",
    secondary: "#7c8a9a",
    text: "#111827",
  },
  bold: {
    background: ["#0a0a0a", "#1a1010"],
    accent: "#ef4444",
    secondary: "#facc15",
    text: "#fafafa",
  },
  documentary: {
    background: ["#1d1a16", "#3b2f24"],
    accent: "#d6a35c",
    secondary: "#8fa17a",
    text: "#f7f3ea",
  },
  tech: {
    background: ["#050816", "#0d1b3a"],
    accent: "#22d3ee",
    secondary: "#8b5cf6",
    text: "#e2e8f0",
  },
  nature: {
    background: ["#0b1f17", "#163a2a"],
    accent: "#84cc16",
    secondary: "#38bdf8",
    text: "#f0fdf4",
  },
};

function hashSeed(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shortLabel(prompt: string): string {
  const words = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8);
  const label = words.join(" ");
  return label.length > 0 ? label : "FACELESS REEL";
}

function buildBackgroundSvg(
  width: number,
  height: number,
  palette: Palette,
  rand: () => number,
): string {
  const [a, b] = palette.background;
  const shapes: string[] = [];
  const shapeCount = 6;
  for (let i = 0; i < shapeCount; i += 1) {
    const cx = Math.round(rand() * width);
    const cy = Math.round(rand() * height);
    const radius = Math.round((0.08 + rand() * 0.24) * width);
    const color = i % 2 === 0 ? palette.accent : palette.secondary;
    const opacity = 0.06 + rand() * 0.12;
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" opacity="${opacity.toFixed(3)}" />`,
    );
  }
  const diagonalY = Math.round(height * (0.25 + rand() * 0.5));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${a}" />
        <stop offset="100%" stop-color="${b}" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="35%" r="65%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.35" />
        <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)" />
    <rect width="${width}" height="${height}" fill="url(#glow)" />
    ${shapes.join("")}
    <line x1="0" y1="${diagonalY}" x2="${width}" y2="${diagonalY + Math.round(height * 0.18)}" stroke="${palette.text}" stroke-opacity="0.08" stroke-width="2" />
    <line x1="0" y1="${diagonalY + 18}" x2="${width}" y2="${diagonalY + Math.round(height * 0.18) + 18}" stroke="${palette.accent}" stroke-opacity="0.18" stroke-width="1" />
  </svg>`;
}

export async function renderProceduralImage(
  prompt: string,
  options?: {
    width?: number;
    height?: number;
    style?: string;
    seed?: number;
  },
): Promise<{ image: Buffer; width: number; height: number }> {
  const width = options?.width ?? 1080;
  const height = options?.height ?? 1920;
  const palette = PALETTES[options?.style ?? "cinematic"] ?? PALETTES.cinematic!;
  const seed = options?.seed ?? hashSeed(prompt);
  const rand = mulberry32(seed);

  const background = await sharp(
    Buffer.from(buildBackgroundSvg(width, height, palette, rand)),
  )
    .png()
    .toBuffer();

  const label = shortLabel(prompt);
  const lines = wrapText(label, {
    fontSize: Math.round(width * 0.062),
    maxWidth: Math.round(width * 0.82),
    maxLines: 3,
  });
  const fontSize = Math.round(width * 0.062);
  const textHeight = Math.max(220, lines.length * Math.round(fontSize * 1.25) + 80);
  const textPng = await renderTextPng({
    lines,
    width,
    height: textHeight,
    fontSize,
    lineHeight: Math.round(fontSize * 1.25),
    color: palette.text,
    align: "center",
    topPadding: 36,
    background: {
      color: "rgba(0,0,0,0.28)",
      radius: 24,
      paddingX: Math.round(width * 0.07),
      paddingY: 18,
    },
  });

  const image = await sharp(background)
    .composite([
      {
        input: textPng,
        top: height - textHeight - Math.round(height * 0.16),
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return { image, width, height };
}

export const proceduralImageProvider: ImageProvider = {
  provider: "procedural",
  async generateImage(
    input: ImageGenerateInput,
    resolved: ResolvedProvider,
    _ctx: ProviderCallContext,
  ): Promise<ImageGenerateOutput> {
    const style =
      input.style ??
      (typeof resolved.config.style === "string"
        ? resolved.config.style
        : "cinematic");
    const rendered = await renderProceduralImage(input.prompt, {
      width: input.width,
      height: input.height,
      style,
      seed: input.seed,
    });
    return {
      image: rendered.image,
      mimeType: "image/png",
      width: rendered.width,
      height: rendered.height,
      provider: "procedural",
      usage: {
        unit: "image",
        inputUnits: 1,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
      },
    };
  },
};
