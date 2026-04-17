// ---------------------------------------------------------------------------
// Circuit Breaker pattern for external service calls
//
// State evaluation is a single synchronous block to avoid read-modify-write
// races across `await` boundaries. Half-open admits one probe at a time;
// concurrent callers are treated as "open". A monotonic `generation` counter
// ensures that stale completions (probes whose state has already advanced
// past them) cannot corrupt the current state.
// ---------------------------------------------------------------------------

import { logger } from '../monitoring/logger.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens (default: 5) */
  failureThreshold: number;
  /** Time in ms to wait before transitioning from open to half-open (default: 30000) */
  resetTimeoutMs: number;
  /** Number of consecutive successes in half-open state to close the circuit (default: 2) */
  successThreshold: number;
  /** Name used in log messages and errors */
  name: string;
}

const DEFAULT_OPTIONS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
}

type AdmitDecision =
  | { action: 'pass'; generation: number }
  | { action: 'probe'; generation: number }
  | { action: 'reject' };

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private probeInFlight = false;
  /** Monotonic counter that increments on every state transition. */
  private generation = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> & { name: string }) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * - **closed**: Calls pass through normally. Failures increment the counter.
   *   Once failureThreshold is reached, the circuit transitions to **open**.
   * - **open**: Calls are rejected immediately with an error.
   *   After resetTimeoutMs, the circuit transitions to **half-open**.
   * - **half-open**: A single probe call passes through. Successes increment a
   *   counter; once successThreshold is reached the circuit **closes**. A
   *   single failure re-opens the circuit. Concurrent callers during a probe
   *   are rejected as "open".
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const decision = this.admit();

    if (decision.action === 'reject') {
      throw new Error(
        `Circuit breaker [${this.options.name}] is OPEN — rejecting call`,
      );
    }

    try {
      const result = await fn();
      this.onSuccess(decision);
      return result;
    } catch (err) {
      this.onFailure(decision);
      throw err;
    }
  }

  /** Return the current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Return diagnostic stats. */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failureCount,
      successes: this.successCount,
    };
  }

  /** Force-reset the breaker to its initial closed state. */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.probeInFlight = false;
    this.generation++;
    logger.info(`[circuit-breaker] [${this.options.name}] Manually reset to CLOSED`);
  }

  // -------------------------------------------------------------------------
  // Internal state transitions — all synchronous, no awaits
  // -------------------------------------------------------------------------

  /** Atomically evaluate state and decide whether to admit the call. */
  private admit(): AdmitDecision {
    if (this.state === 'closed') {
      return { action: 'pass', generation: this.generation };
    }

    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.options.resetTimeoutMs) {
        return { action: 'reject' };
      }
      // Cooldown elapsed — move to half-open and admit this call as the probe.
      this.generation++;
      this.state = 'half-open';
      this.successCount = 0;
      this.probeInFlight = true;
      logger.info(
        `[circuit-breaker] [${this.options.name}] OPEN -> HALF-OPEN (probe gen ${this.generation})`,
      );
      return { action: 'probe', generation: this.generation };
    }

    // state === 'half-open'
    if (this.probeInFlight) {
      // Another probe is already running — treat as open for concurrent callers.
      return { action: 'reject' };
    }
    this.probeInFlight = true;
    return { action: 'probe', generation: this.generation };
  }

  private onSuccess(decision: AdmitDecision): void {
    if (decision.action === 'reject') return;

    // Ignore completions from a prior generation (stale probe).
    if (decision.generation !== this.generation) return;

    if (decision.action === 'probe') {
      this.probeInFlight = false;
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.generation++;
        logger.info(
          `[circuit-breaker] [${this.options.name}] HALF-OPEN -> CLOSED (${this.successCount} consecutive successes)`,
        );
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
      return;
    }

    // closed path
    this.failureCount = 0;
  }

  private onFailure(decision: AdmitDecision): void {
    if (decision.action === 'reject') return;

    // Ignore completions from a prior generation (stale probe).
    if (decision.generation !== this.generation) return;

    this.lastFailureTime = Date.now();

    if (decision.action === 'probe') {
      // Any failure during the probe immediately re-opens the circuit.
      this.generation++;
      this.probeInFlight = false;
      logger.warn(
        `[circuit-breaker] [${this.options.name}] HALF-OPEN -> OPEN (failure during probe)`,
      );
      this.state = 'open';
      this.failureCount = this.options.failureThreshold;
      this.successCount = 0;
      return;
    }

    // closed path
    this.failureCount++;
    if (this.failureCount >= this.options.failureThreshold) {
      this.generation++;
      logger.warn(
        `[circuit-breaker] [${this.options.name}] CLOSED -> OPEN (${this.failureCount} consecutive failures)`,
      );
      this.state = 'open';
      this.successCount = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-configured circuit breakers for external services
// ---------------------------------------------------------------------------

/** Circuit breaker for Canton Ledger API calls */
export const ledgerBreaker = new CircuitBreaker({
  name: 'Canton Ledger',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
});

/** Circuit breaker for Cantex DEX calls (shorter threshold, longer reset) */
export const cantexBreaker = new CircuitBreaker({
  name: 'Cantex DEX',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  successThreshold: 2,
});
