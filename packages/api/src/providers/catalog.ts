import type { ProviderCategory } from "@video-generator/db";

export type ProviderDefinition = {
  id: string;
  category: ProviderCategory;
  label: string;
  description: string;
  docsUrl?: string;
  local: boolean;
  free: boolean;
  secretLabel?: string;
  configHint?: string;
};

export const PROVIDER_CATALOG: ProviderDefinition[] = [
  {
    id: "template",
    category: "LLM",
    label: "Template (no AI)",
    description:
      "Deterministic structured script generator. Always available, zero cost, clearly labeled as non-AI.",
    local: true,
    free: true,
  },
  {
    id: "ollama",
    category: "LLM",
    label: "Ollama (local)",
    description:
      "Local LLM through Ollama. Pull a small model first, e.g. `ollama pull llama3.2:3b`.",
    docsUrl: "https://docs.ollama.com/api",
    local: true,
    free: true,
    configHint: "Base URL and model name.",
  },
  {
    id: "openai-compatible",
    category: "LLM",
    label: "OpenAI-compatible API",
    description:
      "OpenAI, OpenRouter, or another compatible endpoint. Uses /chat/completions with structured JSON output.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Base URL and model.",
  },
  {
    id: "wikipedia",
    category: "RESEARCH",
    label: "Wikipedia",
    description: "Free topic research through the MediaWiki REST/API endpoints.",
    docsUrl: "https://www.mediawiki.org/wiki/API:REST_API",
    local: false,
    free: true,
  },
  {
    id: "tavily",
    category: "RESEARCH",
    label: "Tavily",
    description: "Optional web research provider. Requires a Tavily API key.",
    docsUrl: "https://docs.tavily.com/",
    local: false,
    free: false,
    secretLabel: "API key",
  },
  {
    id: "macos-say",
    category: "TTS",
    label: "macOS say",
    description:
      "Built-in macOS speech synthesis. Local, free, and available on this machine.",
    local: true,
    free: true,
    configHint: "Voice name (optional).",
  },
  {
    id: "espeak-ng",
    category: "TTS",
    label: "eSpeak NG",
    description:
      "Local speech synthesis used inside the Linux worker image. Lower quality than hosted voices.",
    local: true,
    free: true,
  },
  {
    id: "piper",
    category: "TTS",
    label: "Piper",
    description:
      "Optional local neural TTS. Set the Piper binary and a downloaded voice model path.",
    docsUrl: "https://github.com/rhasspy/piper",
    local: true,
    free: true,
    configHint: "Binary path and model path.",
  },
  {
    id: "openai",
    category: "TTS",
    label: "OpenAI TTS",
    description: "Hosted speech synthesis through /audio/speech.",
    docsUrl: "https://platform.openai.com/docs/guides/text-to-speech",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Model and voice.",
  },
  {
    id: "elevenlabs",
    category: "TTS",
    label: "ElevenLabs",
    description: "Optional high-quality hosted narration. Verify current pricing before use.",
    docsUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Voice ID and model ID.",
  },
  {
    id: "procedural",
    category: "IMAGE",
    label: "Procedural motion graphics",
    description:
      "Generates original gradient/shape/typography visuals locally with deterministic variation. Zero cost.",
    local: true,
    free: true,
  },
  {
    id: "pexels",
    category: "IMAGE",
    label: "Pexels stock",
    description:
      "Free stock photos/videos. Requires a free Pexels API key and displays photographer attribution.",
    docsUrl: "https://www.pexels.com/api/documentation/",
    local: false,
    free: true,
    secretLabel: "API key",
  },
  {
    id: "fal",
    category: "IMAGE",
    label: "fal.ai",
    description:
      "Hosted image/video generation. Uses the queue API and live model pricing when configured.",
    docsUrl: "https://fal.ai/docs",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Model id and an input template.",
  },
  {
    id: "wavespeed",
    category: "IMAGE",
    label: "WaveSpeedAI",
    description:
      "Hosted image/video generation. Uses the v3 submit/result API and price quote endpoint.",
    docsUrl: "https://wavespeed.ai/docs",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Model id and an input template.",
  },
  {
    id: "comfyui",
    category: "IMAGE",
    label: "ComfyUI (local)",
    description:
      "Local image/video workflows. Not installed by default; configure the base URL and workflow templates.",
    docsUrl: "https://docs.comfy.org/",
    local: true,
    free: true,
    configHint: "Base URL and workflow JSON templates.",
  },
  {
    id: "pexels",
    category: "TEXT_TO_VIDEO",
    label: "Pexels stock video",
    description:
      "Free stock video clips. Requires a Pexels API key and displays attribution.",
    docsUrl: "https://www.pexels.com/api/documentation/",
    local: false,
    free: true,
    secretLabel: "API key",
  },
  {
    id: "fal",
    category: "TEXT_TO_VIDEO",
    label: "fal.ai video",
    description:
      "Hosted text-to-video clips. Budget-gated and limited to selected scenes.",
    docsUrl: "https://fal.ai/docs/model-api-reference/video-generation-api/overview",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Video model id and input template.",
  },
  {
    id: "wavespeed",
    category: "TEXT_TO_VIDEO",
    label: "WaveSpeedAI video",
    description:
      "Hosted text-to-video clips. Budget-gated and limited to selected scenes.",
    docsUrl: "https://wavespeed.ai/docs/submit-task",
    local: false,
    free: false,
    secretLabel: "API key",
    configHint: "Video model id and input template.",
  },
  {
    id: "comfyui",
    category: "TEXT_TO_VIDEO",
    label: "ComfyUI video (local)",
    description: "Local image-to-video/text-to-video workflows through ComfyUI.",
    docsUrl: "https://docs.comfy.org/",
    local: true,
    free: true,
    configHint: "Workflow JSON template.",
  },
  {
    id: "music-generator",
    category: "MUSIC",
    label: "Procedural music",
    description:
      "Original synthesized ambient/cinematic/lofi/upbeat beds generated locally with no licensing fees.",
    local: true,
    free: true,
  },
  {
    id: "local",
    category: "STORAGE",
    label: "Local filesystem",
    description: "Signed media URLs backed by the local media volume.",
    local: true,
    free: true,
  },
  {
    id: "s3",
    category: "STORAGE",
    label: "S3-compatible storage",
    description:
      "Optional S3/MinIO storage. Configure endpoint, bucket, region, and credentials.",
    local: false,
    free: false,
    secretLabel: "Secret access key",
  },
  {
    id: "youtube",
    category: "PUBLISHING",
    label: "YouTube",
    description:
      "Official YouTube Data API resumable upload. Requires a Google Cloud OAuth app and the youtube.upload scope.",
    docsUrl: "https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol",
    local: false,
    free: true,
    configHint: "OAuth client credentials are configured in the server environment.",
  },
];

const PAID_PROVIDERS = new Set([
  "openai-compatible",
  "openai",
  "elevenlabs",
  "fal",
  "wavespeed",
  "tavily",
]);

export function isPaidProvider(provider: string): boolean {
  return PAID_PROVIDERS.has(provider);
}

export function getProviderDefinition(
  provider: string,
  category?: ProviderCategory,
) {
  return PROVIDER_CATALOG.find(
    (entry) =>
      entry.id === provider && (category === undefined || entry.category === category),
  );
}
