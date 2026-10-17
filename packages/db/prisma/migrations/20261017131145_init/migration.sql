-- CreateEnum
CREATE TYPE "ProviderCategory" AS ENUM ('LLM', 'RESEARCH', 'TTS', 'IMAGE', 'IMAGE_TO_VIDEO', 'TEXT_TO_VIDEO', 'MUSIC', 'STORAGE', 'PUBLISHING');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('ESTIMATE', 'ACTUAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('VALIDATE', 'RESEARCH', 'SCRIPT', 'SCENES', 'NARRATION', 'VISUALS', 'AI_VIDEO', 'SUBTITLES', 'MUSIC', 'RENDER', 'VALIDATE_OUTPUT', 'FINALIZE', 'PUBLISH');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ProviderRequestStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RenderKind" AS ENUM ('PREVIEW', 'FINAL');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'CONFIGURED', 'QUEUED', 'GENERATING', 'COMPLETED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "VisualType" AS ENUM ('IMAGE_ANIMATION', 'STOCK_IMAGE', 'STOCK_VIDEO', 'PROCEDURAL', 'AI_IMAGE', 'AI_VIDEO');

-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('PLANNED', 'ASSETS_READY', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('REFERENCE', 'IMAGE', 'VIDEO', 'CLIP', 'NARRATION', 'MUSIC', 'SUBTITLE', 'THUMBNAIL', 'FINAL_VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('LOCAL', 'UPLOAD', 'PEXELS', 'FAL', 'WAVESPEED', 'COMFYUI', 'PROCEDURAL', 'MUSIC_GENERATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "PublishingPlatform" AS ENUM ('YOUTUBE', 'INSTAGRAM_REELS', 'TIKTOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "PublishingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'UPLOADING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'EXPORTED', 'NEEDS_ATTENTION');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "defaultTone" TEXT,
    "defaultVoice" TEXT,
    "defaultSubtitleStyle" TEXT NOT NULL DEFAULT 'bold',
    "defaultVisualStyle" TEXT NOT NULL DEFAULT 'cinematic',
    "defaultMusicMood" TEXT NOT NULL DEFAULT 'ambient',
    "monthlyBudgetInrPaise" INTEGER NOT NULL DEFAULT 50000,
    "maxCostPerVideoInrPaise" INTEGER NOT NULL DEFAULT 5000,
    "maxHostedVideoCalls" INTEGER NOT NULL DEFAULT 2,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "reservePercent" INTEGER NOT NULL DEFAULT 15,
    "usdToInrRate" DOUBLE PRECISION NOT NULL DEFAULT 88,
    "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "localOnly" BOOLEAN NOT NULL DEFAULT false,
    "autoFallback" BOOLEAN NOT NULL DEFAULT true,
    "preferredLlmProvider" TEXT,
    "preferredTtsProvider" TEXT,
    "preferredVisualProvider" TEXT,
    "preferredVideoProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfiguration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "encryptedSecret" TEXT,
    "secretLast4" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPricing" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "stepId" TEXT,
    "provider" TEXT NOT NULL,
    "category" "ProviderCategory" NOT NULL,
    "model" TEXT,
    "costType" "CostType" NOT NULL,
    "estimatedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "actualCostMicroUsd" INTEGER,
    "estimatedCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "actualCostInrPaise" INTEGER,
    "inputUnits" DOUBLE PRECISION,
    "outputUnits" DOUBLE PRECISION,
    "unit" TEXT,
    "providerRequestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountInrPaise" INTEGER NOT NULL,
    "reservedInrPaise" INTEGER NOT NULL DEFAULT 0,
    "spentInrPaise" INTEGER NOT NULL DEFAULT 0,
    "status" "BudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scriptId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStep" "StepType",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "idempotencyKey" TEXT NOT NULL,
    "bullJobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "estimatedCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "actualCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "StepType" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "orderIndex" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "providerRequestId" TEXT,
    "costInrPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "category" "ProviderCategory" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "status" "ProviderRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "request" JSONB,
    "response" JSONB,
    "estimatedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "actualCostMicroUsd" INTEGER,
    "estimatedCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "actualCostInrPaise" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderedVideo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "scriptId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" "RenderKind" NOT NULL DEFAULT 'FINAL',
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "videoAssetId" TEXT NOT NULL,
    "thumbnailAssetId" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "fileSizeBytes" INTEGER,
    "validation" JSONB,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "niche" TEXT,
    "targetAudience" TEXT,
    "objective" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "cta" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "durationSeconds" INTEGER NOT NULL DEFAULT 60,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "resolution" TEXT NOT NULL DEFAULT '1080p',
    "estimatedCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "actualCostInrPaise" INTEGER NOT NULL DEFAULT 0,
    "thumbnailAssetId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "targetAudience" TEXT,
    "objective" TEXT,
    "niche" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "style" TEXT,
    "callToAction" TEXT,
    "referenceText" TEXT,
    "referenceAssets" JSONB,
    "researchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "hook" TEXT,
    "targetDurationSeconds" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "language" TEXT NOT NULL DEFAULT 'en',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "researchSummary" TEXT,
    "researchSources" JSONB,
    "rawResponse" JSONB,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "narration" TEXT NOT NULL,
    "visualDescription" TEXT NOT NULL,
    "visualType" "VisualType" NOT NULL DEFAULT 'PROCEDURAL',
    "subtitleText" TEXT NOT NULL,
    "transition" TEXT NOT NULL DEFAULT 'cut',
    "motion" TEXT,
    "status" "SceneStatus" NOT NULL DEFAULT 'PLANNED',
    "visualAssetId" TEXT,
    "narrationAssetId" TEXT,
    "clipAssetId" TEXT,
    "providerRequestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "source" "AssetSource" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "checksum" TEXT,
    "cacheKey" TEXT,
    "provider" TEXT,
    "providerModel" TEXT,
    "providerRequestId" TEXT,
    "attribution" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PublishingPlatform" NOT NULL,
    "accountName" TEXT,
    "externalAccountId" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "scopes" TEXT[],
    "tokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "renderedVideoId" TEXT NOT NULL,
    "publishingAccountId" TEXT,
    "platform" "PublishingPlatform" NOT NULL,
    "status" "PublishingStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[],
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "ProviderConfiguration_userId_category_enabled_idx" ON "ProviderConfiguration"("userId", "category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfiguration_userId_category_provider_key" ON "ProviderConfiguration"("userId", "category", "provider");

-- CreateIndex
CREATE INDEX "ProviderPricing_provider_category_active_idx" ON "ProviderPricing"("provider", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPricing_provider_model_unit_key" ON "ProviderPricing"("provider", "model", "unit");

-- CreateIndex
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_projectId_createdAt_idx" ON "UsageRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_jobId_idx" ON "UsageRecord"("jobId");

-- CreateIndex
CREATE INDEX "Budget_userId_periodEnd_idx" ON "Budget"("userId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_periodStart_key" ON "Budget"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_projectId_createdAt_idx" ON "GenerationJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_userId_idempotencyKey_key" ON "GenerationJob"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationStep_jobId_orderIndex_idx" ON "GenerationStep"("jobId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationStep_jobId_type_attempt_key" ON "GenerationStep"("jobId", "type", "attempt");

-- CreateIndex
CREATE INDEX "ProviderRequest_provider_providerRequestId_idx" ON "ProviderRequest"("provider", "providerRequestId");

-- CreateIndex
CREATE INDEX "ProviderRequest_status_createdAt_idx" ON "ProviderRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRequest_userId_idempotencyKey_key" ON "ProviderRequest"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RenderedVideo_projectId_kind_createdAt_idx" ON "RenderedVideo"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "RenderedVideo_userId_createdAt_idx" ON "RenderedVideo"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_thumbnailAssetId_key" ON "Project"("thumbnailAssetId");

-- CreateIndex
CREATE INDEX "Project_userId_status_idx" ON "Project"("userId", "status");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBrief_projectId_key" ON "ContentBrief"("projectId");

-- CreateIndex
CREATE INDEX "Script_projectId_createdAt_idx" ON "Script"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Script_projectId_version_key" ON "Script"("projectId", "version");

-- CreateIndex
CREATE INDEX "Scene_scriptId_orderIndex_idx" ON "Scene"("scriptId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_scriptId_sceneNumber_key" ON "Scene"("scriptId", "sceneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_cacheKey_key" ON "MediaAsset"("cacheKey");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_kind_idx" ON "MediaAsset"("projectId", "kind");

-- CreateIndex
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_checksum_idx" ON "MediaAsset"("checksum");

-- CreateIndex
CREATE INDEX "PublishingAccount_userId_platform_idx" ON "PublishingAccount"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingAccount_userId_platform_externalAccountId_key" ON "PublishingAccount"("userId", "platform", "externalAccountId");

-- CreateIndex
CREATE INDEX "PublishingJob_userId_status_scheduledAt_idx" ON "PublishingJob"("userId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishingJob_projectId_createdAt_idx" ON "PublishingJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingJob_userId_idempotencyKey_key" ON "PublishingJob"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConfiguration" ADD CONSTRAINT "ProviderConfiguration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "GenerationStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationStep" ADD CONSTRAINT "GenerationStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRequest" ADD CONSTRAINT "ProviderRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRequest" ADD CONSTRAINT "ProviderRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRequest" ADD CONSTRAINT "ProviderRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderedVideo" ADD CONSTRAINT "RenderedVideo_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_thumbnailAssetId_fkey" FOREIGN KEY ("thumbnailAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_visualAssetId_fkey" FOREIGN KEY ("visualAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_narrationAssetId_fkey" FOREIGN KEY ("narrationAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_clipAssetId_fkey" FOREIGN KEY ("clipAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingAccount" ADD CONSTRAINT "PublishingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_renderedVideoId_fkey" FOREIGN KEY ("renderedVideoId") REFERENCES "RenderedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_publishingAccountId_fkey" FOREIGN KEY ("publishingAccountId") REFERENCES "PublishingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
