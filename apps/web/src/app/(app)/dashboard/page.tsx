"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Film,
  FolderKanban,
  Plus,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Button } from "@video-generator/ui/components/button";
import { Skeleton } from "@video-generator/ui/components/skeleton";

import {
  Badge,
  EmptyPanel,
  PageHeader,
  Progress,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { formatInr, percent, timeAgo } from "@/lib/format";
import { trpc } from "@/utils/trpc";

type RecentProject = {
  id: string;
  title: string;
  topic: string;
  status: string;
  durationSeconds: number;
  resolution: string;
  actualCostInrPaise: number;
  createdAt: string;
  thumbnailAsset: { url: string } | null;
  renderedVideos: Array<{ thumbnailAsset: { url: string } | null }>;
};

type RecentJob = {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: number;
  currentStep: string | null;
  errorMessage: string | null;
  createdAt: string;
  project: { title: string };
};

export default function DashboardPage() {
  const stats = useQuery(trpc.dashboard.stats.queryOptions());
  const data = stats.data;

  if (stats.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (stats.isError || !data) {
    return (
      <EmptyPanel
        icon={<AlertTriangle className="size-6" />}
        title="Could not load dashboard"
        description={stats.error?.message ?? "Try refreshing the page."}
        action={<Button onClick={() => stats.refetch()}>Retry</Button>}
      />
    );
  }

  const used = data.budget.spentInrPaise + data.budget.reservedInrPaise;
  const usedPercent = percent(used, data.budget.amountInrPaise);
  const dailyPercent = percent(data.daily.generated, data.daily.limit);
  const recentProjects = data.recentProjects as unknown as RecentProject[];
  const recentJobs = data.recentJobs as unknown as RecentJob[];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description="Your generation pipeline, budget, and recent activity — all from persisted data."
        actions={
          <Link href="/create">
            <Button className="gap-1.5">
              <Plus className="size-4" />
              Create New Reel
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Videos created"
          value={data.totals.videosCreated}
          hint="Completed final renders"
          icon={<Film className="size-4" />}
        />
        <StatCard
          label="Published"
          value={data.totals.published}
          hint="Real platform publishes"
          icon={<Send className="size-4" />}
          accent="success"
        />
        <StatCard
          label="Awaiting review"
          value={data.totals.awaitingReview}
          hint="Final renders not approved"
          icon={<CheckCircle2 className="size-4" />}
          accent="warning"
        />
        <StatCard
          label="Failed jobs"
          value={data.totals.failedJobs}
          hint="Last 30 days"
          icon={<AlertTriangle className="size-4" />}
          accent={data.totals.failedJobs > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Wallet className="size-3.5" />
                Monthly budget
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {formatInr(data.budget.spentInrPaise)}
                </span>
                <span className="text-xs text-muted-foreground">
                  spent of {formatInr(data.budget.amountInrPaise)}
                </span>
              </div>
            </div>
            <Link href="/settings?tab=budget">
              <Button variant="outline" size="sm">
                Budget settings
              </Button>
            </Link>
          </div>
          <Progress
            value={usedPercent}
            className="mt-4 h-2"
            indicatorClassName={usedPercent > 85 ? "bg-red-500" : undefined}
          />
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">Spent</div>
              <div className="font-mono">{formatInr(data.budget.spentInrPaise)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Reserved</div>
              <div className="font-mono">{formatInr(data.budget.reservedInrPaise)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Retry reserve</div>
              <div className="font-mono">{formatInr(data.budget.retryReserveInrPaise)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Spendable now</div>
              <div className="font-mono text-emerald-600 dark:text-emerald-400">
                {formatInr(data.budget.spendableInrPaise)}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
            Estimates: {formatInr(data.budget.estimatedInrPaise)} · Actual recorded:{" "}
            {formatInr(data.budget.actualInrPaise)}. Provider billing can differ;
            set provider-side limits as well.
          </p>
        </div>

        <div className="border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Sparkles className="size-3.5" />
              Daily generation
            </div>
            {data.settings.localOnly ? <Badge variant="info">Local only</Badge> : null}
          </div>
          <div className="mt-3 text-3xl font-semibold">
            {data.daily.generated}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              / {data.daily.limit}
            </span>
          </div>
          <Progress value={dailyPercent} className="mt-3 h-2" />
          <div className="mt-2 text-xs text-muted-foreground">
            {data.daily.remaining > 0
              ? `${data.daily.remaining} generation${data.daily.remaining === 1 ? "" : "s"} left today`
              : "Daily limit reached. Try again tomorrow."}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
            <div>
              <div className="text-muted-foreground">USD → INR</div>
              <div className="font-mono">{data.settings.usdToInrRate}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Daily limit</div>
              <div className="font-mono">{data.settings.dailyLimit}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Recent projects
            </h2>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          {recentProjects.length === 0 ? (
            <EmptyPanel
              icon={<FolderKanban className="size-6" />}
              title="No projects yet"
              description="Create your first reel. The default local pipeline costs ₹0."
              action={
                <Link href="/create">
                  <Button className="gap-1.5">
                    <Plus className="size-4" />
                    Create New Reel
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {recentProjects.map((project) => {
                const thumbnail =
                  project.thumbnailAsset?.url ??
                  project.renderedVideos[0]?.thumbnailAsset?.url ??
                  null;
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group flex gap-3 border border-border bg-card p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden bg-muted">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt=""
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-muted/40">
                          <Film className="size-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {project.title}
                          </div>
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">
                            {project.topic}
                          </div>
                        </div>
                        <StatusBadge status={project.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{project.durationSeconds}s</span>
                        <span>{project.resolution}</span>
                        <span>{formatInr(project.actualCostInrPaise)} actual</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {timeAgo(project.createdAt)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Generation activity
          </h2>
          <div className="border border-border bg-card">
            {recentJobs.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No generation jobs yet.
              </div>
            ) : (
              recentJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/projects/${job.projectId}`}
                  className="block border-b border-border p-3 last:border-b-0 hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {job.project.title}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {job.currentStep
                          ? job.currentStep.replaceAll("_", " ").toLowerCase()
                          : job.kind.toLowerCase()}{" "}
                        · {timeAgo(job.createdAt)}
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                  {job.status === "RUNNING" || job.status === "QUEUED" ? (
                    <Progress value={job.progress} className="mt-2 h-1" />
                  ) : job.errorMessage ? (
                    <div className="mt-1 line-clamp-2 text-[10px] text-red-500">
                      {job.errorMessage}
                    </div>
                  ) : null}
                </Link>
              ))
            )}
          </div>
          <div className="border border-border bg-muted/20 p-3 text-[11px] leading-5 text-muted-foreground">
            <CircleDollarSign className="mb-1 size-3.5" />
            Local providers (template/Ollama, macOS speech, procedural visuals,
            procedural music) keep a reel at ₹0. Hosted calls are optional and
            require configured pricing.
          </div>
        </section>
      </div>
    </div>
  );
}
