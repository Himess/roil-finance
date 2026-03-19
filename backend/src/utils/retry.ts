// ---------------------------------------------------------------------------
// Retry utility with exponential backoff and jitter
// ---------------------------------------------------------------------------

import { logger } from '../monitoring/logger.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds before first retry (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 10000) */
  maxDelayMs: number;
  /** Multiplier applied to delay after each attempt (default: 2) */
  backoffMultiplier: number;
  /** If provided, only retry when the error message includes one of these strings */
  retryableErrors?: string[];
  /** Callback invoked before each retry attempt */
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Execute an async function with exponential backoff retry logic.
 *
 * Delay formula: min(baseDelay * multiplier^attempt + jitter, maxDelay)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check whether the error is retryable
      if (opts.retryableErrors && opts.retryableErrors.length > 0) {
        const isRetryable = opts.retryableErrors.some((msg) =>
          lastError!.message.includes(msg),
        );
        if (!isRetryable) {
          throw lastError;
        }
      }

      // If we've exhausted retries, throw
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Notify listener
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, lastError);
      }

      // Calculate delay with jitter
      const exponentialDelay =
        opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt);
      const jitter = Math.random() * opts.baseDelayMs * 0.5;
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelayMs);

      logger.warn(
        `[retry] Attempt ${attempt + 1}/${opts.maxRetries} failed: ${lastError.message}. Retrying in ${Math.round(delay)}ms...`,
      );

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Decorator-style wrapper for class methods.
 *
 * Usage:
 *   class MyService {
 *     @retryable({ maxRetries: 2 })
 *     async fetchData() { ... }
 *   }
 */
export function retryable(options?: Partial<RetryOptions>) {
  return function (
    _target: unknown,
    key: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return withRetry(
        () => originalMethod.apply(this, args),
        { ...options, onRetry: options?.onRetry ?? ((attempt, error) => {
          logger.warn(`[retry] ${key} attempt ${attempt} failed: ${error.message}`);
        })},
      );
    };

    return descriptor;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
