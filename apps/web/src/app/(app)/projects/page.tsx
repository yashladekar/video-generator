"use client";

import { useDeferredValue, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Copy,
  Download,
  Film,
  FolderKanban,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@video-generator/ui/components/button";
import { Input } from "@video-generator/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@video-generator/ui/components/dropdown-menu";
import { Skeleton } from "@video-generator/ui/components/skeleton";
import { cn } from "@video-generator/ui/lib/utils";

import {
  Badge,
  EmptyPanel,
  Modal,
  NativeSelect,
  PageHeader,
  StatusBadge,
} from "@/components/ui/primitives";
import { formatDate, formatDuration, formatInr } from "@/lib/format";
import { trpc } from "@/utils/trpc";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "CONFIGURED", label: "Configured" },
  { value: "QUEUED", label: "Queued" },
  { value: "GENERATING", label: "Generating" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "ARCHIVED", label: "Archived" },
];

const PLATFORM_OPTIONS = [
  { value: "ALL", label: "All platforms" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "INSTAGRAM_REELS", label: "Instagram Reels" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "MANUAL", label: "Manual" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "duration", label: "Longest first" },
  { value: "cost", label: "Highest actual cost" },
];

type ProjectCard = {
  id: string;
  title: string;
  topic: string;
  status: string;
  durationSeconds: number;
  resolution: string;
  platform: string;
  actualCostInrPaise: number;
  estimatedCostInrPaise: number;
  createdAt: string;
  thumbnailAsset: { url: string } | null;
  renderedVideos: Array<{
    videoAsset: { url: string };
    thumbnailAsset: { url: string } | null;
  }>;
  publishingJobs: Array<{ status: string }>;
};

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("ALL");
  const [platform, setPlatform] = useState("ALL");
  const [sort, setSort] = useState("newest");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, status, platform, sort, includeArchived]);

  const list = useQuery(
    trpc.projects.list.queryOptions({
      page,
      pageSize: 12,
      search: deferredSearch || undefined,
      status: status as "ALL",
      platform: platform as "ALL",
      sort: sort as "newest",
      includeArchived,
      includeDeleted: false,
    }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });

  const duplicate = useMutation(
    trpc.projects.duplicate.mutationOptions(),
  );
  const archive = useMutation(
    trpc.projects.archive.mutationOptions(),
  );
  const rename = useMutation(
    trpc.projects.rename.mutationOptions(),
  );
  const remove = useMutation(
    trpc.projects.delete.mutationOptions(),
  );

  async function duplicateProject(projectId: string) {
    try {
      await duplicate.mutateAsync({ projectId });
      toast.success("Project duplicated");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duplicate failed");
    }
  }

  async function archiveProject(projectId: string) {
    try {
      await archive.mutateAsync({ projectId });
      toast.success("Project archived");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Archive failed");
    }
  }

  async function saveRename() {
    if (!renameTarget) return;
    try {
      await rename.mutateAsync({
        projectId: renameTarget.id,
        title: renameValue.trim(),
      });
      toast.success("Project renamed");
      setRenameTarget(null);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rename failed");
    }
  }

  async function deleteProject() {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync({ projectId: deleteTarget.id });
      toast.success("Project moved to trash");
      setDeleteTarget(null);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }

  const projects = (list.data?.items ?? []) as unknown as ProjectCard[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Projects"
        description="Search, filter, open, duplicate, rename, archive, download, or delete your saved reels."
        actions={
          <Button nativeButton={false} className="gap-1.5" render={<Link href="/create" />}>
            <Plus className="size-4" />
            Create New Reel
          </Button>
        }
      />

      <div className="flex flex-col gap-3 border border-border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles and topics…"
            className="pl-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <NativeSelect
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            className="w-full lg:w-40"
          />
          <NativeSelect
            value={platform}
            onChange={setPlatform}
            options={PLATFORM_OPTIONS}
            className="w-full lg:w-44"
          />
          <NativeSelect
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            className="w-full lg:w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={includeArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setIncludeArchived((value) => !value)}
          >
            <Archive className="size-3.5" />
            Archived
          </Button>
          <div className="flex border border-border">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setView("grid")}
            >
              <Grid2X2 className="size-3.5" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => setView("list")}
            >
              <List className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-52 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyPanel
          title="Could not load projects"
          description={list.error.message}
          action={<Button onClick={() => list.refetch()}>Retry</Button>}
        />
      ) : projects.length === 0 ? (
        <EmptyPanel
          icon={<FolderKanban className="size-6" />}
          title="No projects match this view"
          description="Create a project or clear the filters. The default local pipeline is free."
          action={
            <Button nativeButton={false} className="gap-1.5" render={<Link href="/create" />}>
              <Plus className="size-4" />
              Create New Reel
            </Button>
          }
        />
      ) : (
        <>
          <div
            className={cn(
              view === "grid"
                ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                : "flex flex-col gap-2",
            )}
          >
            {projects.map((project) => {
              const final = project.renderedVideos[0];
              const thumbnail =
                project.thumbnailAsset?.url ?? final?.thumbnailAsset?.url ?? null;
              const publishStatus = project.publishingJobs[0]?.status;
              return (
                <div
                  key={project.id}
                  className={cn(
                    "group border border-border bg-card transition-colors hover:bg-muted/20",
                    view === "list" ? "flex items-center gap-4 p-3" : "p-3",
                  )}
                >
                  <Link
                    href={`/projects/${project.id}`}
                    className={cn(
                      "relative shrink-0 overflow-hidden bg-muted",
                      view === "list"
                        ? "aspect-[9/16] w-16"
                        : "mb-3 block aspect-[16/9] w-full",
                    )}
                  >
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt=""
                        className={cn(
                          "size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
                          view === "grid" && "object-top",
                        )}
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-muted/30">
                        <Film className="size-6 text-muted-foreground" />
                      </div>
                    )}
                    {view === "grid" ? (
                      <div className="absolute left-2 top-2">
                        <StatusBadge status={project.status} />
                      </div>
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="min-w-0 flex-1"
                      >
                        <div className="truncate text-sm font-medium">
                          {project.title}
                        </div>
                        <div className="line-clamp-2 text-[11px] text-muted-foreground">
                          {project.topic}
                        </div>
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card">
                          <DropdownMenuItem
                            onClick={() => window.location.assign(`/projects/${project.id}`)}
                          >
                            Open project
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => window.location.assign(`/studio/${project.id}`)}
                          >
                            Open Studio
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!final}
                            onClick={() => {
                              if (final) {
                                window.open(`${final.videoAsset.url}?download=1`, "_blank");
                              }
                            }}
                          >
                            <Download className="size-3.5" />
                            Download final
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => void duplicateProject(project.id)}
                          >
                            <Copy className="size-3.5" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget({ id: project.id, title: project.title });
                              setRenameValue(project.title);
                            }}
                          >
                            <Pencil className="size-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void archiveProject(project.id)}
                          >
                            <Archive className="size-3.5" />
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              setDeleteTarget({ id: project.id, title: project.title })
                            }
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{formatDuration(project.durationSeconds)}</span>
                      <span>{project.resolution}</span>
                      <span>{project.platform.replaceAll("_", " ")}</span>
                      <span>
                        {formatInr(project.actualCostInrPaise)} actual /{" "}
                        {formatInr(project.estimatedCostInrPaise)} est.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {view === "list" ? <StatusBadge status={project.status} /> : null}
                      {publishStatus ? (
                        <Badge variant="outline">Publish: {publishStatus.toLowerCase()}</Badge>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(project.createdAt)}
                      </span>
                    </div>
                  </div>
                  {view === "list" ? (
                    <Button nativeButton={false}
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      render={<Link href={`/studio/${project.id}`} />}
                    >
                      Studio <ArrowRight className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {list.data && list.data.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
              <span>
                Page {list.data.page} of {list.data.totalPages} ·{" "}
                {list.data.total} project{list.data.total === 1 ? "" : "s"}
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
                  disabled={page >= list.data.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename project"
        footer={
          <>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={rename.isPending || renameValue.trim().length < 2}
              onClick={() => void saveRename()}
            >
              Save name
            </Button>
          </>
        }
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder="Project title"
        />
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete project?"
        description="This is a soft delete. The project is removed from the library, and its media can be purged later."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void deleteProject()}
            >
              Delete project
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {deleteTarget?.title}
        </p>
      </Modal>
    </div>
  );
}
