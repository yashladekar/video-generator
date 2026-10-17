import { Queue } from "bullmq";
import IORedis from "ioredis";

import type { EnqueueResult, JobDispatcher } from "@video-generator/api/jobs";

import { ENV } from "./env.server";
import { logger } from "./services";

export const redis = new IORedis(ENV.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

export const generationQueue = new Queue("generation", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { age: 60 * 60, count: 200 },
    removeOnFail: { age: 24 * 60 * 60, count: 200 },
    backoff: { type: "exponential", delay: 5_000 },
  },
});

export const publishingQueue = new Queue("publishing", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { age: 60 * 60, count: 200 },
    removeOnFail: { age: 24 * 60 * 60, count: 200 },
    backoff: { type: "exponential", delay: 10_000 },
  },
});

export const dispatcher: JobDispatcher = {
  async enqueueGeneration(jobId, options): Promise<EnqueueResult> {
    const job = await generationQueue.add(
      "generate",
      { jobId },
      {
        jobId: `${jobId}-${Date.now()}`,
        attempts: Math.max(1, options?.attempts ?? 1),
        delay: options?.delayMs,
      },
    );
    logger.info({ jobId, bullJobId: job.id }, "enqueued generation job");
    return { bullJobId: job.id };
  },
  async enqueuePublishing(jobId, options): Promise<EnqueueResult> {
    const job = await publishingQueue.add(
      "publish",
      { jobId },
      {
        jobId: `${jobId}-${Date.now()}`,
        attempts: Math.max(1, options?.attempts ?? 1),
        delay: options?.delayMs,
      },
    );
    logger.info({ jobId, bullJobId: job.id }, "enqueued publishing job");
    return { bullJobId: job.id };
  },
  async cancelQueued(kind, bullJobId) {
    const queue = kind === "generation" ? generationQueue : publishingQueue;
    const job = await queue.getJob(bullJobId);
    if (job) {
      await job.remove().catch((error) => {
        logger.warn({ bullJobId, error }, "could not remove queued job");
      });
    }
  },
};

export function createWorkerConnection(): IORedis {
  return new IORedis(ENV.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([generationQueue.close(), publishingQueue.close()]);
  await redis.quit().catch(() => undefined);
}
