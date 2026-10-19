import { Worker } from "bullmq";

import { runGenerationJob } from "@video-generator/api/pipeline/runner";
import { runPublishingJob } from "@video-generator/api/publishing/runner";
import { runRetentionCleanup } from "@video-generator/api/services/retention";

import { createWorkerContext } from "./context";
import { ENV } from "./env.server";
import { createWorkerConnection, redis } from "./queue";
import { db, logger } from "./services";

const concurrency = Math.max(1, Number(ENV.WORKER_CONCURRENCY ?? 1));

const generationWorker = new Worker(
  "generation",
  async (job) => {
    const jobId = job.data?.jobId as string | undefined;
    if (!jobId) throw new Error("Generation job data is missing jobId");
    await runGenerationJob({
      ctx: createWorkerContext(jobId),
      jobId,
      signal: AbortSignal.timeout(45 * 60 * 1000),
    });
  },
  {
    connection: createWorkerConnection(),
    concurrency,
    lockDuration: 15 * 60 * 1000,
  },
);

const publishingWorker = new Worker(
  "publishing",
  async (job) => {
    const jobId = job.data?.jobId as string | undefined;
    if (!jobId) throw new Error("Publishing job data is missing jobId");
    await runPublishingJob({
      ctx: createWorkerContext(jobId),
      jobId,
    });
  },
  {
    connection: createWorkerConnection(),
    concurrency: Math.min(2, concurrency),
    lockDuration: 20 * 60 * 1000,
  },
);

generationWorker.on("completed", (job) => {
  logger.info({ bullJobId: job.id }, "generation job completed");
});
generationWorker.on("failed", (job, error) => {
  logger.error(
    { bullJobId: job?.id, error: error.message },
    "generation job failed",
  );
});
generationWorker.on("error", (error) => {
  logger.error({ error: error.message }, "generation worker error");
});

publishingWorker.on("completed", (job) => {
  logger.info({ bullJobId: job.id }, "publishing job completed");
});
publishingWorker.on("failed", (job, error) => {
  logger.error(
    { bullJobId: job?.id, error: error.message },
    "publishing job failed",
  );
});
publishingWorker.on("error", (error) => {
  logger.error({ error: error.message }, "publishing worker error");
});

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETENTION_LOCK_KEY = "retention:cleanup:lock";

async function runRetention() {
  try {
    const lock = await redis.set(
      RETENTION_LOCK_KEY,
      String(process.pid),
      "EX",
      60 * 60,
      "NX",
    );
    if (lock !== "OK") return;
    try {
      const result = await runRetentionCleanup(
        createWorkerContext("retention"),
      );
      logger.info(result, "retention cleanup completed");
    } finally {
      await redis.del(RETENTION_LOCK_KEY).catch(() => undefined);
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "retention cleanup failed",
    );
  }
}

const retentionTimer = setInterval(() => void runRetention(), RETENTION_INTERVAL_MS);
retentionTimer.unref();
void runRetention();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down worker");
  clearInterval(retentionTimer);
  await Promise.allSettled([
    generationWorker.close(),
    publishingWorker.close(),
    db.$disconnect(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logger.info(
  { concurrency },
  "worker started for generation and publishing queues",
);
