"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, AudioLines, Film, ShieldCheck, Wand2 } from "lucide-react";

import { Brand } from "@/components/brand";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session) {
      router.replace("/dashboard");
    }
  }, [isPending, router, session]);

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-white/10 bg-[#07080b] text-white lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="pointer-events-none absolute -left-20 top-32 size-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center bg-white text-black">
                <Film className="size-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight">ReelForge</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              Back to home
            </Link>
          </div>

          <div className="max-w-md">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">
              Creator workspace
            </div>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">
              An idea goes in.
              <br />
              A validated vertical reel comes out.
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/55">
              Script, scenes, narration, captions, visuals, music, FFmpeg render,
              and publishing — one persisted pipeline with budget controls at
              every paid step.
            </p>
            <div className="mt-8 space-y-3 text-sm text-white/70">
              <div className="flex items-center gap-3">
                <Wand2 className="size-4 text-amber-300" />
                Structured scripts with retries and schema validation
              </div>
              <div className="flex items-center gap-3">
                <AudioLines className="size-4 text-amber-300" />
                Local narration and procedural visuals by default
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-4 text-amber-300" />
                Per-user isolation and encrypted provider credentials
              </div>
            </div>
          </div>

          <div className="text-[11px] uppercase tracking-wider text-white/30">
            Local-first · hosted providers optional
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border p-5 lg:hidden">
          <Brand />
          <Link href="/" className="text-xs text-muted-foreground">
            Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {mode === "signin" ? (
              <SignInForm onSwitchToSignUp={() => setMode("signup")} />
            ) : (
              <SignUpForm onSwitchToSignIn={() => setMode("signin")} />
            )}
            <p className="mt-8 text-center text-[11px] leading-5 text-muted-foreground">
              By continuing, you are responsible for the content you generate and
              for complying with each platform&apos;s publishing rules.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
