# ReelForge — AI Faceless Reels

A local-first, cost-aware creator workspace that turns a topic into a validated vertical short video: script → scenes → narration → visuals → captions → music → FFmpeg render → review → publish or export.

The repo started as a Better-T-Stack scaffold (Next.js + Express + tRPC + Prisma/Postgres + Better Auth + Turborepo) and has been extended into a complete application with background jobs, real media processing, hosted/local AI adapters, budget accounting, and a Video Studio.

## What is implemented

- **Auth and per-user isolation** with Better Auth email/password sessions. Every project, scene, asset, job, provider configuration, budget, and publishing record is scoped to the signed-in user.
- **Persistent projects** with brief, configuration, scripts, scenes, assets, generation jobs, usage records, renders, and publishing history.
- **Real background generation** through BullMQ + Redis. API requests create jobs and return immediately; a worker runs the pipeline.
- **Checkpointed pipeline**: validate → research → script → scenes → narration → visuals → optional AI video → subtitles → music → FFmpeg render → ffprobe validation → finalize. Retries resume from the last successful step, and a paid stage that already succeeded is always served from its stored attempt instead of being charged twice.
- **Structured script generation** validated with Zod, including duration-sum tolerance, word-per-second narration limits, distinct visual descriptions, and repair retries.
- **Narration alignment**: scene timings are adjusted to measured TTS duration; narration is never trimmed. A speed-up pass is used when needed. Voiceover stems are content-hashed, so unchanged text/voice/provider/tempo is never synthesized twice.
- **Real FFmpeg rendering** with per-scene motion, normalized narration, caption overlays, procedural music, final concat, and validation of duration, streams, codecs, resolution, fps, volume, and black frames. Encoding is profile-driven: studio iterations render as 480p drafts and only user exports encode at full resolution.
- **Hybrid visuals**: original procedural motion graphics/sharable stills by default; Pexels stock (when a free key exists); optional fal.ai, WaveSpeedAI, and ComfyUI adapters. Scene sources are planned cheapest-first, and hosted AI video uses an image-to-video workflow (one cheap keyframe animated per clip) rather than native text-to-video. Hosted AI video is limited to selected scenes.
- **Provider settings UI** with encrypted secrets (AES-256-GCM), masked credentials, connection tests, capability detection, and a model pricing catalog.
- **Budget accounting** with a default ₹2000/month, a per-video cap, retry reserve, daily limit, local-only mode, live/configured provider quotes, estimate vs actual records, and a per-video hard stop. No hard provider-side spending guarantee is claimed.
- **Video Studio**: vertical preview, draggable scene timeline, narration/subtitle/music tracks, per-scene editing, visual replacement, voiceover/scene regeneration, preview/final renders, approval, download.
- **Publishing Center**: official YouTube OAuth + resumable upload (when credentials are configured), scheduled jobs, retries, status history, and manual export for Instagram Reels/TikTok. Manual exports are recorded as `EXPORTED`, never `PUBLISHED`.
- **Google/Anthropic-style provider safety**: unknown billable outcomes are not retried blindly; provider request ids and reconciliation are persisted for fal/WaveSpeed, and every paid call is written to a request ledger keyed by the request payload so a crashed retry cannot silently pay twice.
- **Tests**: 107 Vitest tests covering script/scene schema validation, duration normalization, money/budget math and rejection thresholds, checkpoint/resume planning, per-video cost guards, model tier selection, visual tier ordering, narration cache keys, render profiles, provider HTTP classification, fal/WaveSpeed/Pexels adapter flows, YouTube OAuth token and resumable-upload behavior, retention cleanup, media validation, auth guards, and publishing policy.

Verified locally: the pipeline produced real **45.04s, 1080×1920, 30fps H.264/AAC** MP4s with `passed: true` validation and ₹0 actual cost using local providers. The Docker stack was smoke-tested end to end: migrations, healthy API/worker/web, a container-rendered clip, and signed media streaming.

The two render profiles were re-verified against FFmpeg from identical inputs: the draft profile produced **480×854 H.264/AAC** and the production profile produced **1080×1920 H.264/AAC**, both 8.0s with captions, motion, and a mixed music bed. The Dockerfile targets, Prisma migration, and compose changes were validated by `docker compose config`, `tsc`, and the test suite; the container images themselves have not been rebuilt in this environment.

## Stack

- Next.js App Router + TypeScript + Tailwind v4 + Base UI/shadcn primitives
- React Query + Zustand + dnd-kit
- Express 5 + tRPC 11
- PostgreSQL 16 + Prisma 7 (`@prisma/adapter-pg`)
- Redis 7 + BullMQ worker
- FFmpeg / ffprobe; Sharp; text-to-svg with bundled Inter
- Better Auth
- Vitest
- Docker Compose for Postgres, Redis, server, worker, and web

## Quick start (local development, containerized services)

Prerequisites:

- Node.js 24+ (this checkout was verified on Node 26)
- pnpm 12.11.2
- Docker Desktop (for Postgres and Redis)
- macOS `say` is used automatically when available; otherwise install `espeak-ng`/Piper or configure a hosted TTS provider.

```bash
pnpm install
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open:

- Web: http://localhost:3001
- API: http://localhost:3000

`pnpm dev` runs Turbo, which starts the Next.js app and, in `apps/server`, both the Express API and the BullMQ worker via `concurrently`.

The compose services intentionally use:

- Postgres on host port **5433** (to avoid the existing local Postgres on 5432)
- Redis on host port **6380**

The local `apps/server/.env` is configured for those ports. Copy `apps/server/.env.example` if you need to recreate it.

### Generate the Prisma client

```bash
pnpm db:generate
```

Run this after changing the Prisma schema.

### Seed

```bash
pnpm db:seed
```

Seeds zero-cost local provider pricing entries. The optional sample project is only created when `SEED_DEMO=true` and a user already exists; it is clearly marked `isSample: true` and contains no fabricated media or render results.

## Environment

Server variables are defined in `apps/server/.env.schema` and validated by Varlock. The generated `src/env.ts` is committed; secret values live in `apps/server/.env` (gitignored).

Required server variables:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | development / production / test |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (32+ chars) |
| `BETTER_AUTH_URL` | Public API URL used by Better Auth |
| `CORS_ORIGIN` | Web origin allowed to call the API |
| `DATABASE_URL` | Postgres connection string |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for provider secrets and OAuth tokens |
| `MEDIA_SIGNING_SECRET` | HMAC key for signed media URLs |
| `REDIS_URL` | BullMQ/Redis connection string |
| `MEDIA_ROOT` | Local media directory (`./storage` in dev, `/data/media` in Docker) |
| `PUBLIC_API_URL` | Public API base used to build signed media URLs |

Optional provider variables (server-only): `FFMPEG_PATH`, `FFPROBE_PATH`, `OLLAMA_BASE_URL`, `COMFYUI_BASE_URL`, `PIPER_BIN`, `PIPER_MODEL`, `PEXELS_API_KEY`, `FAL_KEY`, `WAVESPEED_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ELEVENLABS_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `S3_*`, `MEDIA_RETENTION_DAYS`, `MEDIA_INTERMEDIATE_RETENTION_HOURS`, `MAX_UPLOAD_MB`, `WORKER_CONCURRENCY`, `USD_TO_INR_RATE`.

`FFMPEG_PATH`/`FFPROBE_PATH` only matter for the worker in the split deployment; the API falls back to the bundled static `ffprobe` for upload validation.

Provider keys can also be entered in **Settings → Providers**; they are encrypted before storage and never returned to the browser. Environment variables act as server-side fallbacks.

## Generation pipeline

The worker runs these stages and persists the result of each one:

1. **Validate** the brief, settings, provider availability, and budget.
2. **Research** (optional) through Wikipedia; configurable Tavily adapter is available when a key is set.
3. **Script** with a structured JSON schema. Providers: `ollama`, `openai-compatible`, or a deterministic `template` fallback. Invalid output is repaired up to two times.
4. **Scenes** with timing validation and visual-type selection.
5. **Narration** per scene with a content-hash cache lookup first, duration measurement, and timing alignment. A stem is reused whenever the text, voice, language, tempo, provider, and format are unchanged, so a retry or a re-render never re-pays for TTS.
6. **Visuals** per scene. Sources are planned cheapest-first: free stock (Pexels) → zero-cost procedural → the cheap hosted keyframe tier. A scene the user pinned to a provider keeps that provider only if they chose it explicitly.
7. **AI video** for up to `maxHostedVideoCalls` high-impact scenes, using a hybrid workflow: one cheap keyframe is generated (or reused from the scene's existing image) and persisted as the scene visual *first*, then a turbo image-to-video model animates it. Only providers that declare image-to-video support are eligible, so this can never silently fall back to an expensive native text-to-video endpoint. If the clip is blocked by the per-video limit or fails, the scene keeps its keyframe instead of losing its visual.
8. **Subtitles** with SRT + styled transparent caption PNGs.
9. **Music** generated procedurally (ambient/cinematic/upbeat/lofi) and mixed under narration.
10. **Render** per-scene clips → concat → music mix → H.264/AAC MP4 → thumbnail, using the draft or production profile.
11. **Validate** duration, 9:16 resolution, video/audio streams, codecs, fps, audio levels, black frames, and file size.
12. **Finalize** the job, project, usage, budget, notification, and rendered-video record.

Retries create a new attempt for the failed step onward. For paid step types (`RESEARCH`, `SCRIPT`, `NARRATION`, `VISUALS`, `AI_VIDEO`) the runner looks for an earlier attempt that already produced an artifact and marks the new attempt `SKIPPED` with that same output, so a retry after a render failure cannot re-call a provider. Unknown paid-provider outcomes are recorded and are not automatically resubmitted.

## Cost controls

The design target is **30+ videos per month inside ₹2000**, with a ₹70 (~$0.80) ceiling per video and a realistic ₹13–22 ($0.15–$0.25) average.

| Control | Where | What it does |
| --- | --- | --- |
| Model cost tiers | `packages/api/src/providers/visual/model-tiers.ts` | Named tiers for keyframe, image-to-video, and text-to-video models with a per-unit estimate. Defaults always pick the cheapest tier; premium endpoints must be chosen deliberately. |
| Visual tier planning | `packages/api/src/providers/visual/tiers.ts` | Orders scene sources cheapest-first and drops every paid tier in local-only mode. Exports `paidTiers`/`planRequiresPaidSpend` so callers can see whether a plan spends money at all. |
| Hybrid image-to-video | `packages/api/src/providers/visual/index.ts` | Generates one cheap keyframe and animates it with a turbo image-to-video model instead of paying for native text-to-video. The keyframe doubles as the scene's fallback still. |
| Projected cost headroom | `packages/api/src/pipeline/provider-usage.ts` | `assertVideoCostHeadroom` blocks a paid clip when the running job cost plus the estimate would cross the per-video limit, and logs a warning once the job passes 80% of it. |
| Post-charge enforcement | `packages/api/src/pipeline/provider-usage.ts` | `enforcePerVideoLimit` runs after every recorded charge: a warning log at 80%, and a `PER_VIDEO_COST_LIMIT` stop when the job crosses the cap. |
| Request ledger | `packages/api/src/pipeline/provider-usage.ts` | `trackedPaidCall` persists each paid request under a payload-derived idempotency key. A duplicate request is refused instead of silently charged again. |
| Content-hash narration cache | `packages/api/src/providers/tts/cache.ts` | One canonical key per (text, voice, language, speed, provider, model, format), with a legacy-key fallback so upgrading the cache layout never forces a re-synthesis. |
| Draft vs production profiles | `packages/api/src/pipeline/render-profiles.ts` | `PREVIEW` renders at 480×854 / ultrafast / CRF 30 / 96k audio; only `FINAL` renders at 1080×1920 (or 720p) / veryfast / CRF 20 / 192k. |
| Checkpoint resume plan | `packages/api/src/pipeline/checkpoint.ts` | `planJobResume` reports reusable, recovered, pending, and interrupted paid steps; `renderOnlyViolations` proves a render-only retry touches no provider step. |
| 48h intermediate purge | `packages/api/src/services/retention.ts` | Deletes draft renders, unreferenced project intermediates, and expired working assets after `MEDIA_INTERMEDIATE_RETENTION_HOURS` while keeping final videos and project configuration. |

Provider prices are still resolved from a live quote when available, then the `ProviderPricing` catalog, then blocked with `PRICING_NOT_CONFIGURED`. Tier estimates are used only for planning and projections — they are never written as the recorded cost, so usage records stay truthful.

## Default local pipeline (₹0)

- Script: Ollama if reachable with an installed model → hosted if configured → deterministic template.
- TTS: macOS `say` → eSpeak NG → Piper (if configured) → hosted fallback.
- Visuals: procedural motion graphics; Pexels if a free key exists.
- Music: procedural synth.
- Storage: local filesystem with signed URLs.
- Rendering: FFmpeg.

The app detects local services and shows actionable setup instructions. Ollama is installed on this machine but no models were present; the template fallback keeps the pipeline runnable. Pull a model for AI scripts:

```bash
ollama pull llama3.2:3b
```

## Budget model

- Default monthly budget: **₹2000**; default per-video max: **₹70** (~$0.80); retry reserve: 15%; daily limit: 2 (configurable). Existing rows that were still on the old ₹500/₹50 scaffolded defaults are migrated to the new envelope; anything tuned by hand is left alone.
- Estimates use live fal/WaveSpeed price quotes when a key exists; otherwise the `ProviderPricing` catalog; otherwise the call is blocked with `PRICING_NOT_CONFIGURED`.
- Estimates and actual recorded usage are stored separately. Costs are integer paise and micro-USD with the FX rate/tax/fee used recorded on each usage row.
- Local-only mode blocks paid providers while allowing free/local options.
- **Per-video enforcement is a hard stop inside the pipeline**, not just an advisory estimate. Before a paid clip the projected running total is checked against the per-video cap; after every recorded charge the running total is re-checked and the job fails with `PER_VIDEO_COST_LIMIT` if it crossed the cap. Crossing 80% logs a structured warning with the job id, provider, and amounts.
- The budget is enforced by this application's accounting. It is **not** a provider-side hard cap. Configure provider-side spending limits as a second layer.

### Working the arithmetic

At the ₹70 ceiling and a ₹2000 month, one video cannot break the budget: even a fully hosted video (script + hosted TTS + 2 keyframes + 2 five-second turbo clips) is projected by the estimator before it starts, and the clip count is capped by `maxHostedVideoCalls`. The default local path (template/ollama script, macOS `say`/eSpeak, procedural visuals, procedural music, FFmpeg) costs ₹0, so the paid tiers are a deliberate per-project upgrade rather than a default. Set `preferredVideoProvider` and `maxHostedVideoCalls` on the projects where motion actually earns retention.

## Publishing

### YouTube (official)

The adapter uses OAuth 2.0 and the YouTube Data API v3 resumable upload endpoint. Setup:

1. Create a Google Cloud project.
2. Enable YouTube Data API v3.
3. Configure the OAuth consent screen and add `https://www.googleapis.com/auth/youtube.upload`.
4. Create an OAuth 2.0 Web application client.
5. Add `YOUTUBE_REDIRECT_URI` as an authorized redirect URI.
6. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI`.
7. Add your Google account as a test user while the app is in testing mode.
8. Connect the account from **Settings → Publishing**.
9. Check the current YouTube upload quota.

The upload sets `status.containsSyntheticMedia=true` for AI-generated content. Scheduled uploads are sent as private with `publishAt`. The default privacy is private. A job is only marked `PUBLISHED` when the API returns a video id; a real video link is shown in history.

### Instagram Reels and TikTok

Direct publishing requires approved developer apps/account permissions. This build intentionally uses **manual export**:

- Download the MP4/SRT.
- Upload in the platform app.
- The publishing job is recorded as `EXPORTED`, not `PUBLISHED`.

The exact setup requirements for official APIs are shown in Publishing → Accounts & setup.

## Video Studio

- Vertical preview of final or preview renders.
- Scene timeline with thumbnails, drag-to-reorder, duration and status.
- Narration/subtitle/music tracks.
- Per-scene editor: narration, subtitle text, duration, transition, motion, visual type, visual description.
- Replace visual via upload.
- Regenerate voiceover, visual, or the whole scene without rebuilding unrelated assets.
- Caption style/position and music mood/volume.
- Preview render, final export, approve, download, publish link.
- Validation results, recent jobs, and actual/estimated cost.

## Testing

```bash
pnpm test          # Vitest, currently 107 tests
pnpm check-types   # all packages
pnpm build         # web + server bundles
```

The tests use mocked provider HTTP where appropriate. Media validation tests generate real tiny clips with FFmpeg and run ffprobe. The default suite makes no live provider calls. To verify a live integration, configure credentials and use **Settings → Providers → Test connection** (or the `providers.test` tRPC mutation); paid generation calls are intentionally not part of the automated suite. Set the budget and provider limits before spending anything.

## Docker

The server image builds **three targets**, so the parts that cost money to run are the only parts that carry them:

| Target | Contains | Runs |
| --- | --- | --- |
| `api` | Express/tRPC gateway, production dependencies only | `server` (the only service that needs to be reachable) |
| `worker` | The same app plus FFmpeg, eSpeak NG, fontconfig, and fonts | `worker` (rendering compute, no inbound traffic) |
| `migrate` | The full toolchain so the Prisma CLI is present | `migrate` (one-shot `prisma migrate deploy`) |

Both runtime targets install with `--prod`, so the web toolchain (Next.js, Turbo, TypeScript, Vitest) never ships in them. The `api` image deliberately has **no** media toolchain: it validates uploads with the bundled static `ffprobe`, and every encode happens in the worker.

Because the worker is a separate image and the only service holding the media toolchain, it can be scaled to zero, pinned to a couple of vCPUs under `deploy.resources.limits`, or moved to a pre-emptible instance without touching the API. Compose ships conservative limits (API 1 vCPU/1 GB, worker 2 vCPU/3 GB) — raise the worker's if you render in parallel.

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:logs
pnpm docker:down
```

Services:

- `postgres` — Postgres 16 (host 5433)
- `redis` — Redis 7 (host 6380)
- `migrate` — runs `prisma migrate deploy` once (target `migrate`)
- `server` — Express API on 3000 (target `api`)
- `worker` — BullMQ worker (target `worker`; system FFmpeg, eSpeak, fonts)
- `web` — Next.js standalone on 3001

The server/worker share a `media_data` volume. On the host, media is stored under `apps/server/storage` (gitignored). If you already generated media on the host and want to reuse those projects in Docker, copy the folder into the volume once:

```bash
docker run --rm \
  -v video-generator_media_data:/data/media \
  -v "$PWD/apps/server/storage:/src:ro" \
  alpine sh -c 'cp -a /src/. /data/media/'
```

A fresh `docker compose up -d --build` runs migrations automatically through the `migrate` service and starts Postgres, Redis, the API, the worker, and the web app. The first worker build installs the Linux FFmpeg, eSpeak, and fonts.

### Storage lifecycle

The worker runs retention cleanup on startup and every six hours. Pruning happens at **two different clocks**:

- `MEDIA_INTERMEDIATE_RETENTION_HOURS` (default **48**): draft/preview renders and their assets, unreferenced project intermediates (superseded regenerated stills and clips), and expired working assets. Nothing referenced by a live scene, a final render, a project thumbnail, or a publishing job is ever touched.
- `MEDIA_RETENTION_DAYS` (default **30**): orphaned assets with no project at all. Set `0` to disable the cleanup entirely.

If you use S3/R2 rather than the local volume, mirror the same policy with a bucket lifecycle rule on the intermediate prefix — the app then only has to delete database rows:

```
projects/*/visuals/*   → expire after 2 days   (raw scene stills/clips, keyframes)
projects/*/renders/*preview* → expire after 2 days   (draft renders)
projects/*/renders/*   → keep (final exports)
```

Warm storage classes (Standard-IA / Infrequent Access) are a good fit for final renders; the pipeline never re-reads them except to serve a download.

## Security and reliability notes

- All provider calls are server-side. API keys are encrypted at rest and masked in responses/logs.
- Signed media URLs expire after one hour; media is served with Range support.
- Uploads validate size, MIME/magic bytes, and media streams.
- External provider downloads are restricted to known provider/CDN URLs; arbitrary user-supplied media URLs are not fetched.
- FFmpeg is invoked with argument arrays, no shell concatenation.
- Per-user project isolation is enforced in services and tested at the auth guard level.
- Rate limits are applied to auth, tRPC, uploads, and OAuth routes with Redis. Generation also enforces the daily limit and one active job per user.
- Audit logs record provider config changes, deletes, publishing, and exports.
- Jobs retry with exponential backoff; unknown billable outcomes are stored for reconciliation.
- **Retention:** temporary job work directories are removed after every run; the worker prunes draft renders and unreferenced project intermediates older than `MEDIA_INTERMEDIATE_RETENTION_HOURS` (default 48) and unreferenced project-less assets older than `MEDIA_RETENTION_DAYS` (default 30; set `0` to disable) every six hours; project media is deleted when the project is deleted; final renders otherwise remain until you delete the project. Signed media URLs expire after one hour. Database rows are retained until the project/user is deleted.

## Known limitations / blocked until configured

- **Hosted AI providers** (OpenAI-compatible, fal.ai, WaveSpeedAI, ElevenLabs, Pexels) require keys. Adapters, settings, pricing, and tests are implemented; live calls are blocked until credentials are configured.
- **Hosted AI video requires an image-to-video capable provider.** The pipeline animates a keyframe, so a video provider that only accepts text prompts (or a configured `fal` endpoint that is not an image-to-video model) is skipped for clips with a clear reason in the stage output. ComfyUI and WaveSpeed are not flagged as image-to-video capable in this build; configure `fal` with an `imageToVideoModel` to use the hybrid tier.
- **fal endpoint ids are not verified at build time.** Tiers ship sensible defaults (`fal-ai/flux/schnell` for keyframes, an LTX/Wan/Hailuo turbo endpoint for clips) but providers rename endpoints. Live fal price quotes are preferred, then your `ProviderPricing` entries — confirm the current id and price in the fal model gallery before enabling clips.
- **Model tier estimates are planning numbers, not invoices.** They decide tier order and pre-flight projections only; recorded cost always comes from a live quote or your configured price.
- **YouTube publishing** requires the OAuth app and account authorization described above.
- **Instagram/TikTok official publishing** requires approved developer apps; this build provides manual export only.
- **Ollama** has no models installed in this checkout. Pull `llama3.2:3b` (or configure a hosted LLM) for AI scripts; the template provider is the fallback.
- **ComfyUI / Piper** are optional local providers. Capability detection reports missing binaries/models with setup messages; procedural visuals and eSpeak (or hosted TTS) are the fallback paths. `template`, `procedural`, `music-generator`, and `espeak-ng` are available in the Docker image.
- **Budget enforcement** is app-side accounting. It does not prevent provider-side charges. Set provider spend limits as a second layer.
- **`ffprobe-static`** ships an x86_64 binary in its darwin-arm64 folder; this project uses `@ffprobe-installer/ffprobe` for a real arm64 binary and prefers system `FFPROBE_PATH` in Docker.
- **YouTube API quotas** can change; check the current quota before relying on daily uploads.

## Troubleshooting

- **FFmpeg/ffprobe not found**: set `FFMPEG_PATH`/`FFPROBE_PATH`; host dev uses `ffmpeg-static`/`@ffprobe-installer`, Docker installs system FFmpeg in the `worker` target only.
- **A render seems to hang at the music mix on macOS dev**: the music step loops the bed with `-stream_loop -1`, and the bundled `ffmpeg-static` darwin build can stay alive after the output is already written (the resulting MP4 is complete and valid; the process just does not exit until its timeout). It does not reproduce with the distro FFmpeg used by the `worker` image. Verify with `ffprobe` on `<workdir>/final.mp4` before assuming the render failed.
- **Docker: `Could not load the "sharp" module using the linux-arm64 runtime`**: keep the `supportedArchitectures` Linux entries in `pnpm-workspace.yaml` and rebuild the server/worker image without cache (`docker compose build --no-cache server worker`). Sharp is externalized in the server bundle so its native optional dependencies resolve at runtime.
- **macOS `say` fails**: confirm `/usr/bin/say -v Samantha -o /tmp/test.aiff "hello"` works; otherwise install eSpeak/Piper or configure hosted TTS.
- **Ollama unreachable**: start Ollama and run `ollama pull llama3.2:3b`; the Status page reports reachability.
- **Redis/BullMQ errors**: ensure `docker compose ps` shows Redis healthy and `REDIS_URL=redis://localhost:6380`.
- **Database errors**: ensure the Postgres compose service is healthy, `DATABASE_URL` points at port 5433, and migrations were applied.
- **Media 403**: signed URLs expire after one hour; refresh the page.
- **YouTube connect fails**: verify the redirect URI exactly matches `YOUTUBE_REDIRECT_URI` and the Google account is a test user.

## Repository structure

```
apps/
  web/                  Next.js creator workspace
  server/               Express API, BullMQ worker, media/upload/OAuth routes
                        Dockerfile targets: api (gateway), worker (render), migrate
packages/
  api/                  tRPC routers, services, providers, pipeline, media, tests
    pipeline/
      runner.ts         checkpointed stages, reuse guards, per-video cost checks
      checkpoint.ts     resume planning; paid vs local step classification
      provider-usage.ts cost guards, request ledger, usage recording
      render-profiles.ts draft 480p vs production 1080p encoding profiles
      renderer.ts       FFmpeg scene encode, concat, music mix, thumbnail
    providers/
      visual/           Pexels, procedural, fal, WaveSpeed, ComfyUI adapters
        model-tiers.ts  keyframe / image-to-video / text-to-video cost tiers
        tiers.ts        cheapest-first scene source planning
      tts/cache.ts      content-hash narration stem cache
    services/
      budget.ts         monthly/per-video limits and eligibility
      pricing.ts        live quotes, configured prices, generation estimates
      retention.ts      draft + intermediate purge, orphan cleanup
  auth/                 Better Auth factory
  db/                   Prisma schema, migrations, seed, generated client
  ui/                   Shared Base UI/shadcn primitives and tokens
  config/               Shared TypeScript config
```
