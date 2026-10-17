"use client";

import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  BadgeIndianRupee,
  Clapperboard,
  Film,
  Layers,
  Play,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@video-generator/ui/components/button";
import { Badge } from "@/components/ui/primitives";
import { Brand } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

const FEATURES = [
  {
    icon: Wand2,
    title: "Structured scripts",
    body: "LLMs return validated scene JSON with timing, narration, captions, and visual direction.",
  },
  {
    icon: Layers,
    title: "Hybrid visuals",
    body: "Procedural motion graphics and stock assets carry most scenes; hosted AI video is optional and budget-gated.",
  },
  {
    icon: AudioLines,
    title: "Local narration",
    body: "macOS speech, eSpeak, or Piper locally, with configurable hosted TTS when you want a different voice.",
  },
  {
    icon: Film,
    title: "Real FFmpeg renders",
    body: "Scenes, narration, captions, and music are assembled into a vertical H.264/AAC MP4 and validated with ffprobe.",
  },
  {
    icon: BadgeIndianRupee,
    title: "₹500-aware",
    body: "Live quotes where available, explicit configured pricing, reserves, and actual usage records — with honest caveats.",
  },
  {
    icon: Send,
    title: "Publishing with guardrails",
    body: "Official YouTube upload when configured. Instagram and TikTok stay manual exports, never fake publishes.",
  },
];

const STEPS = [
  "Brief the topic, audience, tone, and call to action.",
  "Plan a 45–60s script and timed scenes.",
  "Generate narration, visuals, captions, and music.",
  "Render, validate, edit in Studio, and publish or export.",
];

export default function LandingPage() {
  const { data: session } = authClient.useSession();
  const primaryHref = session ? "/dashboard" : "/login";
  const primaryLabel = session ? "Open workspace" : "Start creating";

  return (
    <div className="min-h-svh bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Brand />
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Sign in
          </Link>
          <Link href={primaryHref}>
            <Button size="sm" className="gap-1.5">
              {primaryLabel}
              <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-y border-white/10 bg-[#07080b] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 size-96 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
          <div>
            <Badge variant="warning" className="mb-5 bg-amber-400/10 text-amber-300">
              Local-first · budget-aware · FFmpeg rendered
            </Badge>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Faceless reels,
              <br />
              from idea to MP4.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/60 sm:text-base">
              ReelForge researches, scripts, narrates, visualizes, captions, edits,
              renders, and publishes vertical videos. Keep the default pipeline
              local and free, or selectively plug in hosted providers under a
              monthly budget you control.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={primaryHref}>
                <Button size="lg" className="gap-2 bg-white text-black hover:bg-white/90">
                  <Play className="size-4" />
                  {primaryLabel}
                </Button>
              </Link>
              <Link href="#how-it-works">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                >
                  See the pipeline
                </Button>
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] uppercase tracking-wider text-white/40">
              <span>Postgres + Redis + BullMQ</span>
              <span>FFmpeg + ffprobe validation</span>
              <span>Per-user isolation</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[340px]">
            <div className="absolute -inset-4 border border-white/10" />
            <div className="relative aspect-[9/16] overflow-hidden border border-white/15 bg-gradient-to-br from-[#0d1b3a] via-[#07121f] to-[#3b2f24]">
              <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 30% 25%, rgba(245,184,75,0.45), transparent 38%), radial-gradient(circle at 75% 70%, rgba(79,209,197,0.28), transparent 42%)" }} />
              <div className="absolute inset-x-6 top-8 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white/50">
                <span>Scene 01</span>
                <span>00:45</span>
              </div>
              <div className="absolute inset-x-8 top-1/3">
                <div className="text-[10px] uppercase tracking-[0.3em] text-amber-300">
                  Hook
                </div>
                <div className="mt-3 text-2xl font-semibold leading-tight text-white">
                  Most people misunderstand how the ocean gets so deep.
                </div>
              </div>
              <div className="absolute inset-x-6 bottom-16 space-y-2">
                <div className="h-1 w-full bg-white/15">
                  <div className="h-full w-2/3 bg-amber-300" />
                </div>
                <div className="flex justify-between text-[9px] uppercase tracking-wider text-white/40">
                  <span>Narration</span>
                  <span>Captions</span>
                  <span>Music</span>
                </div>
              </div>
              <div className="absolute inset-x-6 bottom-6 flex items-center gap-2 text-[10px] text-white/60">
                <Clapperboard className="size-3.5" />
                <span>Rendered locally · 1080×1920 · 30fps</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-3 px-5 py-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="group border border-border bg-card p-5 transition-colors hover:bg-muted/30"
          >
            <feature.icon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
            <h2 className="mt-4 text-sm font-semibold">{feature.title}</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {feature.body}
            </p>
          </div>
        ))}
      </section>

      <section
        id="how-it-works"
        className="border-y border-border bg-muted/20"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              The pipeline
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              One job. Every stage checkpointed.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Failed jobs resume from the last successful checkpoint. Paid
              provider calls are recorded, and unknown outcomes are never
              retried blindly.
            </p>
            <Link href={primaryHref} className="mt-6 inline-block">
              <Button className="gap-1.5">
                <Sparkles className="size-4" />
                {primaryLabel}
              </Button>
            </Link>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <li key={step} className="border border-border bg-background p-5">
                <div className="font-mono text-xs text-muted-foreground">
                  0{index + 1}
                </div>
                <div className="mt-2 text-sm leading-6">{step}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <div className="grid gap-6 border border-border bg-card p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <Badge variant="info">Budget caveat</Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              ₹500/month is enforced in the app — not by the provider.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Estimates are calculated from live price quotes when a provider
              exposes them, or from pricing you explicitly configure. Actual
              provider billing can differ; set provider-side spend limits too.
              Local and free providers keep the default pipeline at ₹0.
            </p>
          </div>
          <div className="space-y-2 border border-border bg-muted/30 p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Default monthly budget</span>
              <span className="font-mono">₹500.00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Retry reserve</span>
              <span className="font-mono">15%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Default daily limit</span>
              <span className="font-mono">1 reel</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Local-first estimate</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                ₹0.00
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Brand />
          <span>
            Local-first by default. Hosted provider calls are optional and
            budget-gated. No hard spending guarantee is claimed.
          </span>
        </div>
      </footer>
    </div>
  );
}
