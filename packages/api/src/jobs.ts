export type JobKind = "generation" | "publishing";

export type EnqueueResult = {
  bullJobId?: string;
};

export type JobDispatcher = {
  enqueueGeneration(
    jobId: string,
    options?: { delayMs?: number; attempts?: number },
  ): Promise<EnqueueResult>;
  enqueuePublishing(
    jobId: string,
    options?: { delayMs?: number; attempts?: number },
  ): Promise<EnqueueResult>;
  cancelQueued(kind: JobKind, bullJobId: string): Promise<void>;
};

export function createNoopDispatcher(): JobDispatcher {
  return {
    async enqueueGeneration() {
      throw new Error("Job queue is not configured");
    },
    async enqueuePublishing() {
      throw new Error("Job queue is not configured");
    },
    async cancelQueued() {
      throw new Error("Job queue is not configured");
    },
  };
}
