import sharp from "sharp";

import { ProviderError } from "../lib/errors";
import { fetchBuffer } from "./http";
import type { ProviderCallContext } from "./types";

export type TemplateValues = Record<string, string | number | undefined>;

export function substituteTemplate(value: unknown, values: TemplateValues): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{(\w+)\}\}$/.exec(value);
    if (exact?.[1]) {
      const replacement = values[exact[1]];
      return replacement === undefined ? "" : replacement;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const replacement = values[key];
      return replacement === undefined ? "" : String(replacement);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteTemplate(item, values));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteTemplate(item, values);
    }
    return result;
  }
  return value;
}

export function asTemplate(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function findFirstUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findFirstUrl(item);
      if (found) return found;
    }
  }
  return undefined;
}

export async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new ProviderError("PROVIDER_ABORTED", "Request aborted", {
      kind: "PROVIDER_TRANSIENT",
    });
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new ProviderError("PROVIDER_ABORTED", "Request aborted", {
          kind: "PROVIDER_TRANSIENT",
        }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function downloadImage(
  url: string,
  width: number,
  height: number,
  ctx: ProviderCallContext,
  provider: string,
): Promise<Buffer> {
  const response = await fetchBuffer(
    url,
    {},
    {
      provider,
      signal: ctx.signal,
      timeoutMs: 120_000,
      maxBytes: 80 * 1024 * 1024,
    },
  );
  return sharp(response.data)
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function downloadVideo(
  url: string,
  ctx: ProviderCallContext,
  provider: string,
): Promise<{ video: Buffer; mimeType: string }> {
  const response = await fetchBuffer(
    url,
    {},
    {
      provider,
      signal: ctx.signal,
      timeoutMs: 300_000,
      maxBytes: 250 * 1024 * 1024,
    },
  );
  return { video: response.data, mimeType: response.mimeType || "video/mp4" };
}
