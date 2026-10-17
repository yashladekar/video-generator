import path from "node:path";

import { ProviderError } from "../../lib/errors";
import { runProcess } from "../../lib/ffmpeg";
import { cleanupDir, createTempDir } from "../../lib/fs";
import { configString } from "../resolve";
import type {
  ProviderCallContext,
  ResolvedProvider,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "../types";
import { normalizeAudioFile } from "./audio";

function voiceForLanguage(
  language: string | undefined,
  configured?: string,
): string {
  if (configured) return configured;
  const normalized = (language ?? "en").toLowerCase();
  if (normalized.startsWith("hi")) return "Lekha";
  if (normalized.startsWith("es")) return "Monica";
  if (normalized.startsWith("fr")) return "Amelie";
  if (normalized.startsWith("de")) return "Anna";
  return "Samantha";
}

export const macosSayTtsProvider: TtsProvider = {
  provider: "macos-say",
  async synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput> {
    if (process.platform !== "darwin") {
      throw new ProviderError(
        "TTS_UNAVAILABLE",
        "macOS say is only available on macOS",
        { provider: "macos-say", kind: "PROVIDER_TRANSIENT" },
      );
    }
    const voice = voiceForLanguage(
      input.language,
      input.voice ?? configString(resolved, "voice"),
    );
    const rate = Math.round(
      Math.min(300, Math.max(90, 175 * (input.speed ?? 1))),
    );
    const dir = await createTempDir("say-");
    try {
      const aiffPath = path.join(dir, "speech.aiff");
      await runProcess(
        "/usr/bin/say",
        ["-v", voice, "-r", String(rate), "-o", aiffPath],
        { input: input.text, timeoutMs: 180_000 },
      );
      const normalized = await normalizeAudioFile(aiffPath, ctx);
      return {
        audio: normalized.audio,
        mimeType: normalized.mimeType,
        extension: "wav",
        durationSeconds: normalized.durationSeconds,
        provider: "macos-say",
        usage: {
          unit: "character",
          inputUnits: input.text.length,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "TTS_SYNTHESIS_FAILED",
        `macOS say failed: ${error instanceof Error ? error.message : String(error)}`,
        { provider: "macos-say", kind: "PROVIDER_TRANSIENT", cause: error },
      );
    } finally {
      await cleanupDir(dir);
    }
  },
};

export const espeakTtsProvider: TtsProvider = {
  provider: "espeak-ng",
  async synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput> {
    const binary =
      input.voice ?? configString(resolved, "voice", "en") ?? "en";
    const speed = Math.round(
      Math.min(450, Math.max(80, 175 * (input.speed ?? 1))),
    );
    const dir = await createTempDir("espeak-");
    try {
      const wavPath = path.join(dir, "speech.wav");
      await runProcess(
        configString(resolved, "binaryPath", "espeak-ng") ?? "espeak-ng",
        ["-v", binary, "-s", String(speed), "-w", wavPath],
        { input: input.text, timeoutMs: 180_000 },
      );
      const normalized = await normalizeAudioFile(wavPath, ctx);
      return {
        audio: normalized.audio,
        mimeType: normalized.mimeType,
        extension: "wav",
        durationSeconds: normalized.durationSeconds,
        provider: "espeak-ng",
        usage: {
          unit: "character",
          inputUnits: input.text.length,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "TTS_SYNTHESIS_FAILED",
        `eSpeak NG failed: ${error instanceof Error ? error.message : String(error)}`,
        { provider: "espeak-ng", kind: "PROVIDER_TRANSIENT", cause: error },
      );
    } finally {
      await cleanupDir(dir);
    }
  },
};

export const piperTtsProvider: TtsProvider = {
  provider: "piper",
  async synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput> {
    const binary =
      configString(resolved, "binaryPath", ctx.env.PIPER_BIN) ?? "";
    const model = configString(resolved, "modelPath", ctx.env.PIPER_MODEL) ?? "";
    if (!binary || !model) {
      throw new ProviderError(
        "TTS_UNAVAILABLE",
        "Piper requires a binary path and a voice model path",
        { provider: "piper", kind: "PROVIDER_TRANSIENT" },
      );
    }
    const dir = await createTempDir("piper-");
    try {
      const wavPath = path.join(dir, "speech.wav");
      await runProcess(
        binary,
        ["--model", model, "--output_file", wavPath],
        { input: input.text, timeoutMs: 240_000 },
      );
      const normalized = await normalizeAudioFile(wavPath, ctx);
      return {
        audio: normalized.audio,
        mimeType: normalized.mimeType,
        extension: "wav",
        durationSeconds: normalized.durationSeconds,
        provider: "piper",
        usage: {
          unit: "character",
          inputUnits: input.text.length,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "TTS_SYNTHESIS_FAILED",
        `Piper failed: ${error instanceof Error ? error.message : String(error)}`,
        { provider: "piper", kind: "PROVIDER_TRANSIENT", cause: error },
      );
    } finally {
      await cleanupDir(dir);
    }
  },
};
