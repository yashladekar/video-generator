"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@video-generator/ui/components/button";
import { Input } from "@video-generator/ui/components/input";
import { Textarea } from "@video-generator/ui/components/textarea";
import { cn } from "@video-generator/ui/lib/utils";

import {
  Badge,
  EmptyPanel,
  Field,
  NativeSelect,
  PageHeader,
  Progress,
  StatusBadge,
  Toggle,
} from "@/components/ui/primitives";
import { formatInr, timeAgo } from "@/lib/format";
import { uploadFile, type UploadedAsset } from "@/lib/upload";
import { trpc } from "@/utils/trpc";

type Duration = 30 | 45 | 60 | 90;
type Resolution = "720p" | "1080p";
type SubtitleStyle = "bold" | "clean" | "karaoke" | "minimal";
type VisualStyle = "cinematic" | "minimal" | "bold" | "documentary" | "tech" | "nature";
type MusicMood = "ambient" | "cinematic" | "upbeat" | "lofi" | "none";
type NarrationStyle = "conversational" | "authoritative" | "energetic" | "calm";
type Platform = "YOUTUBE" | "INSTAGRAM_REELS" | "TIKTOK" | "MANUAL";

const STEPS = ["Brief", "Configuration", "Budget", "Generate"];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

const DURATIONS = [
  { value: "30", label: "30 seconds" },
  { value: "45", label: "45 seconds" },
  { value: "60", label: "60 seconds" },
  { value: "90", label: "90 seconds" },
];

const RESOLUTIONS = [
  { value: "720p", label: "720p (720×1280)" },
  { value: "1080p", label: "1080p (1080×1920)" },
];

const NARRATION_STYLES = [
  { value: "conversational", label: "Conversational" },
  { value: "authoritative", label: "Authoritative" },
  { value: "energetic", label: "Energetic" },
  { value: "calm", label: "Calm" },
];

const VOICES = [
  { value: "", label: "Provider default" },
  { value: "Samantha", label: "Samantha (macOS)" },
  { value: "Lekha", label: "Lekha (Hindi, macOS)" },
  { value: "alloy", label: "Alloy (OpenAI)" },
  { value: "nova", label: "Nova (OpenAI)" },
];

const SUBTITLE_STYLES = [
  { value: "bold", label: "Bold" },
  { value: "clean", label: "Clean" },
  { value: "karaoke", label: "Karaoke accent" },
  { value: "minimal", label: "Minimal" },
];

const VISUAL_STYLES = [
  { value: "cinematic", label: "Cinematic" },
  { value: "minimal", label: "Minimal" },
  { value: "bold", label: "Bold" },
  { value: "documentary", label: "Documentary" },
  { value: "tech", label: "Tech" },
  { value: "nature", label: "Nature" },
];

const MUSIC_MOODS = [
  { value: "ambient", label: "Ambient" },
  { value: "cinematic", label: "Cinematic" },
  { value: "upbeat", label: "Upbeat" },
  { value: "lofi", label: "Lo-fi" },
  { value: "none", label: "No music" },
];

const PLATFORMS = [
  { value: "YOUTUBE", label: "YouTube Shorts" },
  { value: "INSTAGRAM_REELS", label: "Instagram Reels" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "MANUAL", label: "Manual export" },
];

const LLM_PROVIDERS = [
  { value: "auto", label: "Auto (Ollama → hosted → template)" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "template", label: "Template (no AI)" },
];
const TTS_PROVIDERS = [
  { value: "auto", label: "Auto (local → hosted)" },
  { value: "macos-say", label: "macOS say" },
  { value: "espeak-ng", label: "eSpeak NG" },
  { value: "piper", label: "Piper" },
  { value: "openai", label: "OpenAI TTS" },
  { value: "elevenlabs", label: "ElevenLabs" },
];
const VISUAL_PROVIDERS = [
  { value: "auto", label: "Auto (Pexels if configured → procedural)" },
  { value: "procedural", label: "Procedural (local)" },
  { value: "pexels", label: "Pexels stock (free key)" },
  { value: "fal", label: "fal.ai (paid)" },
  { value: "wavespeed", label: "WaveSpeedAI (paid)" },
  { value: "comfyui", label: "ComfyUI (local)" },
];
const VIDEO_PROVIDERS = [
  { value: "none", label: "No hosted AI video" },
  { value: "auto", label: "Auto" },
  { value: "fal", label: "fal.ai (paid)" },
  { value: "wavespeed", label: "WaveSpeedAI (paid)" },
  { value: "comfyui", label: "ComfyUI (local)" },
];

type WizardState = {
  title: string;
  topic: string;
  niche: string;
  targetAudience: string;
  objective: string;
  language: string;
  tone: string;
  style: string;
  callToAction: string;
  referenceText: string;
  researchEnabled: boolean;
  referenceAssets: UploadedAsset[];
  durationSeconds: Duration;
  resolution: Resolution;
  narrationStyle: NarrationStyle;
  voice: string;
  subtitleStyle: SubtitleStyle;
  visualStyle: VisualStyle;
  musicMood: MusicMood;
  platform: Platform;
  monthlyBudgetInr: number;
  maxCostPerVideoInr: number;
  maxHostedVideoCalls: number;
  maxRetries: number;
  reservePercent: number;
  usdToInrRate: number;
  taxPercent: number;
  feePercent: number;
  dailyLimit: number;
  localOnly: boolean;
  autoFallback: boolean;
  preferredLlmProvider: string;
  preferredTtsProvider: string;
  preferredVisualProvider: string;
  preferredVideoProvider: string;
};

const INITIAL: WizardState = {
  title: "",
  topic: "",
  niche: "",
  targetAudience: "",
  objective: "",
  language: "en",
  tone: "Clear and engaging",
  style: "",
  callToAction: "Follow for more.",
  referenceText: "",
  researchEnabled: false,
  referenceAssets: [],
  durationSeconds: 45,
  resolution: "1080p",
  narrationStyle: "conversational",
  voice: "",
  subtitleStyle: "bold",
  visualStyle: "cinematic",
  musicMood: "ambient",
  platform: "YOUTUBE",
  monthlyBudgetInr: 500,
  maxCostPerVideoInr: 50,
  maxHostedVideoCalls: 2,
  maxRetries: 3,
  reservePercent: 15,
  usdToInrRate: 88,
  taxPercent: 0,
  feePercent: 0,
  dailyLimit: 1,
  localOnly: false,
  autoFallback: true,
  preferredLlmProvider: "auto",
  preferredTtsProvider: "auto",
  preferredVisualProvider: "auto",
  preferredVideoProvider: "none",
};

function stateToBrief(state: WizardState) {
  return {
    title: state.title.trim(),
    topic: state.topic.trim(),
    niche: state.niche.trim() || undefined,
    targetAudience: state.targetAudience.trim() || undefined,
    objective: state.objective.trim() || undefined,
    language: state.language,
    tone: state.tone.trim() || undefined,
    style: state.style.trim() || undefined,
    callToAction: state.callToAction.trim() || undefined,
    referenceText: state.referenceText.trim() || undefined,
    referenceAssetIds: state.referenceAssets.map((asset) => asset.id),
    researchEnabled: state.researchEnabled,
  };
}

function stateToConfig(state: WizardState) {
  return {
    durationSeconds: state.durationSeconds,
    aspectRatio: "9:16" as const,
    resolution: state.resolution,
    narrationStyle: state.narrationStyle,
    voice: state.voice || undefined,
    subtitleStyle: state.subtitleStyle,
    visualStyle: state.visualStyle,
    musicMood: state.musicMood,
    platform: state.platform,
  };
}

function stateToBudget(state: WizardState) {
  return {
    monthlyBudgetInrPaise: Math.round(state.monthlyBudgetInr * 100),
    maxCostPerVideoInrPaise: Math.round(state.maxCostPerVideoInr * 100),
    maxHostedVideoCalls: state.maxHostedVideoCalls,
    maxRetries: state.maxRetries,
    reservePercent: state.reservePercent,
    usdToInrRate: state.usdToInrRate,
    taxPercent: state.taxPercent,
    feePercent: state.feePercent,
    dailyLimit: state.dailyLimit,
    timezone: "Asia/Kolkata",
    localOnly: state.localOnly,
    autoFallback: state.autoFallback,
    preferredLlmProvider: state.preferredLlmProvider,
    preferredTtsProvider: state.preferredTtsProvider,
    preferredVisualProvider: state.preferredVisualProvider,
    preferredVideoProvider: state.preferredVideoProvider,
  };
}

export default function CreateReelPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [started, setStarted] = useState(false);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const persistedBudget = useQuery(trpc.budget.get.queryOptions());
  useEffect(() => {
    if (!persistedBudget.data || projectId) return;
    const settings = persistedBudget.data.settings;
    setState((current) => ({
      ...current,
      monthlyBudgetInr: settings.monthlyBudgetInrPaise / 100,
      maxCostPerVideoInr: settings.maxCostPerVideoInrPaise / 100,
      maxHostedVideoCalls: settings.maxHostedVideoCalls,
      maxRetries: settings.maxRetries,
      reservePercent: settings.reservePercent,
      usdToInrRate: settings.usdToInrRate,
      taxPercent: settings.taxPercent,
      feePercent: settings.feePercent,
      dailyLimit: settings.dailyLimit,
      localOnly: settings.localOnly,
      autoFallback: settings.autoFallback,
      preferredLlmProvider: settings.preferredLlmProvider ?? "auto",
      preferredTtsProvider: settings.preferredTtsProvider ?? "auto",
      preferredVisualProvider: settings.preferredVisualProvider ?? "auto",
      preferredVideoProvider: settings.preferredVideoProvider ?? "none",
    }));
  }, [persistedBudget.data, projectId]);

  const createDraft = useMutation(
    trpc.projects.createDraft.mutationOptions(),
  );

  const updateProject = useMutation(
    trpc.projects.update.mutationOptions(),
  );

  const updateBudget = useMutation(
    trpc.budget.updateSettings.mutationOptions(),
  );

  const startGeneration = useMutation(
    trpc.generation.start.mutationOptions(),
  );

  const estimate = useQuery(
    trpc.generation.estimate.queryOptions(
      { projectId: projectId ?? "" },
      { enabled: Boolean(projectId) && step === 3 },
    ),
  );

  const job = useQuery(
    trpc.generation.getJob.queryOptions(
      { jobId: jobId ?? "" },
      {
        enabled: Boolean(jobId),
        refetchInterval: (query) => {
          const data = query.state.data;
          return data && ["QUEUED", "RUNNING"].includes(data.status)
            ? 1500
            : false;
        },
      },
    ),
  );

  const cancelJob = useMutation(
    trpc.generation.cancel.mutationOptions(),
  );

  const retryJob = useMutation(
    trpc.generation.retry.mutationOptions(),
  );

  const canContinueBrief =
    state.title.trim().length >= 2 && state.topic.trim().length >= 3;

  const estimateData = estimate.data;
  const jobData = job.data;
  const jobSteps = (jobData?.steps ?? []) as unknown as Array<{
    id: string;
    type: string;
    status: string;
  }>;
  const running = jobData
    ? ["QUEUED", "RUNNING"].includes(jobData.status)
    : started && !!jobId;
  const estimateBlockers: string[] = [];
  if (estimateData) {
    if (estimateData.estimate.unknownPricing) {
      estimateBlockers.push(
        "A selected hosted provider has no configured price. Add pricing in Settings or switch to a local provider.",
      );
    }
    if (
      estimateData.estimate.estimatedCostInrPaise >
      estimateData.settings.maxCostPerVideoInrPaise
    ) {
      estimateBlockers.push(
        "The estimate exceeds the per-video maximum. Raise the limit or use local providers.",
      );
    }
    if (
      estimateData.estimate.estimatedCostInrPaise >
      estimateData.budget.spendableInrPaise
    ) {
      estimateBlockers.push(
        "The estimate exceeds the spendable monthly budget after the retry reserve.",
      );
    }
    if (estimateData.daily.remaining <= 0) {
      estimateBlockers.push(
        `The daily generation limit (${estimateData.daily.limit}) has been reached. Raise it in Settings or try tomorrow.`,
      );
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const asset = await uploadFile(file, { kind: "reference" });
      set("referenceAssets", [...state.referenceAssets, asset]);
      toast.success("Reference uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="New project"
        title="Create a reel"
        description="Brief the idea, configure the format, check the cost, then start a real background generation job."
        actions={
          <Button variant="outline" render={<Link href="/dashboard" />}>
            Cancel
          </Button>
        }
      />

      <div className="border border-border bg-card">
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-4">
          {STEPS.map((label, index) => {
            const active = index === step;
            const complete = index < step || (index === 3 && Boolean(jobId));
            return (
              <div
                key={label}
                className={cn(
                  "flex items-center gap-2 px-3 py-3 text-xs",
                  active ? "bg-muted/40 text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center border font-mono text-[10px]",
                    complete
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border",
                  )}
                >
                  {complete ? <Check className="size-3" /> : index + 1}
                </span>
                <span className="truncate">{label}</span>
              </div>
            );
          })}
        </div>

        <div className="p-5 sm:p-6">
          {step === 0 ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project title">
                  <Input
                    value={state.title}
                    onChange={(event) => set("title", event.target.value)}
                    placeholder="Why the ocean is deeper than Everest"
                  />
                </Field>
                <Field label="Topic or idea">
                  <Input
                    value={state.topic}
                    onChange={(event) => set("topic", event.target.value)}
                    placeholder="The surprising science of the deep ocean"
                  />
                </Field>
                <Field label="Target audience" hint="Who should this land with?">
                  <Input
                    value={state.targetAudience}
                    onChange={(event) => set("targetAudience", event.target.value)}
                    placeholder="Curious beginners"
                  />
                </Field>
                <Field label="Video objective">
                  <Input
                    value={state.objective}
                    onChange={(event) => set("objective", event.target.value)}
                    placeholder="Educate and build trust"
                  />
                </Field>
                <Field label="Content niche">
                  <Input
                    value={state.niche}
                    onChange={(event) => set("niche", event.target.value)}
                    placeholder="Science explainers"
                  />
                </Field>
                <Field label="Language">
                  <NativeSelect
                    value={state.language}
                    onChange={(value) => set("language", value)}
                    options={LANGUAGES}
                  />
                </Field>
                <Field label="Tone">
                  <Input
                    value={state.tone}
                    onChange={(event) => set("tone", event.target.value)}
                    placeholder="Clear and friendly"
                  />
                </Field>
                <Field label="Visual style note">
                  <Input
                    value={state.style}
                    onChange={(event) => set("style", event.target.value)}
                    placeholder="Cinematic, data-driven, tactile"
                  />
                </Field>
              </div>
              <Field label="Call to action">
                <Input
                  value={state.callToAction}
                  onChange={(event) => set("callToAction", event.target.value)}
                  placeholder="Follow for more simple science explainers."
                />
              </Field>
              <Field
                label="Reference text or notes"
                hint="Optional. This is passed to the script provider as context."
              >
                <Textarea
                  value={state.referenceText}
                  onChange={(event) => set("referenceText", event.target.value)}
                  placeholder="Facts, links, or points you want included…"
                  rows={4}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  checked={state.researchEnabled}
                  onChange={(value) => set("researchEnabled", value)}
                  label="Research the topic"
                  description="Uses Wikipedia by default. Research adds context to the script prompt."
                />
                <div className="border border-border p-3">
                  <div className="text-sm font-medium">Reference files</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Images, MP4/MOV, MP3/WAV, text, or PDF. Max 200MB.
                  </p>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 border border-border px-3 py-1.5 text-xs hover:bg-muted/40">
                    {uploading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {uploading ? "Uploading…" : "Upload file"}
                    <input
                      type="file"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void onUpload(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {state.referenceAssets.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {state.referenceAssets.map((asset) => (
                        <div
                          key={asset.id}
                          className="flex items-center justify-between gap-2 border border-border bg-muted/20 px-2 py-1 text-[11px]"
                        >
                          <span className="truncate">
                            {asset.originalName ?? asset.id}
                          </span>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              set(
                                "referenceAssets",
                                state.referenceAssets.filter((item) => item.id !== asset.id),
                              )
                            }
                          >
                            <XCircle className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  className="gap-1.5"
                  disabled={
                    !canContinueBrief ||
                    createDraft.isPending ||
                    updateProject.isPending
                  }
                  onClick={async () => {
                    try {
                      if (projectId) {
                        await updateProject.mutateAsync({
                          projectId,
                          title: state.title.trim(),
                          brief: stateToBrief(state),
                          config: stateToConfig(state),
                        });
                        toast.success("Brief updated");
                      } else {
                        const project = await createDraft.mutateAsync({
                          brief: stateToBrief(state),
                          config: stateToConfig(state),
                          budget: stateToBudget(state),
                        });
                        setProjectId(project.id);
                        toast.success("Draft project saved");
                      }
                      setStep(1);
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not save the brief",
                      );
                    }
                  }}
                >
                  {createDraft.isPending || updateProject.isPending
                    ? "Saving…"
                    : "Save brief & continue"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Target duration">
                  <NativeSelect
                    value={String(state.durationSeconds)}
                    onChange={(value) => set("durationSeconds", Number(value) as Duration)}
                    options={DURATIONS}
                  />
                </Field>
                <Field label="Aspect ratio">
                  <div className="flex h-9 items-center border border-input px-3 text-sm text-muted-foreground">
                    9:16 vertical
                  </div>
                </Field>
                <Field label="Resolution">
                  <NativeSelect
                    value={state.resolution}
                    onChange={(value) => set("resolution", value as Resolution)}
                    options={RESOLUTIONS}
                  />
                </Field>
                <Field label="Narration style">
                  <NativeSelect
                    value={state.narrationStyle}
                    onChange={(value) =>
                      set("narrationStyle", value as NarrationStyle)
                    }
                    options={NARRATION_STYLES}
                  />
                </Field>
                <Field label="Voice">
                  <NativeSelect
                    value={state.voice}
                    onChange={(value) => set("voice", value)}
                    options={VOICES}
                  />
                </Field>
                <Field label="Subtitle style">
                  <NativeSelect
                    value={state.subtitleStyle}
                    onChange={(value) =>
                      set("subtitleStyle", value as SubtitleStyle)
                    }
                    options={SUBTITLE_STYLES}
                  />
                </Field>
                <Field label="Visual style">
                  <NativeSelect
                    value={state.visualStyle}
                    onChange={(value) => set("visualStyle", value as VisualStyle)}
                    options={VISUAL_STYLES}
                  />
                </Field>
                <Field label="Background music">
                  <NativeSelect
                    value={state.musicMood}
                    onChange={(value) => set("musicMood", value as MusicMood)}
                    options={MUSIC_MOODS}
                  />
                </Field>
                <Field label="Destination">
                  <NativeSelect
                    value={state.platform}
                    onChange={(value) => set("platform", value as Platform)}
                    options={PLATFORMS}
                  />
                </Field>
              </div>
              <div className="border border-border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
                The final video is rendered vertically at 30fps with H.264/AAC.
                720p is faster; 1080p is the default for publishing. The render
                validator checks duration, streams, resolution, codecs, audio
                levels, and black frames.
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(0)}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  className="gap-1.5"
                  disabled={!projectId || updateProject.isPending}
                  onClick={async () => {
                    if (!projectId) return;
                    try {
                      await updateProject.mutateAsync({
                        projectId,
                        brief: stateToBrief(state),
                        config: stateToConfig(state),
                      });
                      setStep(2);
                      toast.success("Configuration saved");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not save configuration",
                      );
                    }
                  }}
                >
                  {updateProject.isPending ? "Saving…" : "Save configuration"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Monthly budget (₹)">
                  <Input
                    type="number"
                    min={0}
                    value={state.monthlyBudgetInr}
                    onChange={(event) =>
                      set("monthlyBudgetInr", Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Max cost per video (₹)">
                  <Input
                    type="number"
                    min={0}
                    value={state.maxCostPerVideoInr}
                    onChange={(event) =>
                      set("maxCostPerVideoInr", Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Max hosted video calls">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={state.maxHostedVideoCalls}
                    onChange={(event) =>
                      set("maxHostedVideoCalls", Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Max retries">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={state.maxRetries}
                    onChange={(event) => set("maxRetries", Number(event.target.value))}
                  />
                </Field>
                <Field label="Retry reserve (%)">
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    value={state.reservePercent}
                    onChange={(event) =>
                      set("reservePercent", Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Daily generation limit">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={state.dailyLimit}
                    onChange={(event) => set("dailyLimit", Number(event.target.value))}
                  />
                </Field>
                <Field label="USD → INR rate">
                  <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={state.usdToInrRate}
                    onChange={(event) =>
                      set("usdToInrRate", Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Tax (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={state.taxPercent}
                    onChange={(event) => set("taxPercent", Number(event.target.value))}
                  />
                </Field>
                <Field label="Payment fee (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={state.feePercent}
                    onChange={(event) => set("feePercent", Number(event.target.value))}
                  />
                </Field>
                <Field label="Preferred script provider">
                  <NativeSelect
                    value={state.preferredLlmProvider}
                    onChange={(value) => set("preferredLlmProvider", value)}
                    options={LLM_PROVIDERS}
                  />
                </Field>
                <Field label="Preferred narration provider">
                  <NativeSelect
                    value={state.preferredTtsProvider}
                    onChange={(value) => set("preferredTtsProvider", value)}
                    options={TTS_PROVIDERS}
                  />
                </Field>
                <Field label="Preferred visual provider">
                  <NativeSelect
                    value={state.preferredVisualProvider}
                    onChange={(value) => set("preferredVisualProvider", value)}
                    options={VISUAL_PROVIDERS}
                  />
                </Field>
                <Field label="Hosted AI video">
                  <NativeSelect
                    value={state.preferredVideoProvider}
                    onChange={(value) => set("preferredVideoProvider", value)}
                    options={VIDEO_PROVIDERS}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  checked={state.localOnly}
                  onChange={(value) => set("localOnly", value)}
                  label="Local-only mode"
                  description="Blocks paid providers. Pexels (free) and local models are still allowed."
                />
                <Toggle
                  checked={state.autoFallback}
                  onChange={(value) => set("autoFallback", value)}
                  label="Automatic fallback"
                  description="Fall back to local/free providers when a hosted provider fails or the budget is low."
                />
              </div>
              <div className="border border-border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
                Estimates use live provider quotes when available, otherwise the
                pricing you configured in Settings. Actual provider billing can
                differ. The app reserves the estimate and records actual usage;
                it is not a provider-side hard spending cap.
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  className="gap-1.5"
                  disabled={updateBudget.isPending}
                  onClick={async () => {
                    if (!projectId) return;
                    try {
                      await updateBudget.mutateAsync(stateToBudget(state));
                      setStep(3);
                      queryClient.invalidateQueries({
                        queryKey: trpc.generation.estimate.queryKey({ projectId }),
                      });
                      toast.success("Budget settings saved");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not save budget",
                      );
                    }
                  }}
                >
                  {updateBudget.isPending ? "Saving…" : "Save budget & estimate"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              {estimate.isLoading ? (
                <div className="flex items-center gap-2 border border-border p-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Calculating estimate…
                </div>
              ) : estimate.isError ? (
                <EmptyPanel
                  icon={<AlertTriangle className="size-6" />}
                  title="Could not calculate the estimate"
                  description={estimate.error.message}
                  action={<Button onClick={() => estimate.refetch()}>Retry</Button>}
                />
              ) : estimateData ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="border border-border">
                      <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Estimated cost
                      </div>
                      <div className="divide-y divide-border">
                        {estimateData.estimate.lines.map((line) => (
                          <div
                            key={`${line.category}-${line.provider}-${line.label}`}
                            className="flex items-start justify-between gap-3 p-3 text-xs"
                          >
                            <div>
                              <div className="font-medium">{line.label}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {line.provider}
                                {line.model ? ` / ${line.model}` : ""} ·{" "}
                                {line.units} {line.unit}
                                {line.unit === "1k_tokens" ? " (1k)" : ""}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                ${line.unitPriceUsd.toFixed(4)} per {line.unit} ·{" "}
                                {line.pricingSource}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono">
                                {formatInr(line.amountInrPaise)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                ${line.amountUsd.toFixed(4)}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between p-4">
                          <div>
                            <div className="text-sm font-semibold">Total estimate</div>
                            <div className="text-[10px] text-muted-foreground">
                              {estimateData.estimate.usdToInrRate} INR/USD · tax{" "}
                              {estimateData.estimate.taxPercent}% · fee{" "}
                              {estimateData.estimate.feePercent}%
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-semibold">
                              {formatInr(estimateData.estimate.estimatedCostInrPaise)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              ${estimateData.estimate.estimatedCostUsd.toFixed(4)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="border border-border p-4">
                        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Budget check
                        </div>
                        <div className="mt-3 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Monthly budget</span>
                            <span className="font-mono">
                              {formatInr(estimateData.budget.amountInrPaise)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Spent</span>
                            <span className="font-mono">
                              {formatInr(estimateData.budget.spentInrPaise)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Reserved</span>
                            <span className="font-mono">
                              {formatInr(estimateData.budget.reservedInrPaise)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Retry reserve</span>
                            <span className="font-mono">
                              {formatInr(estimateData.budget.retryReserveInrPaise)}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-border pt-2">
                            <span className="text-muted-foreground">Spendable now</span>
                            <span className="font-mono">
                              {formatInr(estimateData.budget.spendableInrPaise)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="border border-border p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Ready to generate?
                          </span>
                          <Badge
                            variant={estimateData.fitsBudget ? "success" : "danger"}
                          >
                            {estimateData.fitsBudget ? "Fits budget" : "Blocked"}
                          </Badge>
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Daily limit: {estimateData.daily.count}/
                          {estimateData.daily.limit} used. Per-video max:{" "}
                          {formatInr(estimateData.settings.maxCostPerVideoInrPaise)}.
                        </div>
                        <Button
                          className="mt-4 w-full gap-1.5"
                          disabled={
                            !estimateData.fitsBudget ||
                            startGeneration.isPending ||
                            running
                          }
                          onClick={async () => {
                            if (!projectId) return;
                            try {
                              const jobResult = await startGeneration.mutateAsync({
                                projectId,
                                idempotencyKey: crypto.randomUUID(),
                                overrides: {
                                  localOnly: state.localOnly,
                                  autoFallback: state.autoFallback,
                                  maxHostedVideoCalls: state.maxHostedVideoCalls,
                                  maxRetries: state.maxRetries,
                                  preferredLlmProvider: state.preferredLlmProvider,
                                  preferredTtsProvider: state.preferredTtsProvider,
                                  preferredVisualProvider:
                                    state.preferredVisualProvider,
                                  preferredVideoProvider:
                                    state.preferredVideoProvider,
                                  researchEnabled: state.researchEnabled,
                                  targetDurationSeconds: state.durationSeconds,
                                },
                              });
                              setJobId(jobResult.id);
                              setStarted(true);
                              toast.success("Generation job queued");
                              queryClient.invalidateQueries({
                                queryKey: trpc.dashboard.stats.queryKey(),
                              });
                              queryClient.invalidateQueries({
                                queryKey: trpc.projects.list.queryKey(),
                              });
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not start generation",
                              );
                            }
                          }}
                        >
                          {startGeneration.isPending || running ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Play className="size-4" />
                          )}
                          {running ? "Generation in progress" : "Generate reel"}
                        </Button>
                        {startGeneration.isError ? (
                          <p className="mt-2 text-[11px] text-red-500">
                            {startGeneration.error.message}
                          </p>
                        ) : null}
                        {estimateBlockers.length > 0 ? (
                          <ul className="mt-3 space-y-1 border border-red-500/20 bg-red-500/5 p-2 text-[10px] leading-4 text-red-500">
                            {estimateBlockers.map((blocker) => (
                              <li key={blocker}>• {blocker}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <div className="border border-border bg-muted/20 p-4">
                        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Assumptions
                        </div>
                        <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                          {estimateData.estimate.assumptions.map((assumption) => (
                            <li key={assumption}>• {assumption}</li>
                          ))}
                          <li>
                            • This is an estimate, not a provider-enforced spending
                            cap.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {started && jobId ? (
                    <div className="border border-border">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Generation job</span>
                            {jobData ? <StatusBadge status={jobData.status} /> : null}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {jobData?.currentStep
                              ? jobData.currentStep.replaceAll("_", " ").toLowerCase()
                              : "Waiting for worker…"}{" "}
                            · {jobData?.progress ?? 0}%
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {jobData && ["QUEUED", "RUNNING"].includes(jobData.status) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={cancelJob.isPending}
                              onClick={async () => {
                                if (!jobId) return;
                                try {
                                  await cancelJob.mutateAsync({ jobId });
                                  toast.success("Cancellation requested");
                                  queryClient.invalidateQueries({
                                    queryKey: trpc.generation.getJob.queryKey({ jobId }),
                                  });
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not cancel the job",
                                  );
                                }
                              }}
                            >
                              Cancel
                            </Button>
                          ) : null}
                          {jobData?.status === "FAILED" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={retryJob.isPending}
                              onClick={async () => {
                                if (!jobId) return;
                                try {
                                  await retryJob.mutateAsync({ jobId });
                                  toast.success("Retry queued");
                                  queryClient.invalidateQueries({
                                    queryKey: trpc.generation.getJob.queryKey({ jobId }),
                                  });
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not retry the job",
                                  );
                                }
                              }}
                            >
                              Retry
                            </Button>
                          ) : null}
                          {jobData?.status === "SUCCEEDED" ? (
                            <Button
                              size="sm"
                              className="gap-1.5"
                              render={<Link href={`/studio/${projectId}`} />}
                            >
                              <Sparkles className="size-3.5" />
                              Open Studio
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="p-4">
                        <Progress value={jobData?.progress ?? 0} className="h-2" />
                        {jobData?.errorMessage ? (
                          <p className="mt-3 border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
                            {jobData.errorMessage}
                          </p>
                        ) : null}
                        <div className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {jobSteps.map((step) => (
                            <div
                              key={step.id}
                              className="flex items-center gap-2 border border-border px-2 py-1.5 text-[11px]"
                            >
                              {step.status === "SUCCEEDED" ? (
                                <CheckCircle2 className="size-3.5 text-emerald-500" />
                              ) : step.status === "FAILED" ? (
                                <XCircle className="size-3.5 text-red-500" />
                              ) : step.status === "RUNNING" ? (
                                <Loader2 className="size-3.5 animate-spin text-sky-500" />
                              ) : (
                                <span className="size-3.5 rounded-full border border-border" />
                              )}
                              <span className="flex-1">
                                {step.type.replaceAll("_", " ").toLowerCase()}
                              </span>
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                {step.status.toLowerCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                        {jobData?.status === "SUCCEEDED" ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              className="gap-1.5"
                              render={<Link href={`/studio/${projectId}`} />}
                            >
                              <Sparkles className="size-4" />
                              Preview & edit in Studio
                            </Button>
                            <Button
                              variant="outline"
                              render={<Link href={`/projects/${projectId}`} />}
                            >
                              Project details
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)} disabled={running}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  variant="outline"
                  render={<Link href="/dashboard" />}
                >
                  Save for later
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {started && jobId ? (
        <div className="border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          <FileText className="mb-1 size-3.5" />
          Generation is persisted in Postgres and runs in the BullMQ worker. You
          can close this page and reopen the project later; the job resumes from
          the last successful checkpoint.
        </div>
      ) : null}
    </div>
  );
}
