import { TRPCError } from "@trpc/server";

export type ErrorKind =
  | "VALIDATION"
  | "AUTH"
  | "NOT_FOUND"
  | "BUDGET"
  | "PROVIDER_TRANSIENT"
  | "PROVIDER_PERMANENT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNKNOWN_OUTCOME"
  | "CANCELLED"
  | "MEDIA"
  | "PUBLISHING"
  | "INTERNAL";

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    kind: ErrorKind,
    code: string,
    message: string,
    options?: { details?: unknown; retryable?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.kind = kind;
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", "VALIDATION_ERROR", message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", "NOT_FOUND", message);
  }
}

export class BudgetError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super("BUDGET", code, message, { details });
  }
}

export class CancelledError extends AppError {
  constructor(message = "Job cancelled") {
    super("CANCELLED", "JOB_CANCELLED", message);
  }
}

export class MediaError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super("MEDIA", code, message, { details });
  }
}

export class PublishingError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super("PUBLISHING", code, message, { details });
  }
}

export class ProviderError extends AppError {
  readonly provider?: string;
  readonly status?: number;
  readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    options?: {
      kind?: Extract<
        ErrorKind,
        | "PROVIDER_TRANSIENT"
        | "PROVIDER_PERMANENT"
        | "PROVIDER_RATE_LIMIT"
        | "PROVIDER_UNKNOWN_OUTCOME"
      >;
      provider?: string;
      status?: number;
      requestId?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    const kind = options?.kind ?? "PROVIDER_PERMANENT";
    super(kind, code, message, {
      details: options?.details,
      retryable:
        kind === "PROVIDER_TRANSIENT" || kind === "PROVIDER_RATE_LIMIT",
      cause: options?.cause,
    });
    this.provider = options?.provider;
    this.status = options?.status;
    this.requestId = options?.requestId;
  }
}

export function providerErrorFromStatus(
  provider: string,
  status: number,
  message: string,
  requestId?: string,
): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("PROVIDER_AUTH", message, {
      kind: "PROVIDER_PERMANENT",
      provider,
      status,
      requestId,
    });
  }
  if (status === 429) {
    return new ProviderError("PROVIDER_RATE_LIMIT", message, {
      kind: "PROVIDER_RATE_LIMIT",
      provider,
      status,
      requestId,
    });
  }
  if (status >= 500) {
    return new ProviderError("PROVIDER_UNAVAILABLE", message, {
      kind: requestId ? "PROVIDER_UNKNOWN_OUTCOME" : "PROVIDER_TRANSIENT",
      provider,
      status,
      requestId,
    });
  }
  return new ProviderError("PROVIDER_ERROR", message, {
    kind: "PROVIDER_PERMANENT",
    provider,
    status,
    requestId,
  });
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError;
}

export function isRetryable(error: unknown): boolean {
  return error instanceof AppError && error.retryable;
}

export function toPublicError(error: unknown): {
  code: string;
  message: string;
  kind: ErrorKind;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      kind: error.kind,
      details: error.details,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    kind: "INTERNAL",
  };
}

export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof AppError) {
    const code =
      error.kind === "AUTH"
        ? "UNAUTHORIZED"
        : error.kind === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.kind === "BUDGET"
            ? "PRECONDITION_FAILED"
            : error.kind === "VALIDATION"
              ? "BAD_REQUEST"
              : error.kind === "PROVIDER_RATE_LIMIT"
                ? "TOO_MANY_REQUESTS"
                : error.kind === "CANCELLED"
                  ? "CONFLICT"
                  : "INTERNAL_SERVER_ERROR";
    return new TRPCError({
      code,
      message: error.message,
      cause: error,
    });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    cause: error,
  });
}
