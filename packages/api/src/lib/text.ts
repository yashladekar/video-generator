import { existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import TextToSVG from "text-to-svg";

let cachedRenderer: TextToSVG | null = null;

export function getFontPath(): string {
  const candidates = [
    process.env.APP_FONT_PATH,
    path.resolve(process.cwd(), "assets/fonts/Inter-Variable.ttf"),
    path.resolve(process.cwd(), "packages/api/assets/fonts/Inter-Variable.ttf"),
    path.resolve(process.cwd(), "../api/assets/fonts/Inter-Variable.ttf"),
    path.resolve(process.cwd(), "../../packages/api/assets/fonts/Inter-Variable.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ].filter(Boolean) as string[];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "No font file found. Set APP_FONT_PATH or install a system font.",
    );
  }
  return found;
}

export function getTextRenderer(): TextToSVG {
  if (!cachedRenderer) {
    cachedRenderer = TextToSVG.loadSync(getFontPath());
  }
  return cachedRenderer;
}

export function wrapText(
  text: string,
  options: { fontSize: number; maxWidth: number; maxLines: number },
): string[] {
  const renderer = getTextRenderer();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const widthOf = (value: string) =>
    renderer.getMetrics(value, {
      fontSize: options.fontSize,
      kerning: true,
    }).width;

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next) <= options.maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > options.maxLines) {
    const kept = lines.slice(0, options.maxLines);
    const last = kept[options.maxLines - 1] ?? "";
    let trimmed = last;
    while (trimmed.length > 0 && widthOf(`${trimmed}…`) > options.maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    kept[options.maxLines - 1] = `${trimmed}…`;
    return kept;
  }
  return lines;
}

export function textPathsToSvg(options: {
  lines: string[];
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  align?: "left" | "center" | "right";
  stroke?: string;
  strokeWidth?: number;
  topPadding: number;
}): string {
  const renderer = getTextRenderer();
  const paths: string[] = [];
  const align = options.align ?? "center";
  const anchor =
    align === "center" ? "center top" : align === "right" ? "right top" : "left top";
  const x =
    align === "center"
      ? options.width / 2
      : align === "right"
        ? options.width - 48
        : 48;

  options.lines.forEach((line, index) => {
    const y = options.topPadding + index * options.lineHeight;
    const d = renderer.getD(line, {
      x,
      y,
      fontSize: options.fontSize,
      anchor,
      kerning: true,
    });
    if (options.stroke) {
      paths.push(
        `<path d="${d}" fill="${options.stroke}" stroke="${options.stroke}" stroke-width="${options.strokeWidth ?? 8}" stroke-linejoin="round" />`,
      );
    }
    paths.push(`<path d="${d}" fill="${options.color}" />`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">${paths.join("")}</svg>`;
}

export async function renderTextPng(options: {
  lines: string[];
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  align?: "left" | "center" | "right";
  stroke?: string;
  strokeWidth?: number;
  topPadding: number;
  background?: { color: string; radius?: number; paddingX?: number; paddingY?: number };
}): Promise<Buffer> {
  const textSvg = textPathsToSvg(options);
  const layers: Buffer[] = [];
  if (options.background) {
    const radius = options.background.radius ?? 18;
    const padX = options.background.paddingX ?? 24;
    const padY = options.background.paddingY ?? 18;
    const rect = `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}"><rect x="${padX}" y="${padY}" width="${options.width - padX * 2}" height="${options.height - padY * 2}" rx="${radius}" fill="${options.background.color}" /></svg>`;
    layers.push(await sharp(Buffer.from(rect)).png().toBuffer());
  }
  layers.push(await sharp(Buffer.from(textSvg)).png().toBuffer());
  return sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers.map((input) => ({ input, top: 0, left: 0 })))
    .png()
    .toBuffer();
}
