import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../prisma/generated/client";
import type { DatabaseConfig } from "./config";

export function createPrismaClient(env: DatabaseConfig) {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

export type Database = ReturnType<typeof createPrismaClient>;

export * from "../prisma/generated/enums";
export type {
  AuditLogModel as AuditLog,
  BudgetModel as Budget,
  ContentBriefModel as ContentBrief,
  GenerationJobModel as GenerationJob,
  GenerationStepModel as GenerationStep,
  MediaAssetModel as MediaAsset,
  NotificationModel as Notification,
  ProjectModel as Project,
  ProviderConfigurationModel as ProviderConfiguration,
  ProviderPricingModel as ProviderPricing,
  ProviderRequestModel as ProviderRequest,
  PublishingAccountModel as PublishingAccount,
  PublishingJobModel as PublishingJob,
  RenderedVideoModel as RenderedVideo,
  SceneModel as Scene,
  ScriptModel as Script,
  UsageRecordModel as UsageRecord,
  UserSettingsModel as UserSettings,
} from "../prisma/generated/models";
export type { Prisma } from "../prisma/generated/client";
