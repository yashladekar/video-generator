"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Send,
  Settings,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@video-generator/ui/components/button";
import { Input } from "@video-generator/ui/components/input";
import { Textarea } from "@video-generator/ui/components/textarea";
import { Skeleton } from "@video-generator/ui/components/skeleton";

import {
  Badge,
  EmptyPanel,
  Field,
  NativeSelect,
  PageHeader,
  StatusBadge,
  Tabs,
} from "@/components/ui/primitives";
import { formatDate, timeAgo } from "@/lib/format";
import { trpc } from "@/utils/trpc";

const PLATFORMS = [
  { value: "YOUTUBE", label: "YouTube Shorts" },
  { value: "INSTAGRAM_REELS", label: "Instagram Reels (manual)" },
  { value: "TIKTOK", label: "TikTok (manual)" },
  { value: "MANUAL", label: "Manual export" },
];

const PRIVACY = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

type ReadyVideo = {
  id: string;
  projectId: string;
  status: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  project: { id: string; title: string };
  videoAsset: { url: string };
  thumbnailAsset: { url: string } | null;
  publishingJobs: Array<{ status: string }>;
};

type PublishingJobRow = {
  id: string;
  title: string;
  status: string;
  platform: string;
  privacyStatus: string;
  scheduledAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  externalUrl: string | null;
  project: { title: string };
  renderedVideo: {
    videoAsset: { url: string };
    thumbnailAsset: { url: string } | null;
  } | null;
};

function PublishingInner() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("publish");
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [platform, setPlatform] = useState("YOUTUBE");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("#reels #shorts");
  const [scheduledAt, setScheduledAt] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState("private");
  const [accountId, setAccountId] = useState("");

  const ready = useQuery(trpc.publishing.ready.queryOptions());
  const accounts = useQuery(trpc.publishing.accounts.list.queryOptions());
  const jobs = useQuery(trpc.publishing.jobs.list.queryOptions());
  const setup = useQuery(
    trpc.publishing.setup.queryOptions({
      platform: platform as "YOUTUBE",
    }),
  );
  const connectUrl = useQuery(
    trpc.publishing.accounts.connectUrl.queryOptions(
      { platform: "YOUTUBE" },
      { enabled: false },
    ),
  );

  const readyVideos = (ready.data ?? []) as unknown as ReadyVideo[];
  const publishingJobs = (jobs.data ?? []) as unknown as PublishingJobRow[];
  const projectFilter = searchParams.get("project");
  const youtubeResult = searchParams.get("youtube");

  useEffect(() => {
    if (youtubeResult === "connected") {
      toast.success("YouTube account connected");
      queryClient.invalidateQueries({ queryKey: trpc.publishing.accounts.list.queryKey() });
    } else if (youtubeResult === "error") {
      toast.error(searchParams.get("message") ?? "YouTube connection failed");
    }
  }, [queryClient, searchParams, youtubeResult]);

  useEffect(() => {
    if (readyVideos.length === 0) return;
    const preferred = projectFilter
      ? readyVideos.find((video) => video.projectId === projectFilter)
      : readyVideos[0];
    if (preferred && !selectedVideoId) {
      setSelectedVideoId(preferred.id);
      setTitle(preferred.project.title);
    }
  }, [projectFilter, readyVideos, selectedVideoId]);

  useEffect(() => {
    if (!accounts.data || accounts.data.length === 0) return;
    if (!accountId) setAccountId(accounts.data[0]?.id ?? "");
  }, [accountId, accounts.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.publishing.ready.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.publishing.jobs.list.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.publishing.accounts.list.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.dashboard.stats.queryKey() });
  };

  const createJob = useMutation(
    trpc.publishing.jobs.create.mutationOptions(),
  );
  const retryJob = useMutation(
    trpc.publishing.jobs.retry.mutationOptions(),
  );
  const cancelJob = useMutation(
    trpc.publishing.jobs.cancel.mutationOptions(),
  );
  const disconnect = useMutation(
    trpc.publishing.accounts.disconnect.mutationOptions(),
  );
  const testAccount = useMutation(
    trpc.publishing.accounts.test.mutationOptions(),
  );

  const selectedVideo = readyVideos.find((video) => video.id === selectedVideoId);
  const youtubeAccounts =
    accounts.data?.filter((account) => account.platform === "YOUTUBE") ?? [];
  const isManual = platform !== "YOUTUBE";
  const selectedSetup = setup.data;

  async function submit() {
    if (!selectedVideoId) {
      toast.error("Select a final render");
      return;
    }
    const tags = hashtags
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 30);
    try {
      const result = await createJob.mutateAsync({
        renderedVideoId: selectedVideoId,
        platform: platform as "YOUTUBE",
        title: title.trim() || selectedVideo?.project.title || "Untitled reel",
        caption: caption.trim(),
        hashtags: tags,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        privacyStatus: privacyStatus as "private" | "unlisted" | "public",
        publishingAccountId: accountId || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result?.job?.status === "EXPORTED") {
        toast.success(
          "Manual export recorded — download the MP4 and upload it yourself",
        );
        if (result.downloadUrl) window.open(result.downloadUrl, "_blank");
      } else {
        toast.success("Publishing job scheduled");
      }
      invalidate();
      setTab("history");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create publishing job",
      );
    }
  }

  async function retryPublishing(id: string) {
    try {
      await retryJob.mutateAsync({ publishingJobId: id });
      toast.success("Publishing retry queued");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    }
  }

  async function cancelPublishing(id: string) {
    try {
      await cancelJob.mutateAsync({ publishingJobId: id });
      toast.success("Publishing job cancelled");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancel failed");
    }
  }

  async function testPublishingAccount(id: string) {
    try {
      const result = await testAccount.mutateAsync({ accountId: id });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
    }
  }

  async function disconnectAccount(id: string) {
    try {
      await disconnect.mutateAsync({ accountId: id });
      toast.success("Account disconnected");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect");
    }
  }

  async function connectYouTube() {
    try {
      const result = await connectUrl.refetch();
      if (result.data?.url) {
        window.location.href = result.data.url;
      } else {
        toast.error("YouTube OAuth is not configured on the server");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "YouTube OAuth is not configured on the server",
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribution"
        title="Publishing center"
        description="Publish through the official YouTube API when authorized, or export manually for Instagram and TikTok. Manual exports are never marked as published."
        actions={
          <Button nativeButton={false} variant="outline" render={<Link href="/projects" />}>
            Open projects
          </Button>
        }
      />

      {youtubeResult === "error" ? (
        <div className="border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
          {searchParams.get("message") ?? "YouTube connection failed."}
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "publish", label: "Publish" },
          {
            value: "history",
            label: "History",
            badge: publishingJobs.length ? (
              <Badge variant="outline">{publishingJobs.length}</Badge>
            ) : null,
          },
          { value: "accounts", label: "Accounts & setup" },
        ]}
      />

      {tab === "publish" ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="border border-border bg-card p-5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ready to publish
              </div>
              {ready.isLoading ? (
                <Skeleton className="mt-3 h-40 w-full" />
              ) : readyVideos.length === 0 ? (
                <EmptyPanel
                  icon={<Film className="size-6" />}
                  title="No final renders yet"
                  description="Render a final video in Studio, then return here to publish or export."
                  action={
                    <Button nativeButton={false} render={<Link href="/projects" />}>
                      Open projects
                    </Button>
                  }
                />
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {readyVideos.map((video) => (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => {
                        setSelectedVideoId(video.id);
                        setTitle(video.project.title);
                      }}
                      className={`flex gap-3 border p-2 text-left transition-colors ${
                        selectedVideoId === video.id
                          ? "border-foreground bg-muted/40"
                          : "border-border hover:bg-muted/20"
                      }`}
                    >
                      <div className="aspect-[9/16] w-14 shrink-0 overflow-hidden bg-muted">
                        {video.thumbnailAsset?.url ? (
                          <img
                            src={video.thumbnailAsset.url}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <Film className="size-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {video.project.title}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {video.durationSeconds?.toFixed(1)}s ·{" "}
                          {video.width}×{video.height}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <StatusBadge status={video.status} />
                          {video.publishingJobs[0] ? (
                            <StatusBadge status={video.publishingJobs[0].status} />
                          ) : (
                            <Badge variant="outline">Not published</Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedVideo ? (
              <div className="border border-border bg-card p-5">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Publishing details
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Platform">
                    <NativeSelect
                      value={platform}
                      onChange={setPlatform}
                      options={PLATFORMS}
                    />
                  </Field>
                  <Field label="YouTube account">
                    <NativeSelect
                      value={accountId}
                      onChange={setAccountId}
                      disabled={!youtubeAccounts.length || isManual}
                      options={
                        youtubeAccounts.length
                          ? youtubeAccounts.map((account) => ({
                              value: account.id,
                              label: account.accountName ?? account.externalAccountId,
                            }))
                          : [{ value: "", label: "No YouTube account connected" }]
                      }
                    />
                  </Field>
                  <Field label="Title" className="sm:col-span-2">
                    <Input
                      value={title}
                      maxLength={100}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </Field>
                  <Field label="Caption / description" className="sm:col-span-2">
                    <Textarea
                      value={caption}
                      rows={4}
                      onChange={(event) => setCaption(event.target.value)}
                      placeholder="Describe the reel, add credits, and include any required disclosures."
                    />
                  </Field>
                  <Field label="Hashtags" hint="Space or comma separated">
                    <Input
                      value={hashtags}
                      onChange={(event) => setHashtags(event.target.value)}
                    />
                  </Field>
                  <Field label="Schedule (optional)">
                    <Input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                    />
                  </Field>
                  <Field label="YouTube privacy">
                    <NativeSelect
                      value={privacyStatus}
                      onChange={setPrivacyStatus}
                      options={PRIVACY}
                      disabled={isManual}
                    />
                  </Field>
                  <Field label="Download">
                    <Button
                      variant="outline"
                      className="w-full gap-1.5"
                      onClick={() =>
                        window.open(`${selectedVideo.videoAsset.url}?download=1`, "_blank")
                      }
                    >
                      <Download className="size-4" />
                      Download MP4
                    </Button>
                  </Field>
                </div>

                {isManual ? (
                  <div className="mt-4 border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                    Manual export records an EXPORTED job and opens the MP4 for
                    download. It does not call a platform API and is never shown
                    as published. See the setup tab for the exact requirements.
                  </div>
                ) : null}
                {!isManual && youtubeAccounts.length === 0 ? (
                  <div className="mt-4 border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                    Connect a YouTube account first. The app uses the official
                    Data API resumable upload endpoint and marks the video as
                    containing synthetic media.
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    className="gap-1.5"
                    disabled={
                      createJob.isPending ||
                      (isManual ? false : youtubeAccounts.length === 0)
                    }
                    onClick={submit}
                  >
                    {createJob.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {isManual ? "Record manual export" : "Schedule / publish"}
                  </Button>
                  {!isManual && youtubeAccounts.length === 0 ? (
                    <Button variant="outline" className="gap-1.5" onClick={connectYouTube}>
                      <Video className="size-4" />
                      Connect YouTube
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {selectedSetup?.platform ?? platform} setup
                </div>
                <Badge variant={selectedSetup?.supported ? "success" : "warning"}>
                  {selectedSetup?.supported ? "Official API" : "Manual only"}
                </Badge>
              </div>
              <ol className="mt-3 space-y-1.5 text-[11px] leading-5 text-muted-foreground">
                {(selectedSetup?.steps ?? []).map((step, index) => (
                  <li key={step}>
                    {index + 1}. {step}
                  </li>
                ))}
              </ol>
              {selectedSetup?.notes ? (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {selectedSetup.notes}
                </p>
              ) : null}
              {selectedSetup?.docs ? (
                <a
                  href={selectedSetup.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground underline underline-offset-4"
                >
                  Official docs <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>

            <div className="border border-border bg-muted/20 p-4 text-[11px] leading-5 text-muted-foreground">
              <AlertTriangle className="mb-1 size-4" />
              YouTube uploads are quota-limited and require an OAuth app with the
              <span className="font-mono"> youtube.upload </span>
              scope. Scheduled uploads are sent as private with a publishAt time.
              Instagram and TikTok direct posting require approved developer apps
              and are intentionally manual in this build.
            </div>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="border border-border bg-card">
          <div className="border-b border-border p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Publishing history
          </div>
          {jobs.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : publishingJobs.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No publishing jobs yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {publishingJobs.map((job) => (
                <div key={job.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="aspect-[9/16] w-12 overflow-hidden bg-muted">
                    {job.renderedVideo?.thumbnailAsset?.url ? (
                      <img
                        src={job.renderedVideo.thumbnailAsset.url}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{job.title}</span>
                      <StatusBadge status={job.status} />
                      <Badge variant="outline">
                        {job.platform.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {job.project.title} · {timeAgo(job.createdAt)}
                      {job.scheduledAt ? ` · scheduled ${formatDate(job.scheduledAt)}` : ""}
                      {job.privacyStatus ? ` · ${job.privacyStatus}` : ""}
                    </div>
                    {job.errorMessage ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-red-500">
                        {job.errorMessage}
                      </p>
                    ) : null}
                    {job.status === "EXPORTED" ? (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Exported for manual publishing. This is not a platform publish.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.externalUrl ? (
                      <a href={job.externalUrl} target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <ExternalLink className="size-3.5" />
                          Open post
                        </Button>
                      </a>
                    ) : null}
                    {job.renderedVideo?.videoAsset?.url ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() =>
                          window.open(
                            `${job.renderedVideo?.videoAsset.url}?download=1`,
                            "_blank",
                          )
                        }
                      >
                        <Download className="size-3.5" />
                        MP4
                      </Button>
                    ) : null}
                    {job.status === "FAILED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retryJob.isPending}
                        onClick={() => void retryPublishing(job.id)}
                      >
                        Retry
                      </Button>
                    ) : null}
                    {["SCHEDULED", "DRAFT"].includes(job.status) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancelJob.isPending}
                        onClick={() => void cancelPublishing(job.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "accounts" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Connected accounts
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={connectYouTube}>
                <Video className="size-3.5" />
                Connect YouTube
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {!accounts.data || accounts.data.length === 0 ? (
                <div className="border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  No accounts connected. YouTube direct publishing requires an
                  OAuth app and a connected channel.
                </div>
              ) : (
                accounts.data.map((account) => (
                  <div
                    key={account.id}
                    className="flex flex-wrap items-center gap-2 border border-border p-3"
                  >
                    <Video className="size-4" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {account.accountName ?? account.externalAccountId}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {account.platform} · {account.status} ·{" "}
                        {account.tokenExpiresAt
                          ? `token expires ${formatDate(account.tokenExpiresAt)}`
                          : "refresh token stored"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testAccount.isPending}
                      onClick={() => void testPublishingAccount(account.id)}
                    >
                      Test
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={disconnect.isPending}
                      onClick={() => void disconnectAccount(account.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border border-border bg-card p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Platform setup requirements
            </div>
            <div className="mt-3 space-y-3">
              {["YOUTUBE", "INSTAGRAM_REELS", "TIKTOK"].map((item) => (
                <div key={item} className="border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {item.replaceAll("_", " ")}
                    </span>
                    <Badge variant={item === "YOUTUBE" ? "success" : "warning"}>
                      {item === "YOUTUBE" ? "Wired" : "Manual"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    {item === "YOUTUBE"
                      ? "Official resumable upload. Requires Google Cloud OAuth credentials and the youtube.upload scope."
                      : "Direct publishing requires an approved developer app. Use Download MP4 and publish in the app."}
                  </p>
                </div>
              ))}
            </div>
            <Link
              href="/settings?tab=publishing"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-foreground underline underline-offset-4"
            >
              <Settings className="size-3.5" />
              Open publishing settings
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PublishingPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <PublishingInner />
    </Suspense>
  );
}
