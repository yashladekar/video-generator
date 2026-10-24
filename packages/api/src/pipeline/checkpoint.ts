export type StepLike = {
  type: string;
  attempt: number;
  status: string;
  output?: unknown;
};

export const PAID_STEP_TYPES = new Set([
  "RESEARCH",
  "SCRIPT",
  "NARRATION",
  "VISUALS",
  "AI_VIDEO",
]);

export const LOCAL_ONLY_STEP_TYPES = new Set([
  "VALIDATE",
  "SCENES",
  "SUBTITLES",
  "MUSIC",
  "RENDER",
  "VALIDATE_OUTPUT",
  "FINALIZE",
]);

const NON_REPLAYABLE_STATUSES = new Set(["SUCCEEDED", "SKIPPED"]);

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

export function isPaidStepType(type: string): boolean {
  return PAID_STEP_TYPES.has(type);
}

export function isLocalOnlyStepType(type: string): boolean {
  return LOCAL_ONLY_STEP_TYPES.has(type);
}

/**
 * Highest attempt of a step type that already produced a durable artifact.
 * Provider steps use this so a retry that follows a failure never pays twice
 * for work the pipeline already completed.
 */
export function reusableStepFor<T extends StepLike>(
  steps: T[],
  type: string,
): T | undefined {
  let best: T | undefined;
  for (const step of steps) {
    if (step.type !== type) continue;
    if (!NON_REPLAYABLE_STATUSES.has(step.status)) continue;
    if (!best || step.attempt > best.attempt) best = step;
  }
  return best;
}

export function reusableOutputFor<T extends StepLike>(
  steps: T[],
  type: string,
): unknown {
  return reusableStepFor(steps, type)?.output;
}

/**
 * Steps whose latest attempt is still marked RUNNING. A crash mid-call leaves
 * the provider outcome unknown, so these must be reconciled rather than called
 * again.
 */
export function interruptedStepTypes<T extends StepLike>(steps: T[]): string[] {
  return [...latestStepsByType(steps).values()]
    .filter((step) => step.status === "RUNNING")
    .map((step) => step.type);
}

export type ResumePlan = {
  reusableTypes: string[];
  pendingTypes: string[];
  resumeFrom: string | undefined;
  resumeIndex: number;
  paidStepsReused: string[];
  paidStepsPending: string[];
  paidStepsRecovered: string[];
  interruptedPaidSteps: string[];
  requiresPaidReplay: boolean;
};

/**
 * Plans a resume across an ordered step list. Paid steps that already succeeded
 * are reported as reused so the runner can prove no provider call is repeated.
 */
export function planJobResume<T extends StepLike>(
  steps: T[],
  expectedOrder: string[],
): ResumePlan {
  const latest = latestStepsByType(steps);
  const reusableTypes: string[] = [];
  const pendingTypes: string[] = [];
  const paidStepsReused: string[] = [];
  const paidStepsPending: string[] = [];
  const paidStepsRecovered: string[] = [];

  for (const type of expectedOrder) {
    const step = latest.get(type);
    const reusable = reusableStepFor(steps, type);
    if (step && isReusableStepStatus(step.status)) {
      reusableTypes.push(type);
      if (isPaidStepType(type)) paidStepsReused.push(type);
      continue;
    }
    if (reusable) {
      reusableTypes.push(type);
      if (isPaidStepType(type)) {
        paidStepsReused.push(type);
        paidStepsRecovered.push(type);
      }
      continue;
    }
    pendingTypes.push(type);
    if (isPaidStepType(type)) paidStepsPending.push(type);
  }

  const resumeIndex = expectedOrder.findIndex((type) =>
    pendingTypes.includes(type),
  );
  const interrupted = interruptedStepTypes(steps);
  const interruptedPaidSteps = interrupted.filter((type) =>
    isPaidStepType(type),
  );

  return {
    reusableTypes,
    pendingTypes,
    resumeFrom: resumeIndex >= 0 ? expectedOrder[resumeIndex] : undefined,
    resumeIndex,
    paidStepsReused,
    paidStepsPending,
    paidStepsRecovered,
    interruptedPaidSteps,
    requiresPaidReplay: paidStepsPending.length > 0,
  };
}

/**
 * Render-only retries must never touch a provider step. Returns the step types
 * that would violate that boundary.
 */
export function renderOnlyViolations(
  steps: StepLike[],
  renderOrder: string[],
): string[] {
  const allowed = new Set(renderOrder);
  return [...latestStepsByType(steps).values()]
    .filter((step) => !allowed.has(step.type))
    .filter((step) => !isReusableStepStatus(step.status))
    .map((step) => step.type);
}
