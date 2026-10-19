"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  ShieldCheck,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@video-generator/ui/components/button";
import { Input } from "@video-generator/ui/components/input";
import { Textarea } from "@video-generator/ui/components/textarea";
import { Skeleton } from "@video-generator/ui/components/skeleton";
import { cn } from "@video-generator/ui/lib/utils";

import {
  Badge,
  EmptyPanel,
  Field,
  NativeSelect,
  PageHeader,
  Progress,
  Tabs,
  Toggle,
} from "@/components/ui/primitives";
import { formatDate, formatInr, timeAgo } from "@/lib/format";
import { trpc } from "@/utils/trpc";

const TABS = [
  { value: "providers", label: "Providers" },
  { value: "budget", label: "Budget" },
  { value: "preferences", label: "Preferences" },
  { value: "publishing", label: "Publishing" },
  { value: "usage", label: "Usage" },
];

const CATEGORY_LABELS: Record<string, string> = {
  LLM: "Language models",
  RESEARCH: "Research",
  TTS: "Text to speech",
  IMAGE: "Image generation",
  IMAGE_TO_VIDEO: "Image to video",
  TEXT_TO_VIDEO: "Video generation",
  MUSIC: "Music",
  STORAGE: "Storage",
  PUBLISHING: "Publishing",
};

const MODEL_PROVIDERS = [
  { value: "auto", label: "Auto" },
  { value: "template", label: "Template (no AI)" },
  { value: "ollama", label: "Ollama" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
];
const TTS_PROVIDERS = [
  { value: "auto", label: "Auto" },
  { value: "macos-say", label: "macOS say" },
  { value: "espeak-ng", label: "eSpeak NG" },
  { value: "piper", label: "Piper" },
  { value: "openai", label: "OpenAI TTS" },
  { value: "elevenlabs", label: "ElevenLabs" },
];
const VISUAL_PROVIDERS = [
  { value: "auto", label: "Auto" },
  { value: "procedural", label: "Procedural" },
  { value: "pexels", label: "Pexels" },
  { value: "fal", label: "fal.ai" },
  { value: "wavespeed", label: "WaveSpeedAI" },
  { value: "comfyui", label: "ComfyUI" },
];
const VIDEO_PROVIDERS = [
  { value: "none", label: "None" },
  { value: "auto", label: "Auto" },
  { value: "fal", label: "fal.ai" },
  { value: "wavespeed", label: "WaveSpeedAI" },
  { value: "comfyui", label: "ComfyUI" },
];

const PRICING_CATEGORIES = [
  "LLM",
  "RESEARCH",
  "TTS",
  "IMAGE",
  "TEXT_TO_VIDEO",
  "MUSIC",
  "STORAGE",
  "PUBLISHING",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

function ProviderCard({
  definition,
  configured,
}: {
  definition: {
    id: string;
    category: string;
    label: string;
    description: string;
    docsUrl?: string;
    local: boolean;
    free: boolean;
    secretLabel?: string;
    configHint?: string;
    envConfigured: boolean;
  };
  configured?: {
    id: string;
    label: string | null;
    enabled: boolean;
    isDefault: boolean;
    config: unknown;
    hasSecret: boolean;
    secretLast4: string | null;
    lastTestedAt: string | null;
    lastTestStatus: string | null;
    lastError: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const config = (configured?.config ?? {}) as Record<string, unknown>;
  const [enabled, setEnabled] = useState(configured?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(configured?.isDefault ?? false);
  const [model, setModel] = useState(
    typeof config.model === "string" ? config.model : "",
  );
  const [baseUrl, setBaseUrl] = useState(
    typeof config.baseUrl === "string" ? config.baseUrl : "",
  );
  const [voice, setVoice] = useState(
    typeof config.voice === "string"
      ? config.voice
      : typeof config.voiceId === "string"
        ? config.voiceId
        : "",
  );
  const [advanced, setAdvanced] = useState(
    Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : "{}",
  );
  const [secret, setSecret] = useState("");

  const upsert = useMutation(
    trpc.providers.upsert.mutationOptions({
      onSuccess: () => {
        toast.success(`${definition.label} saved`);
        setSecret("");
        queryClient.invalidateQueries({ queryKey: trpc.providers.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.providers.catalog.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const test = useMutation(
    trpc.providers.test.mutationOptions({
      onSuccess: (result) => {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
        queryClient.invalidateQueries({ queryKey: trpc.providers.list.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  function save() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(advanced || "{}") as Record<string, unknown>;
    } catch {
      toast.error("Advanced config must be valid JSON");
      return;
    }
    if (model.trim()) parsed.model = model.trim();
    else delete parsed.model;
    if (baseUrl.trim()) parsed.baseUrl = baseUrl.trim();
    else delete parsed.baseUrl;
    if (voice.trim()) {
      if (
        ["elevenlabs"].includes(definition.id)
      ) {
        parsed.voiceId = voice.trim();
      } else {
        parsed.voice = voice.trim();
      }
    } else {
      delete parsed.voice;
      delete parsed.voiceId;
    }
    upsert.mutate({
      category: definition.category as "LLM",
      provider: definition.id,
      label: definition.label,
      enabled,
      isDefault,
      config: parsed,
      ...(secret.trim() ? { secrets: { apiKey: secret.trim() } } : {}),
    });
  }

  return (
    <div className="border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{definition.label}</span>
            <Badge variant={definition.free ? "success" : "warning"}>
              {definition.free ? "Free" : "Paid"}
            </Badge>
            <Badge variant="outline">
              {definition.local ? "Local" : "Hosted"}
            </Badge>
            {configured ? (
              <Badge variant={configured.enabled ? "info" : "neutral"}>
                {configured.enabled ? "Enabled" : "Disabled"}
              </Badge>
            ) : definition.envConfigured ? (
              <Badge variant="info">Env configured</Badge>
            ) : (
              <Badge variant="neutral">Not configured</Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
            {definition.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {definition.docsUrl ? (
            <a
              href={definition.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Docs <ExternalLink className="size-3" />
            </a>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending}
            onClick={() =>
              test.mutate({
                category: definition.category as "LLM",
                provider: definition.id,
              })
            }
          >
            {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Test
          </Button>
          <Button size="sm" disabled={upsert.isPending} onClick={save}>
            {upsert.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {configured?.lastTestStatus ? (
        <div
          className={cn(
            "mt-3 border p-2 text-[11px]",
            configured.lastTestStatus === "OK"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
              : "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
          )}
        >
          {configured.lastTestStatus === "OK" ? "Last test passed" : "Last test failed"}
          {configured.lastError ? `: ${configured.lastError}` : ""}
          {configured.lastTestedAt ? ` (${timeAgo(configured.lastTestedAt)})` : ""}
        </div>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground">
          Configure
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Model" hint={definition.configHint}>
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model id, e.g. llama3.2:3b"
            />
          </Field>
          <Field label="Base URL">
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field label="Voice / voice ID">
            <Input
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
              placeholder="Samantha, alloy, or a provider voice id"
            />
          </Field>
          <Field
            label={definition.secretLabel ?? "API key"}
            hint={
              configured?.hasSecret
                ? `Stored securely (${configured.secretLast4}). Leave blank to keep it.`
                : "Encrypted with AES-256-GCM on the server."
            }
          >
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste a new secret"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Advanced config JSON"
            hint="Model-specific input templates, workflows, or extra options."
            className="sm:col-span-2"
          >
            <Textarea
              value={advanced}
              onChange={(event) => setAdvanced(event.target.value)}
              rows={6}
              className="font-mono text-[11px]"
            />
          </Field>
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Enabled"
              description="Use this provider as a candidate in the fallback chain."
            />
            <Toggle
              checked={isDefault}
              onChange={setIsDefault}
              label="Default for category"
              description="Choose this provider first when no explicit preference is set."
            />
          </div>
        </div>
      </details>
    </div>
  );
}

type PricingRow = {
  id: string;
  provider: string;
  model: string;
  category: string;
  unit: string;
  unitPriceUsd: number;
  active: boolean;
};

function ProvidersTab() {
  const catalog = useQuery(trpc.providers.catalog.queryOptions());
  const list = useQuery(trpc.providers.list.queryOptions({}));
  const pricing = useQuery(trpc.providers.pricing.queryOptions());
  const pricingRows = (pricing.data ?? []) as unknown as PricingRow[];
  const queryClient = useQueryClient();
  const [pricingForm, setPricingForm] = useState({
    provider: "fal",
    model: "fal-ai/wan/v2.2-5b/text-to-video",
    category: "TEXT_TO_VIDEO",
    unit: "second",
    unitPriceUsd: "0.05",
    sourceUrl: "",
    active: true,
  });

  const upsertPricing = useMutation(
    trpc.providers.upsertPricing.mutationOptions(),
  );

  async function addPrice() {
    try {
      await upsertPricing.mutateAsync({
        provider: pricingForm.provider.trim(),
        model: pricingForm.model.trim(),
        category: pricingForm.category as "LLM",
        unit: pricingForm.unit.trim(),
        unitPriceUsd: Number(pricingForm.unitPriceUsd),
        sourceUrl: pricingForm.sourceUrl.trim() || undefined,
        active: true,
      });
      toast.success("Pricing saved");
      queryClient.invalidateQueries({
        queryKey: trpc.providers.pricing.queryKey(),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save pricing");
    }
  }

  const configuredMap = useMemo(() => {
    type ProviderRow = NonNullable<typeof list.data>[number];
    const map = new Map<string, ProviderRow>();
    for (const row of list.data ?? []) {
      map.set(`${row.category}:${row.provider}`, row);
    }
    return map;
  }, [list.data]);

  if (catalog.isLoading || list.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    );
  }
  if (catalog.isError || list.isError) {
    return (
      <EmptyPanel
        title="Could not load providers"
        description={catalog.error?.message ?? list.error?.message}
        action={<Button onClick={() => catalog.refetch()}>Retry</Button>}
      />
    );
  }

  const definitions = catalog.data?.catalog ?? [];
  const capabilities = catalog.data?.capabilities ?? [];
  const grouped = definitions.reduce<Record<string, typeof definitions>>(
    (acc, definition) => {
      (acc[definition.category] ??= []).push(definition);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-6">
      <div className="border border-border bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Local capabilities
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => (
            <div
              key={capability.id}
              className="flex items-start gap-2 border border-border p-3"
            >
              {capability.available ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <div>
                <div className="text-xs font-medium">{capability.label}</div>
                <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  {capability.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {Object.entries(grouped).map(([category, entries]) => (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <Badge variant="outline">{entries.length}</Badge>
            </div>
            {entries.map((definition) => (
              <ProviderCard
                key={`${definition.category}:${definition.id}`}
                definition={definition}
                configured={configuredMap.get(
                  `${definition.category}:${definition.id}`,
                )}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Model pricing catalog
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Live quotes are preferred for fal/WaveSpeed when a key exists.
              Otherwise these configured prices are used. Unknown paid pricing
              blocks the call.
            </p>
          </div>
          <Badge variant="warning">Estimated, not provider-enforced</Badge>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Provider">
            <Input
              value={pricingForm.provider}
              onChange={(event) =>
                setPricingForm((value) => ({ ...value, provider: event.target.value }))
              }
            />
          </Field>
          <Field label="Model">
            <Input
              value={pricingForm.model}
              onChange={(event) =>
                setPricingForm((value) => ({ ...value, model: event.target.value }))
              }
            />
          </Field>
          <Field label="Category">
            <NativeSelect
              value={pricingForm.category}
              onChange={(value) =>
                setPricingForm((state) => ({ ...state, category: value }))
              }
              options={PRICING_CATEGORIES}
            />
          </Field>
          <Field label="Unit">
            <Input
              value={pricingForm.unit}
              onChange={(event) =>
                setPricingForm((value) => ({ ...value, unit: event.target.value }))
              }
              placeholder="second, image, 1k_tokens, character"
            />
          </Field>
          <Field label="USD per unit">
            <Input
              type="number"
              min={0}
              step="0.0001"
              value={pricingForm.unitPriceUsd}
              onChange={(event) =>
                setPricingForm((value) => ({
                  ...value,
                  unitPriceUsd: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Source URL">
            <Input
              value={pricingForm.sourceUrl}
              onChange={(event) =>
                setPricingForm((value) => ({ ...value, sourceUrl: event.target.value }))
              }
              placeholder="https://provider/pricing"
            />
          </Field>
          <div className="flex items-end">
            <Button
              className="w-full gap-1.5"
              disabled={
                upsertPricing.isPending ||
                !pricingForm.provider ||
                !pricingForm.model ||
                !pricingForm.unit
              }
              onClick={() => void addPrice()}
            >
              <Plus className="size-4" />
              Add / update price
            </Button>
          </div>
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-muted/60 uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2">Provider</th>
                <th className="p-2">Model</th>
                <th className="p-2">Category</th>
                <th className="p-2">Unit</th>
                <th className="p-2 text-right">USD / unit</th>
                <th className="p-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {pricingRows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-2">{row.provider}</td>
                  <td className="p-2 font-mono">{row.model}</td>
                  <td className="p-2">{row.category.replaceAll("_", " ")}</td>
                  <td className="p-2">{row.unit}</td>
                  <td className="p-2 text-right font-mono">
                    ${row.unitPriceUsd.toFixed(4)}
                  </td>
                  <td className="p-2">
                    <Badge variant={row.active ? "success" : "neutral"}>
                      {row.active ? "Active" : "Off"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type UsageRow = {
  id: string;
  provider: string;
  category: string;
  model: string | null;
  unit: string | null;
  estimatedCostInrPaise: number;
  actualCostInrPaise: number | null;
  createdAt: string;
};

type UsageLedgerRow = UsageRow & {
  inputUnits: number | null;
  outputUnits: number | null;
  providerRequestId: string | null;
};

function BudgetTab() {
  const budget = useQuery(trpc.budget.get.queryOptions());
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    monthlyBudgetInr: number;
    maxCostPerVideoInr: number;
    maxHostedVideoCalls: number;
    maxRetries: number;
    reservePercent: number;
    usdToInrRate: number;
    taxPercent: number;
    feePercent: number;
    dailyLimit: number;
    timezone: string;
    localOnly: boolean;
    autoFallback: boolean;
    preferredLlmProvider: string;
    preferredTtsProvider: string;
    preferredVisualProvider: string;
    preferredVideoProvider: string;
  } | null>(null);

  useEffect(() => {
    if (!budget.data || form) return;
    const settings = budget.data.settings;
    setForm({
      monthlyBudgetInr: settings.monthlyBudgetInrPaise / 100,
      maxCostPerVideoInr: settings.maxCostPerVideoInrPaise / 100,
      maxHostedVideoCalls: settings.maxHostedVideoCalls,
      maxRetries: settings.maxRetries,
      reservePercent: settings.reservePercent,
      usdToInrRate: settings.usdToInrRate,
      taxPercent: settings.taxPercent,
      feePercent: settings.feePercent,
      dailyLimit: settings.dailyLimit,
      timezone: settings.timezone,
      localOnly: settings.localOnly,
      autoFallback: settings.autoFallback,
      preferredLlmProvider: settings.preferredLlmProvider ?? "auto",
      preferredTtsProvider: settings.preferredTtsProvider ?? "auto",
      preferredVisualProvider: settings.preferredVisualProvider ?? "auto",
      preferredVideoProvider: settings.preferredVideoProvider ?? "none",
    });
  }, [budget.data, form]);

  const update = useMutation(
    trpc.budget.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success("Budget settings saved");
        queryClient.invalidateQueries({ queryKey: trpc.budget.get.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.dashboard.stats.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (budget.isLoading || !form) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (budget.isError || !budget.data) {
    return (
      <EmptyPanel
        title="Could not load budget"
        description={budget.error?.message}
        action={<Button onClick={() => budget.refetch()}>Retry</Button>}
      />
    );
  }

  const data = budget.data;
  const recentUsage = data.recentUsage as unknown as UsageRow[];
  const used = data.spentInrPaise + data.reservedInrPaise;
  const usedPercent = data.amountInrPaise
    ? Math.min(100, (used / data.amountInrPaise) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Monthly budget
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {formatInr(data.amountInrPaise)}
          </div>
        </div>
        <div className="border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Spent
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {formatInr(data.spentInrPaise)}
          </div>
        </div>
        <div className="border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Reserved
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {formatInr(data.reservedInrPaise)}
          </div>
        </div>
        <div className="border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Spendable now
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {formatInr(data.spendableInrPaise)}
          </div>
        </div>
      </div>

      <div className="border border-border bg-card p-4">
        <Progress value={usedPercent} className="h-2" />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {formatInr(used)} used of {formatInr(data.amountInrPaise)}
          </span>
          <span>Retry reserve: {formatInr(data.retryReserveInrPaise)}</span>
        </div>
      </div>

      <div className="border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Monthly budget (₹)">
            <Input
              type="number"
              min={0}
              value={form.monthlyBudgetInr}
              onChange={(event) =>
                setForm({ ...form, monthlyBudgetInr: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Max cost per video (₹)">
            <Input
              type="number"
              min={0}
              value={form.maxCostPerVideoInr}
              onChange={(event) =>
                setForm({ ...form, maxCostPerVideoInr: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Max hosted video calls">
            <Input
              type="number"
              min={0}
              max={10}
              value={form.maxHostedVideoCalls}
              onChange={(event) =>
                setForm({ ...form, maxHostedVideoCalls: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Max retries">
            <Input
              type="number"
              min={0}
              max={10}
              value={form.maxRetries}
              onChange={(event) =>
                setForm({ ...form, maxRetries: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Retry reserve (%)">
            <Input
              type="number"
              min={0}
              max={90}
              value={form.reservePercent}
              onChange={(event) =>
                setForm({ ...form, reservePercent: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Daily limit">
            <Input
              type="number"
              min={1}
              max={10}
              value={form.dailyLimit}
              onChange={(event) =>
                setForm({ ...form, dailyLimit: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="USD → INR">
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={form.usdToInrRate}
              onChange={(event) =>
                setForm({ ...form, usdToInrRate: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Tax (%)">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.taxPercent}
              onChange={(event) =>
                setForm({ ...form, taxPercent: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Payment fee (%)">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.feePercent}
              onChange={(event) =>
                setForm({ ...form, feePercent: Number(event.target.value) })
              }
            />
          </Field>
          <Field label="Preferred script provider">
            <NativeSelect
              value={form.preferredLlmProvider}
              onChange={(value) =>
                setForm({ ...form, preferredLlmProvider: value })
              }
              options={MODEL_PROVIDERS}
            />
          </Field>
          <Field label="Preferred narration provider">
            <NativeSelect
              value={form.preferredTtsProvider}
              onChange={(value) =>
                setForm({ ...form, preferredTtsProvider: value })
              }
              options={TTS_PROVIDERS}
            />
          </Field>
          <Field label="Preferred visual provider">
            <NativeSelect
              value={form.preferredVisualProvider}
              onChange={(value) =>
                setForm({ ...form, preferredVisualProvider: value })
              }
              options={VISUAL_PROVIDERS}
            />
          </Field>
          <Field label="Hosted AI video provider">
            <NativeSelect
              value={form.preferredVideoProvider}
              onChange={(value) =>
                setForm({ ...form, preferredVideoProvider: value })
              }
              options={VIDEO_PROVIDERS}
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={form.timezone}
              onChange={(event) =>
                setForm({ ...form, timezone: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Toggle
            checked={form.localOnly}
            onChange={(value) => setForm({ ...form, localOnly: value })}
            label="Local-only mode"
            description="Blocks paid providers. Pexels and local services remain available."
          />
          <Toggle
            checked={form.autoFallback}
            onChange={(value) => setForm({ ...form, autoFallback: value })}
            label="Automatic fallback"
            description="Use the next safe provider when a hosted call fails."
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] leading-4 text-muted-foreground">
            Budget enforcement is app-side accounting based on estimates and
            recorded usage. It is not a provider-side hard cap.
          </p>
          <Button
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                monthlyBudgetInrPaise: Math.round(form.monthlyBudgetInr * 100),
                maxCostPerVideoInrPaise: Math.round(form.maxCostPerVideoInr * 100),
                maxHostedVideoCalls: form.maxHostedVideoCalls,
                maxRetries: form.maxRetries,
                reservePercent: form.reservePercent,
                usdToInrRate: form.usdToInrRate,
                taxPercent: form.taxPercent,
                feePercent: form.feePercent,
                dailyLimit: form.dailyLimit,
                timezone: form.timezone,
                localOnly: form.localOnly,
                autoFallback: form.autoFallback,
                preferredLlmProvider: form.preferredLlmProvider,
                preferredTtsProvider: form.preferredTtsProvider,
                preferredVisualProvider: form.preferredVisualProvider,
                preferredVideoProvider: form.preferredVideoProvider,
              })
            }
          >
            {update.isPending ? "Saving…" : "Save budget settings"}
          </Button>
        </div>
      </div>

      <div className="border border-border bg-card">
        <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recent usage
        </div>
        <div className="divide-y divide-border">
          {recentUsage.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              No usage records yet. Local providers record ₹0.
            </div>
          ) : (
            recentUsage.map((usage) => (
              <div key={usage.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div>
                  <div className="font-medium">
                    {usage.provider} · {usage.category}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {usage.model ?? "default"} · {usage.unit ?? "unit"} ·{" "}
                    {timeAgo(usage.createdAt)}
                  </div>
                </div>
                <div className="text-right font-mono text-[11px]">
                  <div>{formatInr(usage.actualCostInrPaise ?? 0)}</div>
                  <div className="text-[9px] text-muted-foreground">
                    est. {formatInr(usage.estimatedCostInrPaise)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PreferencesTab() {
  const settings = useQuery(trpc.settings.get.queryOptions());
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    defaultLanguage: string;
    defaultTone: string;
    defaultVoice: string;
    defaultSubtitleStyle: string;
    defaultVisualStyle: string;
    defaultMusicMood: string;
  } | null>(null);

  useEffect(() => {
    if (!settings.data || form) return;
    setForm({
      defaultLanguage: settings.data.defaultLanguage,
      defaultTone: settings.data.defaultTone ?? "",
      defaultVoice: settings.data.defaultVoice ?? "",
      defaultSubtitleStyle: settings.data.defaultSubtitleStyle,
      defaultVisualStyle: settings.data.defaultVisualStyle,
      defaultMusicMood: settings.data.defaultMusicMood,
    });
  }, [settings.data, form]);

  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Preferences saved");
        queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (settings.isLoading || !form) return <Skeleton className="h-64 w-full" />;
  if (settings.isError) {
    return (
      <EmptyPanel
        title="Could not load preferences"
        description={settings.error?.message}
        action={<Button onClick={() => settings.refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="max-w-3xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default language">
          <Input
            value={form.defaultLanguage}
            onChange={(event) =>
              setForm({ ...form, defaultLanguage: event.target.value })
            }
          />
        </Field>
        <Field label="Default tone">
          <Input
            value={form.defaultTone}
            onChange={(event) => setForm({ ...form, defaultTone: event.target.value })}
          />
        </Field>
        <Field label="Default voice">
          <Input
            value={form.defaultVoice}
            onChange={(event) => setForm({ ...form, defaultVoice: event.target.value })}
          />
        </Field>
        <Field label="Default subtitle style">
          <NativeSelect
            value={form.defaultSubtitleStyle}
            onChange={(value) => setForm({ ...form, defaultSubtitleStyle: value })}
            options={[
              { value: "bold", label: "Bold" },
              { value: "clean", label: "Clean" },
              { value: "karaoke", label: "Karaoke" },
              { value: "minimal", label: "Minimal" },
            ]}
          />
        </Field>
        <Field label="Default visual style">
          <NativeSelect
            value={form.defaultVisualStyle}
            onChange={(value) => setForm({ ...form, defaultVisualStyle: value })}
            options={[
              { value: "cinematic", label: "Cinematic" },
              { value: "minimal", label: "Minimal" },
              { value: "bold", label: "Bold" },
              { value: "documentary", label: "Documentary" },
              { value: "tech", label: "Tech" },
              { value: "nature", label: "Nature" },
            ]}
          />
        </Field>
        <Field label="Default music mood">
          <NativeSelect
            value={form.defaultMusicMood}
            onChange={(value) => setForm({ ...form, defaultMusicMood: value })}
            options={[
              { value: "ambient", label: "Ambient" },
              { value: "cinematic", label: "Cinematic" },
              { value: "upbeat", label: "Upbeat" },
              { value: "lofi", label: "Lo-fi" },
              { value: "none", label: "None" },
            ]}
          />
        </Field>
      </div>
      <Button
        className="mt-4"
        disabled={update.isPending}
        onClick={() =>
          update.mutate({
            defaultLanguage: form.defaultLanguage,
            defaultTone: form.defaultTone || undefined,
            defaultVoice: form.defaultVoice || undefined,
            defaultSubtitleStyle: form.defaultSubtitleStyle as "bold",
            defaultVisualStyle: form.defaultVisualStyle as "cinematic",
            defaultMusicMood: form.defaultMusicMood as "ambient",
          })
        }
      >
        {update.isPending ? "Saving…" : "Save preferences"}
      </Button>
    </div>
  );
}

function PublishingTab() {
  const accounts = useQuery(trpc.publishing.accounts.list.queryOptions());
  const setup = useQuery(
    trpc.publishing.setup.queryOptions({ platform: "YOUTUBE" }),
  );
  const connectUrl = useQuery(
    trpc.publishing.accounts.connectUrl.queryOptions(
      { platform: "YOUTUBE" },
      { enabled: false },
    ),
  );
  const queryClient = useQueryClient();
  const disconnect = useMutation(
    trpc.publishing.accounts.disconnect.mutationOptions({
      onSuccess: () => {
        toast.success("Account disconnected");
        queryClient.invalidateQueries({
          queryKey: trpc.publishing.accounts.list.queryKey(),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const test = useMutation(
    trpc.publishing.accounts.test.mutationOptions({
      onSuccess: (result) => {
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  async function connect() {
    try {
      const result = await connectUrl.refetch();
      if (result.data?.url) window.location.href = result.data.url;
      else toast.error("YouTube OAuth is not configured");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "YouTube OAuth is not configured",
      );
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Publishing accounts
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={connect}>
            <Video className="size-3.5" />
            Connect YouTube
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {!accounts.data || accounts.data.length === 0 ? (
            <div className="border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No accounts connected.
            </div>
          ) : (
            accounts.data.map((account) => (
              <div key={account.id} className="border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Video className="size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">
                      {account.accountName ?? account.externalAccountId}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {account.platform} · {account.status}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => test.mutate({ accountId: account.id })}
                  >
                    Test
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => disconnect.mutate({ accountId: account.id })}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            YouTube setup
          </div>
          <Badge variant={setup.data?.supported ? "success" : "warning"}>
            {setup.data?.supported ? "Official API" : "Manual"}
          </Badge>
        </div>
        <ol className="mt-3 space-y-1.5 text-[11px] leading-5 text-muted-foreground">
          {(setup.data?.steps ?? []).map((step, index) => (
            <li key={step}>
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        {setup.data?.docs ? (
          <a
            href={setup.data.docs}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[11px] underline underline-offset-4"
          >
            Official docs <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>

      <div className="border border-border bg-muted/20 p-4 text-[11px] leading-5 text-muted-foreground lg:col-span-2">
        <ShieldCheck className="mb-1 size-4" />
        OAuth tokens are encrypted with AES-256-GCM. API keys are server-only and
        never returned to the browser. Instagram and TikTok publishing requires
        approved developer apps; this build uses manual export for those
        platforms and will not claim a manual download was published.
      </div>
    </div>
  );
}

function UsageTab() {
  const [page, setPage] = useState(1);
  const usage = useQuery(
    trpc.budget.usage.queryOptions({
      page,
      pageSize: 25,
      costType: "ALL",
    }),
  );
  const ledgerRows = (usage.data?.items ?? []) as unknown as UsageLedgerRow[];

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Usage ledger
        </div>
        <Badge variant="outline">{usage.data?.total ?? 0} records</Badge>
      </div>
      {usage.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
          ) : ledgerRows.length === 0 ? (
        <div className="p-6 text-xs text-muted-foreground">No usage records yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-[11px]">
            <thead className="bg-muted/40 uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Provider</th>
                <th className="p-2">Category</th>
                <th className="p-2">Model</th>
                <th className="p-2">Units</th>
                <th className="p-2 text-right">Estimated</th>
                <th className="p-2 text-right">Actual</th>
                <th className="p-2">Request</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-2 text-muted-foreground">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="p-2">{row.provider}</td>
                  <td className="p-2">{row.category.replaceAll("_", " ")}</td>
                  <td className="p-2 font-mono">{row.model ?? "—"}</td>
                  <td className="p-2">
                    {row.inputUnits ?? row.outputUnits ?? "—"} {row.unit ?? ""}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {formatInr(row.estimatedCostInrPaise)}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {row.actualCostInrPaise === null
                      ? "—"
                      : formatInr(row.actualCostInrPaise)}
                  </td>
                  <td className="p-2 font-mono text-[9px] text-muted-foreground">
                    {row.providerRequestId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border p-3 text-[11px] text-muted-foreground">
        <span>
          Page {usage.data?.page ?? 1} · {usage.data?.pageSize ?? 25} per page
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !usage.data || usage.data.items.length < (usage.data.pageSize ?? 25)
            }
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "providers";
  const [tab, setTab] = useState(
    TABS.some((item) => item.value === initialTab) ? initialTab : "providers",
  );

  useEffect(() => {
    const next = searchParams.get("tab");
    if (next && TABS.some((item) => item.value === next)) setTab(next);
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Providers, credentials, pricing, budgets, defaults, and publishing accounts. Secrets never leave the server."
        actions={
          <Button nativeButton={false} variant="outline" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={TABS} />
      {tab === "providers" ? <ProvidersTab /> : null}
      {tab === "budget" ? <BudgetTab /> : null}
      {tab === "preferences" ? <PreferencesTab /> : null}
      {tab === "publishing" ? <PublishingTab /> : null}
      {tab === "usage" ? <UsageTab /> : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <SettingsInner />
    </Suspense>
  );
}
