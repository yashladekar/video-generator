import pino from "pino";

import type { RuntimeEnv } from "../env";
import type { ProviderCallContext, ResolvedProvider } from "../providers/types";

export const testEnv: RuntimeEnv = {
  PUBLIC_API_URL: "http://localhost:3000",
  MEDIA_ROOT: "./test-media",
  MEDIA_SIGNING_SECRET: "test-signing-secret-0123456789abcdef",
  APP_ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef",
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  COMFYUI_BASE_URL: "http://127.0.0.1:8188",
};

export function silentLogger(): pino.Logger {
  return pino({ level: "silent" });
}

export function testProvider(
  provider: string,
  category: ResolvedProvider["category"],
  config: Record<string, unknown> = {},
): ResolvedProvider {
  return {
    provider,
    category,
    config,
    secrets: {},
    source: "builtin",
    enabled: true,
    isDefault: false,
  };
}

export function testCallContext(): ProviderCallContext {
  return {
    env: testEnv,
    signal: new AbortController().signal,
    logger: silentLogger(),
    userId: "test-user",
  };
}
