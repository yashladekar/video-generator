"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  Film,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@video-generator/ui/components/button";
import { Skeleton } from "@video-generator/ui/components/skeleton";

import {
  Badge,
  EmptyPanel,
  PageHeader,
  Progress,
  StatusBadge,
} from "@/components/ui/primitives";
import { formatDate, formatInr, timeAgo, truncate } from "@/lib/format";
import { trpc } from "@/utils/trpc";

type ProjectDetail = {
  id: string;
  title: string;
  topic: string;
  niche: string | null;
  targetAudience: string | null;
  objective: string | null;
  language: string;
  tone: string | null;
  cta: string | null;
  status: string;
  durationSeconds: number;
  resolution: string;
  platform: string;
  estimatedCostInrPaise: number;
  actualCostInrPaise: number;
  createdAt: string;
  brief: { researchEnabled: boolean } | null;
  thumbnailAsset: { url: string } | null;
  scripts: Array<{
    provider: string;
    scenes: Array<{
      id: string;
      sceneNumber: number;
      durationSeconds: number;
      visualType: string;
      status: string;
      narration: string;
      visualDescription: string;
    }>;
  }>;
  renderedVideos: Array<{
    id: string;
    kind: string;
    status: string;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
    createdAt: string;
    videoAsset: { url: string };
    thumbnailAsset: { url: string } | null;
  }>;
  generationJobs: Array<{
    id: string;
    kind: string;
    status: string;
    progress: number;
    currentStep: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  usageRecords: Array<{
    id: string;
    provider: string;
    category: string;
    model: string | null;
    estimatedCostInrPaise: number;
    actualCostInrPaise: number | null;
    createdAt: string;
  }>;
  publishingJobs: Array<{
    id: string;
    platform: string;
    status: string;
    createdAt: string;
    externalUrl: string | null;
  }>;
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const queryClient = useQueryClient();

  const projectQuery = useQuery(
    trpc.projects.get.queryOptions(
      { projectId: projectId ?? "" },
      { enabled: Boolean(projectId) },
    ),
  );

  const invalidate = () => {
    if (!projectId) return;
    queryClient.invalidateQueries({
      queryKey: trpc.projects.get.queryKey({ projectId }),
    });
    queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
  };

  const preview = useMutation(
    trpc.generation.preview.mutationOptions(),
  );
  const finalRender = useMutation(
    trpc.generation.final.mutationOptions(),
  );

  async function runPreview() {
    if (!projectId) return;
    try {
      await preview.mutateAsync({
        projectId,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success("Preview render queued");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Render failed");
    }
  }

  async function runFinal() {
    if (!projectId) return;
    try {
      await finalRender.mutateAsync({
        projectId,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success("Final render queued");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Render failed");
    }
  }

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <EmptyPanel
        icon={<AlertTriangle className="size-6" />}
        title="Project not found"
        description={projectQuery.error?.message ?? "It may have been deleted."}
        action={
          <Button nativeButton={false} render={<Link href="/projects" />}>Back to projects</Button>
        }
      />
    );
  }

  const project = projectQuery.data as unknown as ProjectDetail;
  const script = project.scripts[0];
  const finalVideo = project.renderedVideos.find(
    (render) => render.kind === "FINAL" && render.status === "COMPLETED",
  );
  const totalScenes = script?.scenes.length ?? 0;
  const activeJob = project.generationJobs.find((job) =>
    ["QUEUED", "RUNNING"].includes(job.status),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/projects" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <span>/</span>
        <span className="text-foreground">{project.title}</span>
      </div>

      <PageHeader
        eyebrow="Project"
        title={project.title}
        description={project.topic}
        actions={
          <>
            <Button nativeButton={false}
              className="gap-1.5"
              render={<Link href={`/studio/${project.id}`} />}
            >
              <Sparkles className="size-4" />
              Open Studio
            </Button>
            {finalVideo ? (
              <>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => window.open(`${finalVideo.videoAsset.url}?download=1`, "_blank")}
                >
                  <Download className="size-4" />
                  Download
                </Button>
                <Button nativeButton={false}
                  variant="outline"
                  className="gap-1.5"
                  render={<Link href={`/publishing?project=${project.id}`} />}
                >
                  <Send className="size-4" />
                  Publish
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="aspect-[9/16] w-full overflow-hidden border border-border bg-muted">
            {finalVideo ? (
              <video
                controls
                playsInline
                src={finalVideo.videoAsset.url}
                poster={finalVideo.thumbnailAsset?.url}
                className="size-full object-cover"
              />
            ) : project.thumbnailAsset?.url ? (
              <img
                src={project.thumbnailAsset.url}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-muted/30 text-muted-foreground">
                <Film className="size-8" />
                <span className="text-xs">No render yet</span>
              </div>
            )}
          </div>

          <div className="border border-border bg-card p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={project.status} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-mono">{project.durationSeconds}s</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Resolution</span>
              <span className="font-mono">{project.resolution}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Platform</span>
              <span>{project.platform.replaceAll("_", " ")}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Estimated cost</span>
              <span className="font-mono">{formatInr(project.estimatedCostInrPaise)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Actual recorded</span>
              <span className="font-mono">{formatInr(project.actualCostInrPaise)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(project.createdAt)}</span>
            </div>
          </div>

          <div className="space-y-2 border border-border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Render
            </div>
            <Button
              variant="outline"
              className="w-full gap-1.5"
              disabled={!script || preview.isPending || Boolean(activeJob)}
              onClick={() => void runPreview()}
            >
              <Play className="size-3.5" />
              Preview render
            </Button>
            <Button
              className="w-full gap-1.5"
              disabled={!script || finalRender.isPending || Boolean(activeJob)}
              onClick={() => void runFinal()}
            >
              <Film className="size-3.5" />
              Final render
            </Button>
            {!script ? (
              <p className="text-[11px] text-muted-foreground">
                Generate a script first from the Create flow.
              </p>
            ) : null}
            {activeJob ? (
              <div className="space-y-1">
                <Progress value={activeJob.progress} />
                <p className="text-[11px] text-muted-foreground">
                  {activeJob.status.toLowerCase()} · {activeJob.currentStep ?? "starting"}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="border border-border bg-card p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Brief
            </div>
            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              {[
                ["Topic", project.topic],
                ["Niche", project.niche ?? "—"],
                ["Audience", project.targetAudience ?? "—"],
                ["Objective", project.objective ?? "—"],
                ["Language", project.language],
                ["Tone", project.tone ?? "—"],
                ["CTA", project.cta ?? "—"],
                ["Research", project.brief?.researchEnabled ? "Enabled" : "Disabled"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-muted-foreground">{label}</div>
                  <div className="mt-0.5">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Scenes
              </div>
              <div className="mt-1 text-xl font-semibold">{totalScenes}</div>
            </div>
            <div className="border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Script provider
              </div>
              <div className="mt-1 text-sm">{script?.provider ?? "—"}</div>
            </div>
            <div className="border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Renders
              </div>
              <div className="mt-1 text-xl font-semibold">{project.renderedVideos.length}</div>
            </div>
            <div className="border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Publish jobs
              </div>
              <div className="mt-1 text-xl font-semibold">{project.publishingJobs.length}</div>
            </div>
          </div>

          <div className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Scenes
              </div>
              {script ? (
                <Button nativeButton={false}
                  variant="outline"
                  size="sm"
                  render={<Link href={`/studio/${project.id}`} />}
                >
                  Edit in Studio
                </Button>
              ) : null}
            </div>
            {!script ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No script yet. Create a reel to generate one.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {script.scenes.map((scene) => (
                  <div key={scene.id} className="flex gap-3 p-3">
                    <div className="flex size-7 shrink-0 items-center justify-center border border-border font-mono text-[10px]">
                      {String(scene.sceneNumber).padStart(2, "0")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {scene.durationSeconds.toFixed(1)}s
                        </span>
                        <Badge variant="outline">
                          {scene.visualType.replaceAll("_", " ").toLowerCase()}
                        </Badge>
                        <StatusBadge status={scene.status} />
                      </div>
                      <p className="mt-1 text-xs">{truncate(scene.narration, 220)}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Visual: {truncate(scene.visualDescription, 140)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="border border-border bg-card">
              <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Job history
              </div>
              <div className="max-h-80 divide-y divide-border overflow-y-auto">
                {project.generationJobs.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">No jobs yet.</div>
                ) : (
                  project.generationJobs.map((job) => (
                    <div key={job.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {job.kind} · {job.id.slice(-6)}
                        </span>
                        <StatusBadge status={job.status} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span>{timeAgo(job.createdAt)}</span>
                        <span>{job.progress}%</span>
                      </div>
                      <Progress value={job.progress} className="mt-1 h-1" />
                      {job.errorMessage ? (
                        <p className="mt-1 line-clamp-2 text-[10px] text-red-500">
                          {job.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border border-border bg-card">
              <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Rendered videos
              </div>
              <div className="divide-y divide-border">
                {project.renderedVideos.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">No renders yet.</div>
                ) : (
                  project.renderedVideos.map((render) => (
                    <div key={render.id} className="flex items-center gap-3 p-3 text-xs">
                      <div className="aspect-[9/16] w-10 overflow-hidden bg-muted">
                        {render.thumbnailAsset?.url ? (
                          <img
                            src={render.thumbnailAsset.url}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{render.kind}</span>
                          <StatusBadge status={render.status} />
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {render.durationSeconds?.toFixed(1)}s · {render.width}×
                          {render.height} · {timeAgo(render.createdAt)}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(render.videoAsset.url, "_blank")}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="border border-border bg-card">
              <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Usage records
              </div>
              <div className="max-h-64 divide-y divide-border overflow-y-auto">
                {project.usageRecords.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">
                    No paid calls recorded.
                  </div>
                ) : (
                  project.usageRecords.slice(0, 20).map((usage) => (
                    <div key={usage.id} className="flex items-center justify-between gap-2 p-3 text-xs">
                      <div>
                        <div className="font-medium">{usage.provider}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {usage.category} · {usage.model ?? "default"} ·{" "}
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

            <div className="border border-border bg-card">
              <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Publishing
              </div>
              <div className="divide-y divide-border">
                {project.publishingJobs.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">
                    Not published or exported yet.
                  </div>
                ) : (
                  project.publishingJobs.map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-2 p-3 text-xs">
                      <div>
                        <div className="font-medium">{job.platform.replaceAll("_", " ")}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {timeAgo(job.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={job.status} />
                        {job.externalUrl ? (
                          <a
                            href={job.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
