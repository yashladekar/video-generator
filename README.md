# ReelForge — AI Faceless Reels

A local-first, cost-aware creator workspace that turns a topic into a validated vertical short video: script → scenes → narration → visuals → captions → music → FFmpeg render → review → publish or export.

The repo started as a Better-T-Stack scaffold (Next.js + Express + tRPC + Prisma/Postgres + Better Auth + Turborepo) and has been extended into a complete application with background jobs, real media processing, hosted/local AI adapters, budget accounting, and a Video Studio.

## What is implemented

- **Auth and per-user isolation** with Better Auth email/password sessions. Every project, scene, asset, job, provider configuration, budget, and publishing record is scoped to the signed-in user.
- **Persistent projects** with brief, configuration, scripts, scenes, assets, generation jobs, usage records, renders, and publishing history.
- **Real background generation** through BullMQ + Redis. API requests create jobs and return immediately; a worker runs the pipeline.
- **Checkpointed pipeline**: validate → research → script → scenes → narration → visuals → optional AI video → subtitles → music → FFmpeg render → ffprobe validation → finalize. Retries resume from the last successful step.
- **Structured script generation** validated with Zod, including duration-sum tolerance, word-per-second narration limits, distinct visual descriptions, and repair retries.
- **Narration alignment**: scene timings are adjusted to measured TTS duration; narration is never trimmed. A speed-up pass is used when needed.
- **Real FFmpeg rendering** with per-scene motion, normalized narration, caption overlays, procedural music, final concat, and validation of duration, streams, codecs, resolution, fps, volume, and black frames.
- **Hybrid visuals**: original procedural motion graphics/sharable stills by default; Pexels stock (when a free key exists); optional fal.ai, WaveSpeedAI, and ComfyUI adapters. Hosted AI video is limited to selected scenes.
- **Provider settings UI** with encrypted secrets (AES-256-GCM), masked credentials, connection tests, capability detection, and a model pricing catalog.
- **Budget accounting** with a default ₹500/month, per-video cap, retry reserve, daily limit, local-only mode, live/configured provider quotes, estimate vs actual records, and honest caveats. No hard provider-side spending guarantee is claimed.
- **Video Studio**: vertical preview, draggable scene timeline, narration/subtitle/music tracks, per-scene editing, visual replacement, voiceover/scene regeneration, preview/final renders, approval, download.
- **Publishing Center**: official YouTube OAuth + resumable upload (when credentials are configured), scheduled jobs, retries, status history, and manual export for Instagram Reels/TikTok. Manual exports are recorded as `EXPORTED`, never `PUBLISHED`.
- **Google/Anthropic-style provider safety**: unknown billable outcomes are not retried blindly; provider request ids and reconciliation are persisted for fal/WaveSpeed.
- **Tests**: 41 Vitest tests covering script/scene schema validation, duration normalization, money/budget math and rejection thresholds, checkpoint selection, provider HTTP classification, fal.ai adapter flow, media validation, auth guards, and publishing policy.

Verified locally: the pipeline produced real **45.04s, 1080×1920, 30fps H.264/AAC** MP4s with `passed: true` validation and ₹0 actual cost using local providers.

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

Optional provider variables (server-only): `FFMPEG_PATH`, `FFPROBE_PATH`, `OLLAMA_BASE_URL`, `COMFYUI_BASE_URL`, `PIPER_BIN`, `PIPER_MODEL`, `PEXELS_API_KEY`, `FAL_KEY`, `WAVESPEED_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ELEVENLABS_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `S3_*`, `MEDIA_RETENTION_DAYS`, `MAX_UPLOAD_MB`, `WORKER_CONCURRENCY`, `USD_TO_INR_RATE`.

Provider keys can also be entered in **Settings → Providers**; they are encrypted before storage and never returned to the browser. Environment variables act as server-side fallbacks.

## Generation pipeline

The worker runs these stages and persists the result of each one:

1. **Validate** the brief, settings, provider availability, and budget.
2. **Research** (optional) through Wikipedia; configurable Tavily adapter is available when a key is set.
3. **Script** with a structured JSON schema. Providers: `ollama`, `openai-compatible`, or a deterministic `template` fallback. Invalid output is repaired up to two times.
4. **Scenes** with timing validation and visual-type selection.
5. **Narration** per scene with cache reuse, duration measurement, and timing alignment. Failed/stale assets are regenerated.
6. **Visuals** per scene: procedural, Pexels stock, or hosted image providers, with fallback and attribution.
7. **AI video** selectively for up to `maxHostedVideoCalls` high-impact scenes. Falls back to an image if the paid call fails.
8. **Subtitles** with SRT + styled transparent caption PNGs.
9. **Music** generated procedurally (ambient/cinematic/upbeat/lofi) and mixed under narration.
10. **Render** per-scene clips → concat → music mix → H.264/AAC MP4 → thumbnail.
11. **Validate** duration, 9:16 resolution, video/audio streams, codecs, fps, audio levels, black frames, and file size.
12. **Finalize** the job, project, usage, budget, notification, and rendered-video record.

Retries create a new attempt for the failed step onward; already succeeded steps are reused. Unknown paid-provider outcomes are recorded and are not automatically resubmitted.

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

- Default monthly budget: **₹500**; default per-video max: ₹50; retry reserve: 15%; daily limit: 1 (configurable).
- Estimates use live fal/WaveSpeed price quotes when a key exists; otherwise the `ProviderPricing` catalog; otherwise the call is blocked with `PRICING_NOT_CONFIGURED`.
- Estimates and actual recorded usage are stored separately. Costs are integer paise and micro-USD with the FX rate/tax/fee used recorded on each usage row.
- Local-only mode blocks paid providers while allowing free/local options.
- The budget is enforced by this application’s accounting. It is **not** a provider-side hard cap. Configure provider-side spending limits separately.

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
pnpm test          # Vitest, currently 41 tests
pnpm check-types   # all packages
pnpm build         # web + server bundles
```

The tests use mocked provider HTTP where appropriate. Media validation tests generate real tiny clips with FFmpeg and run ffprobe. Real paid-provider integration tests are intentionally opt-in: only run them with credentials and an explicit budget; no live provider calls are made by the default suite.

## Docker

Full container stack:

```bash
pnpm docker:build
pnpm docker:up
pnpm docker:logs
pnpm docker:down
```

Services:

- `postgres` — Postgres 16 (host 5433)
- `redis` — Redis 7 (host 6380)
- `migrate` — runs `prisma migrate deploy` once
- `server` — Express API on 3000
- `worker` — BullMQ worker (same image as server; system FFmpeg, eSpeak, fonts)
- `web` — Next.js standalone on 3001

The server/worker share a `media_data` volume. On the host, media is stored under `apps/server/storage` (gitignored).

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

## Known limitations / blocked until configured

- **Hosted AI providers** (OpenAI-compatible, fal.ai, WaveSpeedAI, ElevenLabs, Pexels) require keys. Adapters, settings, pricing, and tests are implemented; live calls are blocked until credentials are configured.
- **YouTube publishing** requires the OAuth app and account authorization described above.
- **Instagram/TikTok official publishing** requires approved developer apps; this build provides manual export only.
- **Ollama** has no models installed in this checkout. Pull `llama3.2:3b` (or configure a hosted LLM) for AI scripts; the template provider is the fallback.
- **ComfyUI/Piper** are not installed. The app detects them, shows setup instructions, and falls back safely.
- **Budget enforcement** is app-side accounting. It does not prevent provider-side charges. Set provider spend limits as a second layer.
- **`ffprobe-static`** ships an x86_64 binary in its darwin-arm64 folder; this project uses `@ffprobe-installer/ffprobe` for a real arm64 binary and prefers system `FFPROBE_PATH` in Docker.
- **YouTube API quotas** can change; check the current quota before relying on daily uploads.

## Troubleshooting

- **FFmpeg/ffprobe not found**: set `FFMPEG_PATH`/`FFPROBE_PATH`; host dev uses `ffmpeg-static`/`@ffprobe-installer`, Docker installs system FFmpeg.
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
packages/
  api/                  tRPC routers, services, providers, pipeline, media, tests
  auth/                 Better Auth factory
  db/                   Prisma schema, migrations, seed, generated client
  ui/                   Shared Base UI/shadcn primitives and tokens
  config/               Shared TypeScript config
```
