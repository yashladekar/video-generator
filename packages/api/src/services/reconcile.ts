import type { Context } from "../context";
import { NotFoundError } from "../lib/errors";
import { toJsonValue } from "../lib/json";
import { resolveProviderChain } from "../providers/resolve";
import {
  getFalRequestStatus,
} from "../providers/visual/fal";
import { getWaveSpeedStatus } from "../providers/visual/wavespeed";

export async function reconcileJob(
  ctx: Context,
  userId: string,
  jobId: string,
) {
  const job = await ctx.db.generationJob.findFirst({
    where: { id: jobId, userId },
    include: { providerRequests: true },
  });
  if (!job) throw new NotFoundError("Generation job not found");

  const results: Array<{
    id: string;
    provider: string;
    status: string;
    providerRequestId: string | null;
    message: string;
  }> = [];

  for (const record of job.providerRequests) {
    if (!record.providerRequestId) {
      results.push({
        id: record.id,
        provider: record.provider,
        status: record.status,
        providerRequestId: null,
        message: "No provider request id was stored; check the provider dashboard manually.",
      });
      continue;
    }
    if (!["UNKNOWN", "SUBMITTED", "IN_PROGRESS"].includes(record.status)) {
      results.push({
        id: record.id,
        provider: record.provider,
        status: record.status,
        providerRequestId: record.providerRequestId,
        message: "Already reconciled.",
      });
      continue;
    }

    try {
      const chain = await resolveProviderChain(
        ctx,
        userId,
        record.category,
        record.provider,
      );
      const resolved = chain.find((entry) => entry.provider === record.provider);
      if (!resolved) {
        results.push({
          id: record.id,
          provider: record.provider,
          status: record.status,
          providerRequestId: record.providerRequestId,
          message: "Provider is no longer configured.",
        });
        continue;
      }
      const callCtx = {
        env: ctx.env,
        signal: AbortSignal.timeout(45_000),
        logger: ctx.logger,
        userId,
      };
      if (record.provider === "fal") {
        const model =
          record.model ??
          (typeof resolved.config.model === "string"
            ? resolved.config.model
            : "");
        if (!model) {
          throw new Error("No model is stored for this fal request");
        }
        const status = await getFalRequestStatus(
          model,
          record.providerRequestId,
          resolved,
          callCtx,
        );
        const nextStatus =
          status.status === "COMPLETED"
            ? "COMPLETED"
            : status.status === "FAILED"
              ? "FAILED"
              : "IN_PROGRESS";
        await ctx.db.providerRequest.update({
          where: { id: record.id },
          data: {
            status: nextStatus,
            response: toJsonValue({ reconciled: status }),
          },
        });
        results.push({
          id: record.id,
          provider: record.provider,
          status: nextStatus,
          providerRequestId: record.providerRequestId,
          message:
            nextStatus === "COMPLETED"
              ? "The provider reports this request completed. The app will not automatically resubmit it."
              : `Provider status: ${status.status}.`,
        });
      } else if (record.provider === "wavespeed") {
        const status = await getWaveSpeedStatus(
          record.providerRequestId,
          resolved,
          callCtx,
        );
        const nextStatus =
          status.status === "completed"
            ? "COMPLETED"
            : status.status === "failed" ||
                status.status === "cancelled" ||
                status.status === "timeout" ||
                status.status === "deleted"
              ? "FAILED"
              : "IN_PROGRESS";
        await ctx.db.providerRequest.update({
          where: { id: record.id },
          data: {
            status: nextStatus,
            response: toJsonValue({ reconciled: status.status }),
          },
        });
        results.push({
          id: record.id,
          provider: record.provider,
          status: nextStatus,
          providerRequestId: record.providerRequestId,
          message: `WaveSpeedAI status: ${status.status}.`,
        });
      } else {
        results.push({
          id: record.id,
          provider: record.provider,
          status: record.status,
          providerRequestId: record.providerRequestId,
          message:
            "Automatic reconciliation is only implemented for fal.ai and WaveSpeedAI. Check the provider dashboard manually.",
        });
      }
    } catch (error) {
      results.push({
        id: record.id,
        provider: record.provider,
        status: record.status,
        providerRequestId: record.providerRequestId,
        message:
          error instanceof Error
            ? error.message
            : "Could not query the provider",
      });
    }
  }

  await ctx.db.generationJob.update({
    where: { id: job.id },
    data: {
      errorCode: "RECONCILIATION_CHECKED",
      errorMessage:
        "Provider requests were checked. Review the reconciliation results before retrying; the app does not resubmit unknown paid requests automatically.",
    },
  });

  return {
    jobId: job.id,
    results,
    note:
      "Reconciliation is informational. If a provider reports completion, do not resubmit the same paid call; reuse the provider result or contact the provider.",
  };
}
