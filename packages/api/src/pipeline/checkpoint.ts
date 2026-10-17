export type StepLike = {
  type: string;
  attempt: number;
  status: string;
  output?: unknown;
};

export function latestStepsByType<T extends StepLike>(steps: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const step of steps) {
    const current = latest.get(step.type);
    if (!current || step.attempt >= current.attempt) {
      latest.set(step.type, step);
    }
  }
  return latest;
}

export function isReusableStepStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "SKIPPED";
}
