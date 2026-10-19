import { existsSync } from "node:fs";

import type { ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto";
import { toJsonValue } from "../lib/json";
import { runProcess } from "../lib/ffmpeg";
import { getProviderDefinition, PROVIDER_CATALOG } from "../providers/catalog";
import { fetchJson, joinUrl } from "../providers/http";
import { configString, resolveProviderChain } from "../providers/resolve";
import { testYouTubeConnection } from "../providers/publishing/youtube";
import type { YouTubeCredentials } from "../providers/publishing/youtube";

function envConfigured(provider: string, ctx: Context): boolean {
  const env = ctx.env;
  switch (provider) {
    case "openai-compatible":
    case "openai":
      return Boolean(env.OPENAI_API_KEY);
    case "elevenlabs":
      return Boolean(env.ELEVENLABS_API_KEY);
    case "pexels":
      return Boolean(env.PEXELS_API_KEY);
    case "fal":
      return Boolean(env.FAL_KEY);
    case "wavespeed":
      return Boolean(env.WAVESPEED_API_KEY);
    case "comfyui":
      return Boolean(env.COMFYUI_BASE_URL);
    case "ollama":
      return Boolean(env.OLLAMA_BASE_URL);
    case "tavily":
      return Boolean(env.TAVILY_API_KEY);
    case "youtube":
      return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);
    case "s3":
      return Boolean(env.S3_BUCKET);
    default:
      return false;
  }
}

export async function listProviderConfigs(
  ctx: Context,
  userId: string,
  category?: ProviderCategory,
) {
  const rows = await ctx.db.providerConfiguration.findMany({
    where: { userId, ...(category ? { category } : {}) },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    provider: row.provider,
    label:
      row.label ??
      getProviderDefinition(row.provider, row.category)?.label ??
      row.provider,
    enabled: row.enabled,
    isDefault: row.isDefault,
    config: row.config,
    hasSecret: Boolean(row.encryptedSecret),
    secretLast4: row.secretLast4,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
    envConfigured: envConfigured(row.provider, ctx),
  }));
}

export async function upsertProviderConfig(
  ctx: Context,
  userId: string,
  input: {
    category: ProviderCategory;
    provider: string;
    label?: string;
    enabled: boolean;
    isDefault: boolean;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
  },
) {
  const existing = await ctx.db.providerConfiguration.findUnique({
    where: {
      userId_category_provider: {
        userId,
        category: input.category,
        provider: input.provider,
      },
    },
  });

  let encryptedSecret = existing?.encryptedSecret ?? null;
  let secretLast4 = existing?.secretLast4 ?? null;
  if (input.secrets && Object.keys(input.secrets).length > 0) {
    encryptedSecret = encryptSecret(
      JSON.stringify(input.secrets),
      ctx.env.APP_ENCRYPTION_KEY,
    );
    const firstValue = Object.values(input.secrets)[0];
    secretLast4 = firstValue ? maskSecret(firstValue) : null;
  }

  if (input.isDefault) {
    await ctx.db.providerConfiguration.updateMany({
      where: {
        userId,
        category: input.category,
        provider: { not: input.provider },
      },
      data: { isDefault: false },
    });
  }

  const row = await ctx.db.providerConfiguration.upsert({
    where: {
      userId_category_provider: {
        userId,
        category: input.category,
        provider: input.provider,
      },
    },
    update: {
      label: input.label,
      enabled: input.enabled,
      isDefault: input.isDefault,
      config: toJsonValue(input.config),
      encryptedSecret,
      secretLast4,
    },
    create: {
      userId,
      category: input.category,
      provider: input.provider,
      label: input.label,
      enabled: input.enabled,
      isDefault: input.isDefault,
      config: toJsonValue(input.config),
      encryptedSecret,
      secretLast4,
    },
  });

  await ctx.db.auditLog.create({
    data: {
      userId,
      action: "provider_config.upsert",
      entityType: "ProviderConfiguration",
      entityId: row.id,
      metadata: toJsonValue({
        category: input.category,
        provider: input.provider,
        hasSecret: Boolean(encryptedSecret),
        enabled: input.enabled,
        isDefault: input.isDefault,
      }),
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.userAgent,
    },
  });

  return {
    id: row.id,
    category: row.category,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled,
    isDefault: row.isDefault,
    hasSecret: Boolean(row.encryptedSecret),
    secretLast4: row.secretLast4,
    envConfigured: envConfigured(row.provider, ctx),
  };
}

export async function deleteProviderConfig(
  ctx: Context,
  userId: string,
  category: ProviderCategory,
  provider: string,
) {
  await ctx.db.providerConfiguration.deleteMany({
    where: { userId, category, provider },
  });
  await ctx.db.auditLog.create({
    data: {
      userId,
      action: "provider_config.delete",
      entityType: "ProviderConfiguration",
      entityId: `${category}:${provider}`,
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.userAgent,
    },
  });
}

async function updateTestStatus(
  ctx: Context,
  userId: string,
  category: ProviderCategory,
  provider: string,
  ok: boolean,
  message: string,
) {
  await ctx.db.providerConfiguration
    .updateMany({
      where: { userId, category, provider },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: ok ? "OK" : "FAILED",
        lastError: ok ? null : message,
      },
    })
    .catch(() => undefined);
}

export async function testProvider(
  ctx: Context,
  userId: string,
  category: ProviderCategory,
  provider: string,
): Promise<{ ok: boolean; message: string }> {
  const chain = await resolveProviderChain(ctx, userId, category, provider);
  const resolved = chain.find((entry) => entry.provider === provider);
  if (!resolved) {
    return { ok: false, message: `${provider} is not configured` };
  }
  const config = resolved.config;
  const secrets = resolved.secrets;
  const signal = AbortSignal.timeout(20_000);

  const result = await (async (): Promise<{ ok: boolean; message: string }> => {
    try {
      if (provider === "template" || provider === "procedural" || provider === "music-generator" || provider === "local") {
        return { ok: true, message: "Always available (local/built-in)" };
      }
      if (provider === "macos-say") {
        return process.platform === "darwin" && existsSync("/usr/bin/say")
          ? { ok: true, message: "macOS say is available" }
          : { ok: false, message: "macOS say is only available on macOS" };
      }
      if (provider === "espeak-ng") {
        const binary =
          configString(resolved, "binaryPath", "espeak-ng") ?? "espeak-ng";
        try {
          const version = await runProcess(binary, ["--version"], {
            timeoutMs: 5_000,
          });
          return {
            ok: version.exitCode === 0,
            message:
              version.exitCode === 0
                ? `eSpeak NG is available (${binary})`
                : `eSpeak NG exited with code ${version.exitCode}`,
          };
        } catch {
          return {
            ok: false,
            message:
              "eSpeak NG binary was not found in this environment. Install it or use another TTS provider.",
          };
        }
      }
      if (provider === "piper") {
        const binary = configString(resolved, "binaryPath", ctx.env.PIPER_BIN) ?? "";
        const model = configString(resolved, "modelPath", ctx.env.PIPER_MODEL) ?? "";
        return binary && model && existsSync(binary) && existsSync(model)
          ? { ok: true, message: "Piper binary and voice model are available" }
          : { ok: false, message: "Set PIPER_BIN and PIPER_MODEL to an installed binary and voice model" };
      }
      if (provider === "ollama") {
        const baseUrl = configString(
          resolved,
          "baseUrl",
          ctx.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
        )!;
        const response = await fetchJson<{ models?: Array<{ name: string }> }>(
          joinUrl(baseUrl, "/api/tags"),
          { signal },
          { provider: "ollama", signal, timeoutMs: 10_000 },
        );
        const models = response.data.models?.map((model) => model.name) ?? [];
        return {
          ok: true,
          message: models.length
            ? `Ollama reachable. Installed models: ${models.slice(0, 6).join(", ")}`
            : "Ollama is reachable, but no models are installed. Run `ollama pull llama3.2:3b`.",
        };
      }
      if (provider === "openai-compatible") {
        const baseUrl = configString(
          resolved,
          "baseUrl",
          ctx.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        )!;
        const apiKey = secrets.apiKey ?? ctx.env.OPENAI_API_KEY;
        if (!apiKey) return { ok: false, message: "No API key configured" };
        await fetchJson(
          joinUrl(baseUrl, "/models"),
          { headers: { Authorization: `Bearer ${apiKey}` }, signal },
          { provider: "openai-compatible", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "OpenAI-compatible endpoint and API key are valid" };
      }
      if (provider === "openai") {
        const baseUrl = configString(
          resolved,
          "baseUrl",
          ctx.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        )!;
        const apiKey = secrets.apiKey ?? ctx.env.OPENAI_API_KEY;
        if (!apiKey) return { ok: false, message: "No API key configured" };
        await fetchJson(
          joinUrl(baseUrl, "/models"),
          { headers: { Authorization: `Bearer ${apiKey}` }, signal },
          { provider: "openai", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "OpenAI API key is valid" };
      }
      if (provider === "elevenlabs") {
        const apiKey = secrets.apiKey ?? ctx.env.ELEVENLABS_API_KEY;
        if (!apiKey) return { ok: false, message: "No API key configured" };
        await fetchJson(
          "https://api.elevenlabs.io/v1/user",
          { headers: { "xi-api-key": apiKey }, signal },
          { provider: "elevenlabs", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "ElevenLabs API key is valid" };
      }
      if (provider === "pexels") {
        const apiKey = secrets.apiKey ?? ctx.env.PEXELS_API_KEY;
        if (!apiKey) return { ok: false, message: "No Pexels API key configured" };
        await fetchJson(
          "https://api.pexels.com/v1/curated?per_page=1",
          { headers: { Authorization: apiKey }, signal },
          { provider: "pexels", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "Pexels API key is valid" };
      }
      if (provider === "fal") {
        const apiKey = secrets.apiKey ?? ctx.env.FAL_KEY;
        if (!apiKey) return { ok: false, message: "No fal.ai API key configured" };
        await fetchJson(
          "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/schnell",
          { headers: { Authorization: `Key ${apiKey}` }, signal },
          { provider: "fal", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "fal.ai API key is valid" };
      }
      if (provider === "wavespeed") {
        const apiKey = secrets.apiKey ?? ctx.env.WAVESPEED_API_KEY;
        if (!apiKey) return { ok: false, message: "No WaveSpeedAI API key configured" };
        const model =
          configString(resolved, "model", "wavespeed-ai/z-image/turbo")!;
        await fetchJson(
          "https://api.wavespeed.ai/api/v3/model/price",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model_id: model }),
            signal,
          },
          { provider: "wavespeed", signal, timeoutMs: 15_000 },
        );
        return { ok: true, message: "WaveSpeedAI API key is valid" };
      }
      if (provider === "comfyui") {
        const baseUrl = configString(
          resolved,
          "baseUrl",
          ctx.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
        )!;
        await fetchJson(
          joinUrl(baseUrl, "system_stats"),
          { signal },
          { provider: "comfyui", signal, timeoutMs: 10_000 },
        );
        return { ok: true, message: "ComfyUI is reachable" };
      }
      if (provider === "wikipedia") {
        await fetchJson(
          "https://en.wikipedia.org/api/rest_v1/page/summary/Wikipedia",
          { signal },
          { provider: "wikipedia", signal, timeoutMs: 10_000 },
        );
        return { ok: true, message: "Wikipedia research API is reachable" };
      }
      if (provider === "youtube") {
        const account = await ctx.db.publishingAccount.findFirst({
          where: { userId, platform: "YOUTUBE" },
          orderBy: { createdAt: "desc" },
        });
        if (!account) {
          return {
            ok: false,
            message:
              "No YouTube account is connected. Configure the OAuth client and connect an account first.",
          };
        }
        const credentials = JSON.parse(
          decryptSecret(account.encryptedCredentials, ctx.env.APP_ENCRYPTION_KEY),
        ) as YouTubeCredentials;
        return testYouTubeConnection(credentials, {
          env: ctx.env,
          signal,
          logger: ctx.logger,
          userId,
        });
      }
      if (provider === "s3") {
        return {
          ok: Boolean(config.bucket),
          message: config.bucket
            ? "S3 configuration is present; run a generation to verify writes."
            : "Set an S3 bucket and credentials.",
        };
      }
      return { ok: false, message: `No test is implemented for ${provider}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  await updateTestStatus(ctx, userId, category, provider, result.ok, result.message);
  return result;
}

export async function detectCapabilities(ctx: Context) {
  const capabilities: Array<{
    id: string;
    label: string;
    available: boolean;
    detail: string;
  }> = [];
  capabilities.push({
    id: "ffmpeg",
    label: "FFmpeg",
    available: true,
    detail: ctx.env.FFMPEG_PATH
      ? `Configured at ${ctx.env.FFMPEG_PATH}`
      : "Using the bundled ffmpeg-static binary in local development; Docker images use system FFmpeg.",
  });
  capabilities.push({
    id: "macos-say",
    label: "macOS say",
    available: process.platform === "darwin" && existsSync("/usr/bin/say"),
    detail:
      process.platform === "darwin"
        ? "Built-in speech synthesis is available"
        : "Not available on this platform",
  });
  capabilities.push({
    id: "piper",
    label: "Piper TTS",
    available: Boolean(ctx.env.PIPER_BIN && ctx.env.PIPER_MODEL),
    detail: ctx.env.PIPER_BIN
      ? `Binary: ${ctx.env.PIPER_BIN}`
      : "Set PIPER_BIN and PIPER_MODEL to enable local neural TTS",
  });
  try {
    const response = await fetchJson<{ models?: Array<{ name: string }> }>(
      joinUrl(
        ctx.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
        "/api/tags",
      ),
      { signal: AbortSignal.timeout(3000) },
      {
        provider: "ollama",
        signal: AbortSignal.timeout(3000),
        timeoutMs: 3000,
      },
    );
    const models = response.data.models?.map((model) => model.name) ?? [];
    capabilities.push({
      id: "ollama",
      label: "Ollama",
      available: true,
      detail: models.length
        ? `Installed: ${models.slice(0, 6).join(", ")}`
        : "Reachable, but no models are installed. Run `ollama pull llama3.2:3b`.",
    });
  } catch {
    capabilities.push({
      id: "ollama",
      label: "Ollama",
      available: false,
      detail:
        "Not reachable. Install Ollama and run `ollama pull llama3.2:3b`, or configure a hosted LLM.",
    });
  }
  try {
    await fetchJson(
      joinUrl(
        ctx.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
        "system_stats",
      ),
      { signal: AbortSignal.timeout(3000) },
      {
        provider: "comfyui",
        signal: AbortSignal.timeout(3000),
        timeoutMs: 3000,
      },
    );
    capabilities.push({
      id: "comfyui",
      label: "ComfyUI",
      available: true,
      detail: "Reachable",
    });
  } catch {
    capabilities.push({
      id: "comfyui",
      label: "ComfyUI",
      available: false,
      detail:
        "Not reachable. Install ComfyUI separately and set COMFYUI_BASE_URL if you want local AI images/video.",
    });
  }
  return {
    capabilities,
    catalog: PROVIDER_CATALOG.map((entry) => ({
      ...entry,
      envConfigured: envConfigured(entry.id, ctx),
    })),
  };
}
