# Multi-stage build with three runtime targets:
#   api      - Express/tRPC gateway only. No FFmpeg, eSpeak, or fonts, so it stays small and cheap to run.
#   worker   - Background queue worker with the full media toolchain (FFmpeg, eSpeak, fonts).
#   migrate  - One-shot Prisma migration runner (keeps dev tooling so the CLI is available).
# Build a single target with: docker compose build server worker
# syntax=docker/dockerfile:1.7

FROM node:24-slim AS base
RUN npm install -g pnpm@12.11.2
WORKDIR /app

FROM base AS builder
COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local \
    --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    --mount=type=cache,target=/pnpm-store \
    pnpm install --store-dir /pnpm-store --frozen-lockfile
ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local \
    --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    cd apps/server && pnpm run build

# Same tree with dev dependencies pruned, which drops the web toolchain
# (Next.js, Turbo, TypeScript, Vitest) from the runtime images.
FROM builder AS production-deps
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local \
    --mount=type=secret,id=server_env,target=/app/apps/server/.env.local \
    --mount=type=cache,target=/pnpm-store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm-store \
    && find /app/packages -name "*.test.ts" -delete \
    && rm -rf /app/apps/web

FROM node:24-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages ./packages
COPY --from=production-deps /app/apps/server ./apps/server
COPY --from=production-deps /app/package.json ./package.json
COPY --from=production-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["node", "dist/index.mjs"]

FROM node:24-slim AS worker
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages ./packages
COPY --from=production-deps /app/apps/server ./apps/server
COPY --from=production-deps /app/package.json ./package.json
COPY --from=production-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
WORKDIR /app/apps/server
CMD ["node", "dist/worker.mjs"]

FROM builder AS migrate
WORKDIR /app/packages/db
CMD ["/app/packages/db/node_modules/.bin/prisma", "migrate", "deploy"]
