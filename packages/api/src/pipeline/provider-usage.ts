import type { ProviderCategory } from "@video-generator/db";

import type { Context } from "../context";
import { BudgetError, ProviderError } from "../lib/errors";
import { hashCacheKey } from "../lib/hash";
import { toJsonValue } from "../lib/json";
import { usdToMicros, usdToPaise } from "../lib/money";
import { getBudgetStatus } from "../services/budget";
import { getUnitPrice } from "../services/pricing";
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

export async function guardPaidCall(
  ctx: Context,
  userId: string,
  provider: string,
  category: ProviderCategory,
  model?: string,
  unit?: string,
  quoteInputs?: Record<string, unknown>,
): Promise<void> {
  if (FREE_PROVIDERS.has(provider)) return;
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
  }
  const budget = await getBudgetStatus(ctx, userId);
  if (budget.spendableInrPaise <= 0) {
    throw new BudgetError(
      "BUDGET_EXHAUSTED",
      "The available budget is exhausted. Switch to local/free providers or raise the monthly budget.",
    );
  }
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
    };
    metadata?: Record<string, unknown>;
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
  return amountPaise;
}

export async function trackedProviderCall<T extends { requestId?: string }>(
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
    await ctx.db.providerRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        providerRequestId: result.requestId ?? null,
        response: toJsonValue({ requestId: result.requestId ?? null }),
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
