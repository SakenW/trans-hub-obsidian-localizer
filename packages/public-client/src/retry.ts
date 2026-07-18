import { normalizeError, type PublicClientError, publicClientError } from "./errors.js";
import type { ClockPort, RandomNoncePort } from "./ports.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  jitterRatio: 0.2,
});

export function validateRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 8 ||
    !Number.isFinite(policy.baseDelayMs) ||
    policy.baseDelayMs < 0 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs ||
    policy.maxDelayMs > 60_000 ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  ) {
    throw publicClientError("PC_CONFIGURATION", "Retry policy is outside the supported bounds", {
      operation: "configure",
    });
  }
  return Object.freeze({ ...policy });
}

function retryDelay(policy: RetryPolicy, attempt: number, random: RandomNoncePort): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const unit = random.unitInterval();
  if (!Number.isFinite(unit) || unit < 0 || unit > 1) {
    throw publicClientError("PC_CONFIGURATION", "Random port returned an invalid unit value", {
      operation: "retry",
    });
  }
  const jitter = exponential * policy.jitterRatio * (unit * 2 - 1);
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(exponential + jitter)));
}

export async function withRetry<T>(input: {
  readonly operation: string;
  readonly retryableOperation: boolean;
  readonly policy: RetryPolicy;
  readonly clock: ClockPort;
  readonly random: RandomNoncePort;
  readonly signal?: AbortSignal;
  readonly run: (attempt: number) => Promise<T>;
}): Promise<T> {
  let latest: PublicClientError | null = null;
  for (let attempt = 1; attempt <= input.policy.maxAttempts; attempt += 1) {
    if (input.signal?.aborted === true) {
      throw publicClientError("PC_ABORTED", "The operation was cancelled", {
        operation: input.operation,
        attempt,
      });
    }
    try {
      return await input.run(attempt);
    } catch (error) {
      latest = normalizeError(error, input.operation);
      if (
        !input.retryableOperation ||
        !latest.retryable ||
        attempt >= input.policy.maxAttempts ||
        latest.code === "PC_ABORTED"
      ) {
        break;
      }
      try {
        await input.clock.sleep(retryDelay(input.policy, attempt, input.random), input.signal);
      } catch (error) {
        throw normalizeError(error, input.operation);
      }
    }
  }
  if (latest === null) {
    throw publicClientError("PC_RETRY_EXHAUSTED", "The operation did not run", {
      operation: input.operation,
    });
  }
  if (!input.retryableOperation || !latest.retryable || latest.code === "PC_ABORTED") throw latest;
  throw publicClientError(
    "PC_RETRY_EXHAUSTED",
    "The bounded retry budget was exhausted",
    { operation: input.operation, attempt: input.policy.maxAttempts },
    { cause: latest }
  );
}
