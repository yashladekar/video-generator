"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Film,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  Volume2,
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
  Progress,
  StatusBadge,
} from "@/components/ui/primitives";
import { formatDuration, formatInr, timeAgo } from "@/lib/format";
import { uploadFile } from "@/lib/upload";
import { useStudioStore } from "@/stores/studio";
import { trpc } from "@/utils/trpc";

type SceneLike = {
  id: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  subtitleText: string;
  visualDescription: string;
  visualType: string;
  transition: string;
  motion: string | null;
  status: string;
  updatedAt: string | Date;
  visualAsset?: { url: string } | null;
  narrationAsset?: { url: string } | null;
};

const VISUAL_TYPES = [
  "PROCEDURAL",
  "IMAGE_ANIMATION",
  "STOCK_IMAGE",
  "STOCK_VIDEO",
  "AI_IMAGE",
  "AI_VIDEO",
].map((value) => ({
  value,
  label: value.replaceAll("_", " ").toLowerCase(),
}));

const MOTIONS = [
  { value: "", label: "Default motion" },
  { value: "zoom_in", label: "Zoom in" },
  { value: "zoom_out", label: "Zoom out" },
  { value: "pan_left", label: "Pan left" },
  { value: "pan_right", label: "Pan right" },
  { value: "static", label: "Static" },
];

const TRANSITIONS = [
  { value: "cut", label: "Cut" },
  { value: "fade", label: "Fade" },
];

const CAPTION_STYLES = [
  { value: "bold", label: "Bold" },
  { value: "clean", label: "Clean" },
  { value: "karaoke", label: "Karaoke" },
  { value: "minimal", label: "Minimal" },
];

const CAPTION_POSITIONS = [
  { value: "bottom", label: "Bottom" },
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
];

const MUSIC_MOODS = [
  { value: "ambient", label: "Ambient" },
  { value: "cinematic", label: "Cinematic" },
  { value: "upbeat", label: "Upbeat" },
  { value: "lofi", label: "Lo-fi" },
  { value: "none", label: "No music" },
];

function SortableSceneCard({
  scene,
  selected,
  onSelect,
}: {
  scene: SceneLike;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scene.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative w-44 shrink-0 border bg-[#101014] text-left transition-colors",
        selected ? "border-amber-400" : "border-white/10 hover:border-white/25",
        isDragging && "z-20 opacity-80",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full text-left"
      >
        <div className="relative aspect-[9/16] w-full overflow-hidden bg-black/40">
          {scene.visualAsset?.url ? (
            <img
              src={scene.visualAsset.url}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon className="size-5 text-white/25" />
            </div>
          )}
          <div className="absolute left-1.5 top-1.5 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white">
            {String(scene.sceneNumber).padStart(2, "0")}
          </div>
          <div className="absolute bottom-1.5 right-1.5 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white">
            {scene.durationSeconds.toFixed(1)}s
          </div>
        </div>
        <div className="space-y-1 p-2">
          <div className="line-clamp-2 text-[11px] leading-4 text-white/80">
            {scene.narration}
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] uppercase tracking-wide text-white/35">
              {scene.visualType.replaceAll("_", " ").toLowerCase()}
            </span>
            <StatusBadge status={scene.status} />
          </div>
        </div>
      </button>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute right-1 top-1 cursor-grab bg-black/70 p-1 text-white/50 hover:text-white"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>
    </div>
  );
}

function Track({
  label,
  scenes,
  color,
  icon,
}: {
  label: string;
  scenes: SceneLike[];
  color: string;
  icon: ReactNode;
}) {
  const total = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) || 1;
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-24 shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/35">
        {icon}
        {label}
      </div>
      <div className="flex h-7 flex-1 overflow-hidden border border-white/10 bg-white/[0.02]">
        {scenes.map((scene) => (
          <div
            key={scene.id}
            className={cn("h-full border-r border-black/30", color)}
            style={{ width: `${(scene.durationSeconds / total) * 100}%` }}
            title={`${scene.sceneNumber}: ${scene.narration.slice(0, 80)}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const queryClient = useQueryClient();
  const { selectedSceneId, setSelectedSceneId, previewKind, setPreviewKind } =
    useStudioStore();
  const [uploadingVisual, setUploadingVisual] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const studio = useQuery(
    trpc.studio.get.queryOptions(
      { projectId: projectId ?? "" },
      {
        enabled: Boolean(projectId),
        refetchInterval: (query) => {
          const data = query.state.data;
          return data?.jobs?.some((job) =>
            ["QUEUED", "RUNNING"].includes(job.status),
          )
            ? 2000
            : false;
        },
      },
    ),
  );
  const budget = useQuery(trpc.budget.get.queryOptions());

  const data = studio.data;
  const scenes = (data?.script?.scenes ?? []) as SceneLike[];
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const activeJob = data?.jobs.find((job) =>
    ["QUEUED", "RUNNING"].includes(job.status),
  );
  const latestFinal = data?.renderedVideos.find(
    (render) => render.kind === "FINAL" && render.status === "COMPLETED",
  );
  const latestPreview = data?.renderedVideos.find(
    (render) => render.kind === "PREVIEW" && render.status === "COMPLETED",
  );
  const selectedRender =
    previewKind === "PREVIEW"
      ? latestPreview ?? latestFinal
      : latestFinal ?? latestPreview;
  const totalDuration = useMemo(
    () => scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    [scenes],
  );

  const [narration, setNarration] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  const [duration, setDuration] = useState(5);
  const [transition, setTransition] = useState("cut");
  const [motion, setMotion] = useState("");
  const [visualType, setVisualType] = useState("PROCEDURAL");
  const [visualDescription, setVisualDescription] = useState("");
  const [captionStyle, setCaptionStyle] = useState("bold");
  const [captionPosition, setCaptionPosition] = useState("bottom");
  const [musicMood, setMusicMood] = useState("ambient");
  const [musicVolume, setMusicVolume] = useState(0.15);

  useEffect(() => {
    if (scenes.length > 0 && !scenes.some((scene) => scene.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]?.id ?? null);
    }
  }, [scenes, selectedSceneId, setSelectedSceneId]);

  useEffect(() => {
    if (!selectedScene) return;
    setNarration(selectedScene.narration);
    setSubtitleText(selectedScene.subtitleText);
    setDuration(selectedScene.durationSeconds);
    setTransition(selectedScene.transition);
    setMotion(selectedScene.motion ?? "");
    setVisualType(selectedScene.visualType);
    setVisualDescription(selectedScene.visualDescription);
  }, [selectedScene?.id, selectedScene?.updatedAt]);

  useEffect(() => {
    if (!data?.project) return;
    setCaptionStyle(data.project.subtitleStyle);
    setCaptionPosition(data.project.captionPosition);
    setMusicMood(data.project.musicMood);
    setMusicVolume(data.project.musicVolume);
  }, [data?.project?.id, data?.project?.updatedAt]);

  const invalidate = () => {
    if (!projectId) return;
    queryClient.invalidateQueries({
      queryKey: trpc.studio.get.queryKey({ projectId }),
    });
    queryClient.invalidateQueries({ queryKey: trpc.budget.get.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.projects.get.queryKey({ projectId }) });
  };

  const previewMutation = useMutation(
    trpc.generation.preview.mutationOptions({
      onSuccess: () => {
        toast.success("Preview render queued");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const finalMutation = useMutation(
    trpc.generation.final.mutationOptions({
      onSuccess: () => {
        toast.success("Final render queued");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateScene = useMutation(
    trpc.studio.updateScene.mutationOptions({
      onSuccess: () => {
        toast.success("Scene saved");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const reorder = useMutation(
    trpc.studio.reorderScenes.mutationOptions({
      onSuccess: () => {
        toast.success("Scene order saved");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const regenerateScene = useMutation(
    trpc.studio.regenerateScene.mutationOptions({
      onSuccess: () => {
        toast.success("Scene regeneration queued");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const regenerateVoice = useMutation(
    trpc.studio.regenerateVoiceover.mutationOptions({
      onSuccess: () => {
        toast.success("Voiceover regeneration queued");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const replaceVisual = useMutation(
    trpc.studio.replaceVisual.mutationOptions({
      onSuccess: () => {
        toast.success("Visual replaced");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const approve = useMutation(
    trpc.studio.approveVideo.mutationOptions({
      onSuccess: () => {
        toast.success("Final render approved");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateCaption = useMutation(
    trpc.studio.updateCaptionStyle.mutationOptions({
      onSuccess: () => {
        toast.success("Caption style saved");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateMusic = useMutation(
    trpc.studio.updateMusic.mutationOptions({
      onSuccess: () => {
        toast.success("Music settings saved");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const cancelJob = useMutation(
    trpc.generation.cancel.mutationOptions({
      onSuccess: () => {
        toast.success("Cancellation requested");
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((scene) => scene.id === active.id);
    const newIndex = scenes.findIndex((scene) => scene.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(scenes, oldIndex, newIndex);
    if (projectId) {
      reorder.mutate({
        projectId,
        sceneIds: next.map((scene) => scene.id),
      });
    }
  }

  if (!projectId) {
    return <EmptyPanel title="Missing project id" />;
  }
  if (studio.isLoading) {
    return (
      <div className="min-h-[70vh] bg-[#09090b] p-6">
        <Skeleton className="h-14 w-full" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[340px_1fr]">
          <Skeleton className="aspect-[9/16] w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }
  if (studio.isError || !data) {
    return (
      <div className="min-h-[70vh] bg-[#09090b] p-6 text-zinc-100">
        <EmptyPanel
          icon={<AlertTriangle className="size-6" />}
          title="Could not open the studio"
          description={studio.error?.message ?? "Try refreshing."}
          action={<Button onClick={() => studio.refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  const project = data.project;
  const validation = selectedRender?.validation as
    | { passed?: boolean; issues?: string[] }
    | null
    | undefined;
  const approved = Boolean(selectedRender?.isApproved);

  async function onVisualUpload(file: File) {
    if (!selectedScene) return;
    setUploadingVisual(true);
    try {
      const asset = await uploadFile(file, {
        projectId,
        kind: "visual",
      });
      replaceVisual.mutate({ sceneId: selectedScene.id, assetId: asset.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploadingVisual(false);
    }
  }

  return (
    <div className="dark min-h-[calc(100svh-3.5rem)] bg-[#08090b] text-zinc-100">
      <div className="border-b border-white/10 bg-[#0b0c10]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1.5 text-[11px] text-white/45 hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            Project
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{project.title}</div>
            <div className="text-[10px] text-white/35">
              {project.durationSeconds}s target · {project.resolution} ·{" "}
              {scenes.length} scenes
            </div>
          </div>
          <StatusBadge status={project.status} />
          {activeJob ? (
            <Badge variant="info" className="bg-sky-500/10 text-sky-300">
              {activeJob.currentStep?.replaceAll("_", " ").toLowerCase() ?? "queued"}
            </Badge>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {budget.data ? (
              <span className="hidden items-center gap-1 text-[10px] text-white/40 sm:flex">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {formatInr(budget.data.spendableInrPaise)} spendable
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              disabled={Boolean(activeJob) || previewMutation.isPending}
              onClick={() =>
                previewMutation.mutate({
                  projectId,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              <Play className="size-3.5" />
              Preview render
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-amber-400 text-black hover:bg-amber-300"
              disabled={Boolean(activeJob) || finalMutation.isPending}
              onClick={() =>
                finalMutation.mutate({
                  projectId,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              <Film className="size-3.5" />
              Final export
            </Button>
            {selectedRender && selectedRender.kind === "FINAL" ? (
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                disabled={approved || approve.isPending}
                onClick={() => approve.mutate({ renderedVideoId: selectedRender.id })}
              >
                <CheckCircle2 className="size-3.5" />
                {approved ? "Approved" : "Approve"}
              </Button>
            ) : null}
            <Link href={`/publishing?project=${project.id}`}>
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Send className="size-3.5" />
                Publish
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {!data.script ? (
        <div className="p-6">
          <EmptyPanel
            icon={<Sparkles className="size-6" />}
            title="No script yet"
            description="Generate a reel first. The Studio becomes available after the script and scenes are created."
            action={
              <Link href={`/create`}>
                <Button>Create a reel</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 p-3 sm:p-4 xl:grid-cols-[350px_minmax(0,1fr)_360px]">
          <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <div className="border border-white/10 bg-[#0d0e12]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-wider text-white/35">
                <span>Preview</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewKind("PREVIEW")}
                    className={cn(
                      "px-2 py-1 text-[9px] uppercase tracking-wide",
                      previewKind === "PREVIEW"
                        ? "bg-white/10 text-white"
                        : "text-white/35 hover:text-white",
                    )}
                  >
                    Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewKind("FINAL")}
                    className={cn(
                      "px-2 py-1 text-[9px] uppercase tracking-wide",
                      previewKind === "FINAL"
                        ? "bg-white/10 text-white"
                        : "text-white/35 hover:text-white",
                    )}
                  >
                    Final
                  </button>
                </div>
              </div>
              <div className="relative aspect-[9/16] w-full overflow-hidden bg-black">
                {selectedRender ? (
                  <video
                    key={selectedRender.id}
                    controls
                    playsInline
                    src={selectedRender.videoAsset.url}
                    poster={selectedRender.thumbnailAsset?.url}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-2 text-white/30">
                    <Film className="size-8" />
                    <div className="text-xs">No render yet</div>
                    <Button
                      size="sm"
                      className="mt-1 bg-white text-black hover:bg-white/90"
                      disabled={Boolean(activeJob) || previewMutation.isPending}
                      onClick={() =>
                        previewMutation.mutate({
                          projectId,
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      Render preview
                    </Button>
                  </div>
                )}
                {selectedRender ? (
                  <div className="pointer-events-none absolute left-2 top-2 bg-black/70 px-2 py-1 text-[9px] uppercase tracking-wide text-white/70">
                    {selectedRender.kind === "FINAL" ? "Final" : "Preview"} ·{" "}
                    {selectedRender.width}×{selectedRender.height}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
                <span>
                  {selectedRender
                    ? `${selectedRender.durationSeconds?.toFixed(1)}s · ${selectedRender.fps?.toFixed(0)}fps`
                    : "No render"}
                </span>
                <div className="flex items-center gap-2">
                  {validation?.passed ? (
                    <Badge variant="success">Validated</Badge>
                  ) : validation ? (
                    <Badge variant="danger">Validation failed</Badge>
                  ) : null}
                  {selectedRender ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-white"
                      onClick={() =>
                        window.open(`${selectedRender.videoAsset.url}?download=1`, "_blank")
                      }
                    >
                      <Download className="size-3.5" />
                      Download
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border border-white/10 bg-[#0d0e12] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/35">
                  Timeline
                </span>
                <span className="font-mono text-[10px] text-white/50">
                  {formatDuration(totalDuration)} / {formatDuration(project.durationSeconds)}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                <Track
                  label="Narration"
                  scenes={scenes}
                  color="bg-sky-500/30"
                  icon={<Volume2 className="size-3" />}
                />
                <Track
                  label="Subtitles"
                  scenes={scenes}
                  color="bg-amber-400/30"
                  icon={<Pause className="size-3" />}
                />
                <Track
                  label="Music"
                  scenes={scenes}
                  color={project.musicMood === "none" ? "bg-white/5" : "bg-violet-500/25"}
                  icon={<Music2 className="size-3" />}
                />
              </div>
            </div>

            {activeJob ? (
              <div className="border border-sky-500/20 bg-sky-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-sky-200">
                    <Loader2 className="size-3.5 animate-spin" />
                    {activeJob.currentStep?.replaceAll("_", " ").toLowerCase() ??
                      "starting"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-white/50 hover:text-white"
                    onClick={() => cancelJob.mutate({ jobId: activeJob.id })}
                  >
                    Cancel
                  </Button>
                </div>
                <Progress value={activeJob.progress} className="mt-2 h-1" />
                <div className="mt-1 text-[10px] text-white/35">
                  {activeJob.progress}% · {timeAgo(activeJob.createdAt)}
                </div>
              </div>
            ) : null}
            {data.jobs[0]?.status === "FAILED" ? (
              <div className="border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-300">
                {data.jobs[0].errorMessage ?? "The last job failed."}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={scenes.map((scene) => scene.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-2">
                  {scenes.map((scene) => (
                    <SortableSceneCard
                      key={scene.id}
                      scene={scene}
                      selected={scene.id === selectedSceneId}
                      onSelect={() => setSelectedSceneId(scene.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {selectedScene ? (
              <div className="border border-white/10 bg-[#0d0e12]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-white/50">
                      Scene {String(selectedScene.sceneNumber).padStart(2, "0")}
                    </span>
                    <StatusBadge status={selectedScene.status} />
                    <span className="text-[10px] text-white/35">
                      {selectedScene.durationSeconds.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                      disabled={Boolean(activeJob)}
                      onClick={() =>
                        regenerateVoice.mutate({
                          sceneId: selectedScene.id,
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      <RefreshCw className="size-3.5" />
                      Voice
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                      disabled={Boolean(activeJob)}
                      onClick={() =>
                        regenerateScene.mutate({
                          sceneId: selectedScene.id,
                          parts: ["visual"],
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      <ImageIcon className="size-3.5" />
                      Visual
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                      disabled={Boolean(activeJob)}
                      onClick={() =>
                        regenerateScene.mutate({
                          sceneId: selectedScene.id,
                          parts: ["all"],
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      <Sparkles className="size-3.5" />
                      Regenerate scene
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 p-4">
                  <div className="space-y-3">
                    <Field label="Narration">
                      <Textarea
                        value={narration}
                        onChange={(event) => setNarration(event.target.value)}
                        rows={5}
                        className="border-white/10 bg-white/[0.03] text-white"
                      />
                    </Field>
                    <Field label="Subtitle text">
                      <Textarea
                        value={subtitleText}
                        onChange={(event) => setSubtitleText(event.target.value)}
                        rows={3}
                        className="border-white/10 bg-white/[0.03] text-white"
                      />
                    </Field>
                    <Field label="Visual description">
                      <Textarea
                        value={visualDescription}
                        onChange={(event) => setVisualDescription(event.target.value)}
                        rows={3}
                        className="border-white/10 bg-white/[0.03] text-white"
                      />
                    </Field>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Duration (s)">
                        <Input
                          type="number"
                          min={1}
                          step="0.1"
                          value={duration}
                          onChange={(event) => setDuration(Number(event.target.value))}
                          className="border-white/10 bg-white/[0.03] text-white"
                        />
                      </Field>
                      <Field label="Transition">
                        <NativeSelect
                          value={transition}
                          onChange={setTransition}
                          options={TRANSITIONS}
                          className="border-white/10 bg-[#0d0e12] text-white"
                        />
                      </Field>
                      <Field label="Motion">
                        <NativeSelect
                          value={motion}
                          onChange={setMotion}
                          options={MOTIONS}
                          className="border-white/10 bg-[#0d0e12] text-white"
                        />
                      </Field>
                      <Field label="Visual type">
                        <NativeSelect
                          value={visualType}
                          onChange={setVisualType}
                          options={VISUAL_TYPES}
                          className="border-white/10 bg-[#0d0e12] text-white"
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={updateScene.isPending}
                        onClick={() =>
                          updateScene.mutate({
                            sceneId: selectedScene.id,
                            narration,
                            subtitleText,
                            durationSeconds: duration,
                            transition: transition as "cut" | "fade",
                            motion: (motion || undefined) as
                              | "zoom_in"
                              | "zoom_out"
                              | "pan_left"
                              | "pan_right"
                              | "static"
                              | undefined,
                            visualType: visualType as
                              | "IMAGE_ANIMATION"
                              | "STOCK_IMAGE"
                              | "STOCK_VIDEO"
                              | "PROCEDURAL"
                              | "AI_IMAGE"
                              | "AI_VIDEO",
                            visualDescription,
                          })
                        }
                      >
                        Save scene
                      </Button>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10">
                        {uploadingVisual ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        Replace visual
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/*,video/*"
                          className="sr-only"
                          disabled={uploadingVisual || Boolean(activeJob)}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void onVisualUpload(file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="aspect-[9/16] overflow-hidden border border-white/10 bg-black/40">
                        {selectedScene.visualAsset?.url ? (
                          <img
                            src={selectedScene.visualAsset.url}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-white/25">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col justify-center border border-white/10 bg-white/[0.02] p-2">
                        <div className="text-[10px] uppercase tracking-wider text-white/35">
                          Narration
                        </div>
                        {selectedScene.narrationAsset?.url ? (
                          <audio
                            controls
                            src={selectedScene.narrationAsset.url}
                            className="mt-2 w-full"
                          />
                        ) : (
                          <div className="mt-2 text-[11px] text-white/30">
                            No narration asset
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4">
              <div className="border border-white/10 bg-[#0d0e12] p-4">
                <div className="text-[10px] uppercase tracking-wider text-white/35">
                  Captions
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="Style">
                    <NativeSelect
                      value={captionStyle}
                      onChange={setCaptionStyle}
                      options={CAPTION_STYLES}
                      className="border-white/10 bg-[#0d0e12] text-white"
                    />
                  </Field>
                  <Field label="Position">
                    <NativeSelect
                      value={captionPosition}
                      onChange={setCaptionPosition}
                      options={CAPTION_POSITIONS}
                      className="border-white/10 bg-[#0d0e12] text-white"
                    />
                  </Field>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 border-white/15 bg-white/5 text-white hover:bg-white/10"
                  disabled={updateCaption.isPending}
                  onClick={() =>
                    updateCaption.mutate({
                      projectId,
                      style: captionStyle as "bold" | "clean" | "karaoke" | "minimal",
                      position: captionPosition as "bottom" | "center" | "top",
                    })
                  }
                >
                  Save caption style
                </Button>
                {data.subtitleAsset?.url ? (
                  <a
                    href={data.subtitleAsset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block text-[11px] text-amber-300 underline underline-offset-4"
                  >
                    Download SRT
                  </a>
                ) : null}
              </div>

              <div className="border border-white/10 bg-[#0d0e12] p-4">
                <div className="text-[10px] uppercase tracking-wider text-white/35">
                  Music
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="Mood">
                    <NativeSelect
                      value={musicMood}
                      onChange={setMusicMood}
                      options={MUSIC_MOODS}
                      className="border-white/10 bg-[#0d0e12] text-white"
                    />
                  </Field>
                  <Field label={`Volume (${Math.round(musicVolume * 100)}%)`}>
                    <input
                      type="range"
                      min="0"
                      max="0.6"
                      step="0.01"
                      value={musicVolume}
                      onChange={(event) => setMusicVolume(Number(event.target.value))}
                      className="mt-2 w-full accent-amber-400"
                    />
                  </Field>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 border-white/15 bg-white/5 text-white hover:bg-white/10"
                  disabled={updateMusic.isPending}
                  onClick={() =>
                    updateMusic.mutate({
                      projectId,
                      mood: musicMood as "ambient" | "cinematic" | "upbeat" | "lofi" | "none",
                      volume: musicVolume,
                    })
                  }
                >
                  Save music
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-white/10 bg-[#0d0e12] p-4">
              <div className="text-[10px] uppercase tracking-wider text-white/35">
                Project
              </div>
              <div className="mt-3 space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Total scene time</span>
                  <span className="font-mono">{totalDuration.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Target</span>
                  <span className="font-mono">{project.durationSeconds}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Narration style</span>
                  <span>{project.narrationStyle}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Visual style</span>
                  <span>{project.visualStyle}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Actual cost</span>
                  <span className="font-mono">
                    {formatInr(project.actualCostInrPaise)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/35">Estimated</span>
                  <span className="font-mono">
                    {formatInr(project.estimatedCostInrPaise)}
                  </span>
                </div>
              </div>
            </div>

            <div className="border border-white/10 bg-[#0d0e12] p-4">
              <div className="text-[10px] uppercase tracking-wider text-white/35">
                Validation
              </div>
              {validation ? (
                <div className="mt-2 text-[11px] leading-5">
                  {validation.passed ? (
                    <div className="flex items-center gap-1.5 text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                      Render passed duration, stream, codec, resolution, audio,
                      and black-frame checks.
                    </div>
                  ) : (
                    <div className="space-y-1 text-red-300">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="size-3.5" />
                        Validation failed
                      </div>
                      <ul className="space-y-1">
                        {(validation.issues ?? []).map((issue) => (
                          <li key={issue}>• {issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-white/35">
                  No validation data yet. Render a video to validate it.
                </div>
              )}
            </div>

            <div className="border border-white/10 bg-[#0d0e12] p-4">
              <div className="text-[10px] uppercase tracking-wider text-white/35">
                Recent jobs
              </div>
              <div className="mt-2 space-y-2">
                {data.jobs.slice(0, 5).map((job) => (
                  <div key={job.id} className="text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/60">
                        {job.kind.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/30">
                      {timeAgo(job.createdAt)} · {job.progress}%
                    </div>
                    <Progress value={job.progress} className="mt-1 h-1" />
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-white/10 bg-[#0d0e12] p-4 text-[10px] leading-5 text-white/35">
              <Music2 className="mb-1 size-3.5" />
              Saves update persisted project/scene data. Rendered video and
              captions are rebuilt only when you run a render or regenerate an
              asset. The final export uses the configured resolution.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
