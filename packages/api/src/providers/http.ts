import { ProviderError, providerErrorFromStatus } from "../lib/errors";

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseJsonLoose(text: string): unknown {
  const cleaned = stripJsonFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error("Response did not contain valid JSON");
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options?: {
    provider: string;
    signal: AbortSignal;
    timeoutMs?: number;
    requestIdHeader?: string;
  },
): Promise<{ data: T; requestId?: string; status: number; headers: Headers }> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const signal = AbortSignal.any([
    options?.signal ?? new AbortController().signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new ProviderError(
      "PROVIDER_NETWORK_ERROR",
      `${options?.provider ?? "provider"} request failed or timed out`,
      {
        kind: "PROVIDER_TRANSIENT",
        provider: options?.provider,
        cause: error,
      },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw providerErrorFromStatus(
      options?.provider ?? "provider",
      response.status,
      `${options?.provider ?? "provider"} returned HTTP ${response.status}: ${text.slice(0, 800)}`,
      options?.requestIdHeader
        ? response.headers.get(options.requestIdHeader) ?? undefined
        : undefined,
    );
  }
  try {
    return {
      data: JSON.parse(text) as T,
      requestId: options?.requestIdHeader
        ? response.headers.get(options.requestIdHeader) ?? undefined
        : undefined,
      status: response.status,
      headers: response.headers,
    };
  } catch (error) {
    throw new ProviderError(
      "PROVIDER_BAD_JSON",
      `${options?.provider ?? "provider"} returned invalid JSON`,
      {
        provider: options?.provider,
        status: response.status,
        cause: error,
      },
    );
  }
}

export async function fetchBuffer(
  url: string,
  init: RequestInit,
  options?: {
    provider: string;
    signal: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
  },
): Promise<{ data: Buffer; mimeType: string }> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const maxBytes = options?.maxBytes ?? 200 * 1024 * 1024;
  const signal = AbortSignal.any([
    options?.signal ?? new AbortController().signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new ProviderError(
      "PROVIDER_NETWORK_ERROR",
      `${options?.provider ?? "provider"} download failed or timed out`,
      { kind: "PROVIDER_TRANSIENT", provider: options?.provider, cause: error },
    );
  }
  if (!response.ok) {
    throw providerErrorFromStatus(
      options?.provider ?? "provider",
      response.status,
      `${options?.provider ?? "provider"} download returned HTTP ${response.status}`,
    );
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxBytes) {
    throw new ProviderError(
      "PROVIDER_FILE_TOO_LARGE",
      `Downloaded file is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`,
      { provider: options?.provider },
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new ProviderError(
      "PROVIDER_FILE_TOO_LARGE",
      `Downloaded file is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`,
      { provider: options?.provider },
    );
  }
  return {
    data: buffer,
    mimeType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}
