import type { ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { BudgetError, ProviderError } from "../lib/errors";
import { hashCacheKey } from "../lib/hash";
import { toJsonValue } from "../lib/json";
import { formatInrPaise, usdToMicros, usdToPaise } from "../lib/money";
import { getBudgetStatus } from "../services/budget";
import { getUnitPrice } from "../services/pricing";
import { isPaidProvider } from "../providers/catalog";
import type { UsageInfo } from "../providers/types";

const FREE_PROVIDERS = new Set([
  "template",
  "ollama",
  "macos-say",
  "espeak-ng",
  "piper",
  "procedural",
  "comfyui",
  "music-generator",
  "wikipedia",
  "pexels",
  "local",
]);

export const PER_VIDEO_WARN_PERCENT = 80;

export type CostGuardSettings = {
  usdToInrRate?: number;
  taxPercent?: number;
  feePercent?: number;
  maxCostPerVideoInrPaise?: number | null;
};

export type CostLevel = "ok" | "warning" | "exceeded";

export type JobCostSnapshot = {
  jobId: string;
  spentInrPaise: number;
  limitInrPaise: number;
  remainingInrPaise: number;
  percentUsed: number;
  level: CostLevel;
};

export function classifyCostLevel(
  spentInrPaise: number,
  limitInrPaise: number,
  warnPercent = PER_VIDEO_WARN_PERCENT,
): CostLevel {
  if (!Number.isFinite(limitInrPaise) || limitInrPaise <= 0) return "ok";
  const percent = (spentInrPaise / limitInrPaise) * 100;
  if (percent >= 100) return "exceeded";
  if (percent >= warnPercent) return "warning";
  return "ok";
}

export function projectProviderCostInrPaise(
  units: number,
  unitPriceUsd: number,
  settings: CostGuardSettings = {},
): number {
  return usdToPaise(
    units * unitPriceUsd,
    settings.usdToInrRate ?? 88,
    settings.taxPercent ?? 0,
    settings.feePercent ?? 0,
  );
}

export function projectEstimatedCostInrPaise(
  usd: number,
  settings: CostGuardSettings = {},
): number {
  return projectProviderCostInrPaise(1, usd, settings);
}

export async function getJobCostSnapshot(
  ctx: Context,
  jobId: string,
  limitInrPaise: number,
  warnPercent = PER_VIDEO_WARN_PERCENT,
): Promise<JobCostSnapshot> {
  const aggregate = await ctx.db.usageRecord.aggregate({
    where: { jobId, costType: "ACTUAL" },
    _sum: { actualCostInrPaise: true },
  });
  const spentInrPaise = aggregate._sum.actualCostInrPaise ?? 0;
  const percentUsed =
    limitInrPaise > 0 ? (spentInrPaise / limitInrPaise) * 100 : 0;
  return {
    jobId,
    spentInrPaise,
    limitInrPaise,
    remainingInrPaise: Math.max(0, limitInrPaise - spentInrPaise),
    percentUsed,
    level: classifyCostLevel(spentInrPaise, limitInrPaise, warnPercent),
  };
}

/**
 * Blocks a paid call when the projected running cost of the video would cross
 * the per-video limit, so a single clip can never blow the unit economics.
 */
export async function assertVideoCostHeadroom(
  ctx: Context,
  input: {
    userId: string;
    jobId: string;
    provider: string;
    model?: string;
    label: string;
    limitInrPaise?: number | null;
    projectedInrPaise?: number;
    warnPercent?: number;
  },
): Promise<JobCostSnapshot> {
  const limit = input.limitInrPaise ?? 0;
  if (!limit || limit <= 0) {
    return {
      jobId: input.jobId,
      spentInrPaise: 0,
      limitInrPaise: 0,
      remainingInrPaise: 0,
      percentUsed: 0,
      level: "ok",
    };
  }
  const warnPercent = input.warnPercent ?? PER_VIDEO_WARN_PERCENT;
  const snapshot = await getJobCostSnapshot(ctx, input.jobId, limit, warnPercent);
  const projected = Math.max(0, input.projectedInrPaise ?? 0);
  const projectedTotal = snapshot.spentInrPaise + projected;
  const level = classifyCostLevel(projectedTotal, limit, warnPercent);

  if (level === "exceeded") {
    ctx.logger.error(
      {
        jobId: input.jobId,
        userId: input.userId,
        provider: input.provider,
        model: input.model,
        label: input.label,
        spentInrPaise: snapshot.spentInrPaise,
        projectedInrPaise: projected,
        limitInrPaise: limit,
      },
      "per-video cost limit would be exceeded; blocking the paid call",
    );
    throw new BudgetError(
      "PER_VIDEO_COST_LIMIT",
      `${input.label} would push this video to about ${formatInrPaise(projectedTotal)}, above the ${formatInrPaise(limit)} per-video limit. Drop the scene to a still or keyframe, lower the clip count, or raise the limit in Settings.`,
      {
        spentInrPaise: snapshot.spentInrPaise,
        projectedInrPaise: projected,
        limitInrPaise: limit,
        provider: input.provider,
      },
    );
  }

  if (level === "warning") {
    ctx.logger.warn(
      {
        jobId: input.jobId,
        provider: input.provider,
        model: input.model,
        label: input.label,
        spentInrPaise: snapshot.spentInrPaise,
        projectedInrPaise: projected,
        limitInrPaise: limit,
        percentUsed: Math.round((projectedTotal / limit) * 100),
      },
      "per-video cost is approaching the configured limit",
    );
  }

  return snapshot;
}

export async function guardPaidCall(
  ctx: Context,
  userId: string,
  provider: string,
  category: ProviderCategory,
  model?: string,
  unit?: string,
  quoteInputs?: Record<string, unknown>,
  options?: {
    jobId?: string;
    units?: number;
    label?: string;
    settings?: CostGuardSettings;
  },
): Promise<void> {
  if (FREE_PROVIDERS.has(provider)) return;
  let unitPriceUsd: number | undefined;
  if (unit) {
    const price = await getUnitPrice(
      ctx,
      userId,
      provider,
      category,
      model,
      unit,
      quoteInputs,
    );
    if (price.source === "unknown") {
      throw new BudgetError(
        "PRICING_NOT_CONFIGURED",
        `Pricing is not configured for ${provider}${model ? ` / ${model}` : ""}. Add a price in Settings or use a local provider.`,
      );
    }
    unitPriceUsd = price.unitPriceUsd;
  }
  const budget = await getBudgetStatus(ctx, userId);
  if (budget.spendableInrPaise <= 0) {
    throw new BudgetError(
      "BUDGET_EXHAUSTED",
      "The available budget is exhausted. Switch to local/free providers or raise the monthly budget.",
    );
  }
  const limitInrPaise = options?.settings?.maxCostPerVideoInrPaise ?? 0;
  if (!options?.jobId || !limitInrPaise || limitInrPaise <= 0) return;
  const projected =
    options.units !== undefined && unitPriceUsd !== undefined
      ? projectProviderCostInrPaise(
          options.units,
          unitPriceUsd,
          options.settings ?? {},
        )
      : 0;
  await assertVideoCostHeadroom(ctx, {
    userId,
    jobId: options.jobId,
    provider,
    model,
    label: options.label ?? `${provider} call`,
    limitInrPaise,
    projectedInrPaise: projected,
  });
}

export async function recordProviderUsage(
  ctx: Context,
  input: {
    userId: string;
    projectId: string;
    jobId: string;
    provider: string;
    category: ProviderCategory;
    model?: string;
    units: number;
    unit: string;
    providerRequestId?: string;
    usage?: UsageInfo;
    settings: {
      usdToInrRate: number;
      taxPercent: number;
      feePercent: number;
      maxCostPerVideoInrPaise?: number | null;
    };
    metadata?: Record<string, unknown>;
    enforcePerVideoLimit?: boolean;
  },
): Promise<number> {
  const price = await getUnitPrice(
    ctx,
    input.userId,
    input.provider,
    input.category,
    input.model,
    input.unit,
  );
  if (price.source === "unknown") {
    throw new BudgetError(
      "PRICING_NOT_CONFIGURED",
      `Pricing is not configured for ${input.provider}${input.model ? ` / ${input.model}` : ""}. Add a price in Settings or use a local provider.`,
    );
  }
  const amountUsd = input.units * price.unitPriceUsd;
  const amountMicroUsd = usdToMicros(amountUsd);
  const amountPaise = usdToPaise(
    amountUsd,
    input.settings.usdToInrRate,
    input.settings.taxPercent,
    input.settings.feePercent,
  );

  await ctx.db.usageRecord.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      jobId: input.jobId,
      provider: input.provider,
      category: input.category,
      model: input.model ?? null,
      costType: "ACTUAL",
      estimatedCostMicroUsd: amountMicroUsd,
      actualCostMicroUsd: amountMicroUsd,
      estimatedCostInrPaise: amountPaise,
      actualCostInrPaise: amountPaise,
      inputUnits: input.usage?.inputUnits ?? input.units,
      outputUnits: input.usage?.outputUnits ?? null,
      unit: input.unit,
      providerRequestId: input.providerRequestId ?? null,
      metadata: toJsonValue({
        pricingSource: price.source,
        unitPriceUsd: price.unitPriceUsd,
        usdToInrRate: input.settings.usdToInrRate,
        taxPercent: input.settings.taxPercent,
        feePercent: input.settings.feePercent,
        actualSource: "units-x-price",
        ...input.metadata,
      }),
    },
  });

  if (amountPaise > 0) {
    await ctx.db.generationJob.update({
      where: { id: input.jobId },
      data: { actualCostInrPaise: { increment: amountPaise } },
    });
    await ctx.db.project.update({
      where: { id: input.projectId },
      data: { actualCostInrPaise: { increment: amountPaise } },
    });
  }

  if (input.enforcePerVideoLimit !== false) {
    await enforcePerVideoLimit(ctx, {
      jobId: input.jobId,
      userId: input.userId,
      provider: input.provider,
      model: input.model,
      limitInrPaise: input.settings.maxCostPerVideoInrPaise ?? 0,
    });
  }
  return amountPaise;
}

/**
 * Runs after each recorded charge. Alerts as the job approaches the per-video
 * limit and stops the job once it crosses it, so a runaway loop cannot keep
 * spending on a single video.
 */
export async function enforcePerVideoLimit(
  ctx: Context,
  input: {
    jobId: string;
    userId: string;
    provider: string;
    model?: string;
    limitInrPaise?: number | null;
    warnPercent?: number;
  },
): Promise<JobCostSnapshot | null> {
  const limit = input.limitInrPaise ?? 0;
  if (!limit || limit <= 0) return null;
  const warnPercent = input.warnPercent ?? PER_VIDEO_WARN_PERCENT;
  const snapshot = await getJobCostSnapshot(ctx, input.jobId, limit, warnPercent);

  if (snapshot.level === "exceeded") {
    ctx.logger.error(
      {
        jobId: input.jobId,
        userId: input.userId,
        provider: input.provider,
        model: input.model,
        spentInrPaise: snapshot.spentInrPaise,
        limitInrPaise: limit,
      },
      "per-video cost limit exceeded; stopping the job before more spend",
    );
    throw new BudgetError(
      "PER_VIDEO_COST_LIMIT",
      `This video reached ${formatInrPaise(snapshot.spentInrPaise)}, above the ${formatInrPaise(limit)} per-video limit. Raise the limit or switch this project to cheaper/free providers before retrying.`,
      {
        spentInrPaise: snapshot.spentInrPaise,
        limitInrPaise: limit,
      },
    );
  }

  if (snapshot.level === "warning") {
    ctx.logger.warn(
      {
        jobId: input.jobId,
        provider: input.provider,
        spentInrPaise: snapshot.spentInrPaise,
        limitInrPaise: limit,
        percentUsed: Math.round(snapshot.percentUsed),
      },
      "per-video cost is approaching the configured limit",
    );
  }

  return snapshot;
}

export async function trackedProviderCall<T>(
  ctx: Context,
  input: {
    userId: string;
    projectId: string;
    jobId: string;
    provider: string;
    model?: string;
    category: ProviderCategory;
    idempotencyKey: string;
    request: Record<string, unknown>;
    isPaid: boolean;
  },
  call: () => Promise<T>,
): Promise<T> {
  if (!input.isPaid) {
    return call();
  }

  const key = hashCacheKey({
    ...input.request,
    jobId: input.jobId,
    provider: input.provider,
    model: input.model,
    idempotencyKey: input.idempotencyKey,
  });

  const existing = await ctx.db.providerRequest.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: key,
      },
    },
  });
  if (existing) {
    if (existing.status === "FAILED") {
      await ctx.db.providerRequest.update({
        where: { id: existing.id },
        data: {
          status: "SUBMITTED",
          errorCode: null,
          errorMessage: null,
        },
      });
    } else if (existing.status === "COMPLETED") {
      throw new ProviderError(
        "PROVIDER_ALREADY_COMPLETED",
        "This paid request already completed. Reuse the saved result or reconcile manually instead of resubmitting.",
        {
          provider: input.provider,
          kind: "PROVIDER_UNKNOWN_OUTCOME",
          requestId: existing.providerRequestId ?? undefined,
        },
      );
    } else {
      throw new ProviderError(
        "PROVIDER_OUTCOME_UNKNOWN",
        `A previous ${input.provider} request is still ${existing.status.toLowerCase()}. Check the provider dashboard before retrying; the app will not resubmit automatically.`,
        {
          provider: input.provider,
          kind: "PROVIDER_UNKNOWN_OUTCOME",
          requestId: existing.providerRequestId ?? undefined,
        },
      );
    }
  }

  const request = existing
    ? await ctx.db.providerRequest.update({
        where: { id: existing.id },
        data: { status: "SUBMITTED", request: toJsonValue(input.request) },
      })
    : await ctx.db.providerRequest.create({
        data: {
          userId: input.userId,
          projectId: input.projectId,
          jobId: input.jobId,
          provider: input.provider,
          model: input.model ?? null,
          category: input.category,
          idempotencyKey: key,
          status: "SUBMITTED",
          request: toJsonValue(input.request),
        },
      });

  try {
    const result = await call();
    const requestId = (result as { requestId?: string } | null)?.requestId;
    await ctx.db.providerRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        providerRequestId: requestId ?? null,
        response: toJsonValue({ requestId: requestId ?? null }),
      },
    });
    return result;
  } catch (error) {
    const kind =
      error instanceof ProviderError ? error.kind : "PROVIDER_PERMANENT";
    const unknown = kind === "PROVIDER_UNKNOWN_OUTCOME";
    await ctx.db.providerRequest.update({
      where: { id: request.id },
      data: {
        status: unknown ? "UNKNOWN" : "FAILED",
        providerRequestId:
          error instanceof ProviderError
            ? error.requestId ?? null
            : undefined,
        errorCode:
          error instanceof ProviderError ? error.code : "PROVIDER_ERROR",
        errorMessage:
          error instanceof Error ? error.message.slice(0, 2000) : String(error),
      },
    });
    throw error;
  }
}

/**
 * Paid provider calls routed through the persisted request ledger. A retry of
 * the same job that reuses an identical request either returns the completed
 * result id or raises an unknown-outcome error instead of silently paying twice.
 */
export async function trackedPaidCall<T>(
  ctx: Context,
  input: {
    userId: string;
    projectId: string;
    jobId: string;
    provider: string;
    model?: string;
    category: ProviderCategory;
    idempotencyKey: string;
    request: Record<string, unknown>;
  },
  call: () => Promise<T>,
): Promise<T> {
  return trackedProviderCall(
    ctx,
    { ...input, isPaid: isPaidProvider(input.provider) },
    call,
  );
}

export async function reconcileProviderRequest(
  ctx: Context,
  userId: string,
  requestId: string,
): Promise<{
  status: string;
  providerRequestId?: string | null;
}> {
  const record = await ctx.db.providerRequest.findFirst({
    where: { id: requestId, userId },
  });
  if (!record) {
    throw new ProviderError("PROVIDER_REQUEST_NOT_FOUND", "Provider request not found", {
      provider: "unknown",
    });
  }
  return {
    status: record.status,
    providerRequestId: record.providerRequestId,
  };
}
