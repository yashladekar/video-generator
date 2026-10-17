import { ProviderError } from "../../lib/errors";
import { fetchBuffer, joinUrl } from "../http";
import { configString, secretValue } from "../resolve";
import type {
  ProviderCallContext,
  ResolvedProvider,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "../types";
import { normalizeAudioBuffer } from "./audio";

export const openAiTtsProvider: TtsProvider = {
  provider: "openai",
  async synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput> {
    const apiKey = secretValue(resolved, "apiKey", ctx.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No API key configured for OpenAI TTS",
        { provider: "openai", kind: "PROVIDER_PERMANENT" },
      );
    }
    const baseUrl = configString(
      resolved,
      "baseUrl",
      ctx.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    )!;
    const model = configString(resolved, "model", "tts-1")!;
    const voice = input.voice ?? configString(resolved, "voice", "alloy")!;
    const response = await fetchBuffer(
      joinUrl(baseUrl, "/audio/speech"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          voice,
          input: input.text,
          response_format: "wav",
        }),
      },
      {
        provider: "openai",
        signal: ctx.signal,
        timeoutMs: 180_000,
        maxBytes: 50 * 1024 * 1024,
      },
    );
    const normalized = await normalizeAudioBuffer(response.data, "wav", ctx);
    return {
      audio: normalized.audio,
      mimeType: normalized.mimeType,
      extension: "wav",
      durationSeconds: normalized.durationSeconds,
      provider: "openai",
      usage: {
        unit: "character",
        inputUnits: input.text.length,
      },
    };
  },
};

export const elevenLabsTtsProvider: TtsProvider = {
  provider: "elevenlabs",
  async synthesize(
    input: TtsSynthesizeInput,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<TtsSynthesizeOutput> {
    const apiKey = secretValue(
      resolved,
      "apiKey",
      ctx.env.ELEVENLABS_API_KEY,
    );
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No API key configured for ElevenLabs",
        { provider: "elevenlabs", kind: "PROVIDER_PERMANENT" },
      );
    }
    const voiceId =
      input.voice ?? configString(resolved, "voiceId") ?? "";
    if (!voiceId) {
      throw new ProviderError(
        "TTS_VOICE_REQUIRED",
        "ElevenLabs requires a voice ID in provider settings",
        { provider: "elevenlabs", kind: "PROVIDER_PERMANENT" },
      );
    }
    const baseUrl = configString(
      resolved,
      "baseUrl",
      "https://api.elevenlabs.io/v1",
    )!;
    const modelId = configString(
      resolved,
      "modelId",
      "eleven_multilingual_v2",
    )!;
    const response = await fetchBuffer(
      joinUrl(baseUrl, `/text-to-speech/${encodeURIComponent(voiceId)}`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: input.text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
      {
        provider: "elevenlabs",
        signal: ctx.signal,
        timeoutMs: 180_000,
        maxBytes: 100 * 1024 * 1024,
      },
    );
    const normalized = await normalizeAudioBuffer(response.data, "mp3", ctx);
    return {
      audio: normalized.audio,
      mimeType: normalized.mimeType,
      extension: "wav",
      durationSeconds: normalized.durationSeconds,
      provider: "elevenlabs",
      usage: {
        unit: "character",
        inputUnits: input.text.length,
      },
    };
  },
};
