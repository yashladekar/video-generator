import type { CostType, ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { BudgetError } from "../lib/errors";
import { toJsonValue } from "../lib/json";
import { percentOf } from "../lib/money";
import { getDayPeriod, getMonthPeriod } from "../lib/time";

export async function ensureUserSettings(ctx: Context, userId: string) {
  return ctx.db.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export type BudgetStatus = {
  settings: Awaited<ReturnType<typeof ensureUserSettings>>;
  periodStart: Date;
  periodEnd: Date;
  amountInrPaise: number;
  spentInrPaise: number;
  reservedInrPaise: number;
  availableInrPaise: number;
  retryReserveInrPaise: number;
  spendableInrPaise: number;
};

export async function getBudgetStatus(
  ctx: Context,
  userId: string,
): Promise<BudgetStatus> {
  const settings = await ensureUserSettings(ctx, userId);
  const now = new Date();
  const period = getMonthPeriod(now, settings.timezone);

  const { budget, spent, reserved } = await ctx.db.$transaction(
    async (tx) => {
      const budgetRow = await tx.budget.upsert({
        where: {
          userId_periodStart: {
            userId,
            periodStart: period.start,
          },
        },
        update: {
          amountInrPaise: settings.monthlyBudgetInrPaise,
          periodEnd: period.end,
        },
        create: {
          userId,
          periodStart: period.start,
          periodEnd: period.end,
          amountInrPaise: settings.monthlyBudgetInrPaise,
        },
      });

      const spentAggregate = await tx.usageRecord.aggregate({
        where: {
          userId,
          costType: "ACTUAL",
          createdAt: { gte: period.start, lt: period.end },
        },
        _sum: { actualCostInrPaise: true },
      });

      const reservedAggregate = await tx.generationJob.aggregate({
        where: {
          userId,
          status: { in: ["QUEUED", "RUNNING"] },
          createdAt: { gte: period.start, lt: period.end },
        },
        _sum: { estimatedCostInrPaise: true },
      });

      const spentValue = spentAggregate._sum.actualCostInrPaise ?? 0;
      const reservedValue = reservedAggregate._sum.estimatedCostInrPaise ?? 0;
      const updated = await tx.budget.update({
        where: { id: budgetRow.id },
        data: {
          spentInrPaise: spentValue,
          reservedInrPaise: reservedValue,
        },
      });
      return {
        budget: updated,
        spent: spentValue,
        reserved: reservedValue,
      };
    },
    { isolationLevel: "Serializable" },
  );

  const available = Math.max(0, budget.amountInrPaise - spent - reserved);
  const retryReserve = percentOf(
    budget.amountInrPaise,
    settings.reservePercent,
  );
  return {
    settings,
    periodStart: period.start,
    periodEnd: period.end,
    amountInrPaise: budget.amountInrPaise,
    spentInrPaise: spent,
    reservedInrPaise: reserved,
    availableInrPaise: available,
    retryReserveInrPaise: retryReserve,
    spendableInrPaise: Math.max(0, available - retryReserve),
  };
}

export async function getDailyUsage(ctx: Context, userId: string) {
  const settings = await ensureUserSettings(ctx, userId);
  const period = getDayPeriod(new Date(), settings.timezone);
  const count = await ctx.db.generationJob.count({
    where: {
      userId,
      kind: "GENERATE",
      createdAt: { gte: period.start, lt: period.end },
    },
  });
  return {
    count,
    limit: settings.dailyLimit,
    remaining: Math.max(0, settings.dailyLimit - count),
    periodStart: period.start,
    periodEnd: period.end,
  };
}

export type StartEligibility =
  | { ok: true }
  | { ok: false; code: string; message: string; details?: Record<string, number> };

export function evaluateStartEligibility(input: {
  estimatedCostInrPaise: number;
  unknownPricing: boolean;
  maxCostPerVideoInrPaise: number;
  spendableInrPaise: number;
  dailyRemaining: number;
  dailyLimit: number;
  activeJobs: number;
}): StartEligibility {
  if (input.unknownPricing) {
    return {
      ok: false,
      code: "PRICING_NOT_CONFIGURED",
      message:
        "Some selected hosted providers do not have a configured price. Add pricing in Settings or choose local/free providers before generating.",
    };
  }
  if (input.estimatedCostInrPaise > input.maxCostPerVideoInrPaise) {
    return {
      ok: false,
      code: "PER_VIDEO_LIMIT",
      message: `The estimated cost (₹${(input.estimatedCostInrPaise / 100).toFixed(2)}) exceeds the per-video limit (₹${(input.maxCostPerVideoInrPaise / 100).toFixed(2)}).`,
    };
  }
  if (input.estimatedCostInrPaise > input.spendableInrPaise) {
    return {
      ok: false,
      code: "BUDGET_EXCEEDED",
      message: `The estimated cost (₹${(input.estimatedCostInrPaise / 100).toFixed(2)}) exceeds the available budget (₹${(input.spendableInrPaise / 100).toFixed(2)} after the retry reserve). Switch to local-only mode or raise the monthly budget.`,
      details: {
        estimatedCostInrPaise: input.estimatedCostInrPaise,
        spendableInrPaise: input.spendableInrPaise,
      },
    };
  }
  if (input.dailyRemaining <= 0) {
    return {
      ok: false,
      code: "DAILY_LIMIT",
      message: `The daily generation limit (${input.dailyLimit}) has been reached. Try again tomorrow or raise the limit in Settings.`,
    };
  }
  if (input.activeJobs > 0) {
    return {
      ok: false,
      code: "JOB_IN_PROGRESS",
      message:
        "A generation job is already running. Wait for it to finish or cancel it before starting another.",
    };
  }
  return { ok: true };
}

export async function assertCanStartGeneration(
  ctx: Context,
  userId: string,
  estimate: { estimatedCostInrPaise: number; unknownPricing: boolean },
): Promise<BudgetStatus> {
  const status = await getBudgetStatus(ctx, userId);
  const daily = await getDailyUsage(ctx, userId);
  const activeJobs = await ctx.db.generationJob.count({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  const eligibility = evaluateStartEligibility({
    estimatedCostInrPaise: estimate.estimatedCostInrPaise,
    unknownPricing: estimate.unknownPricing,
    maxCostPerVideoInrPaise: status.settings.maxCostPerVideoInrPaise,
    spendableInrPaise: status.spendableInrPaise,
    dailyRemaining: daily.remaining,
    dailyLimit: daily.limit,
    activeJobs,
  });
  if (!eligibility.ok) {
    throw new BudgetError(eligibility.code, eligibility.message, eligibility.details);
  }
  return status;
}

export async function recordUsage(
  ctx: Context,
  input: {
    userId: string;
    projectId?: string | null;
    jobId?: string | null;
    stepId?: string | null;
    provider: string;
    category: ProviderCategory;
    model?: string | null;
    costType: CostType;
    estimatedCostMicroUsd?: number;
    actualCostMicroUsd?: number | null;
    estimatedCostInrPaise?: number;
    actualCostInrPaise?: number | null;
    inputUnits?: number | null;
    outputUnits?: number | null;
    unit?: string | null;
    providerRequestId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const record = await ctx.db.usageRecord.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      jobId: input.jobId ?? null,
      stepId: input.stepId ?? null,
      provider: input.provider,
      category: input.category,
      model: input.model ?? null,
      costType: input.costType,
      estimatedCostMicroUsd: input.estimatedCostMicroUsd ?? 0,
      actualCostMicroUsd: input.actualCostMicroUsd ?? null,
      estimatedCostInrPaise: input.estimatedCostInrPaise ?? 0,
      actualCostInrPaise: input.actualCostInrPaise ?? null,
      inputUnits: input.inputUnits ?? null,
      outputUnits: input.outputUnits ?? null,
      unit: input.unit ?? null,
      providerRequestId: input.providerRequestId ?? null,
      metadata: toJsonValue(input.metadata),
    },
  });
  return record;
}

export async function updateSettings(
  ctx: Context,
  userId: string,
  input: Partial<{
    monthlyBudgetInrPaise: number;
    maxCostPerVideoInrPaise: number;
    maxHostedVideoCalls: number;
    maxRetries: number;
    reservePercent: number;
    usdToInrRate: number;
    taxPercent: number;
    feePercent: number;
    dailyLimit: number;
    timezone: string;
    localOnly: boolean;
    autoFallback: boolean;
    preferredLlmProvider: string | null;
    preferredTtsProvider: string | null;
    preferredVisualProvider: string | null;
    preferredVideoProvider: string | null;
    defaultLanguage: string;
    defaultTone: string | null;
    defaultVoice: string | null;
    defaultSubtitleStyle: string;
    defaultVisualStyle: string;
    defaultMusicMood: string;
  }>,
) {
  await ensureUserSettings(ctx, userId);
  return ctx.db.userSettings.update({
    where: { userId },
    data: input,
  });
}
