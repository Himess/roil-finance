// ---------------------------------------------------------------------------
// Circuit Breaker pattern for external service calls
// ---------------------------------------------------------------------------

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

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
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
   * - **half-open**: Calls pass through. Successes increment a counter; once
   *   successThreshold is reached the circuit **closes**. A single failure
   *   re-opens the circuit.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        console.log(
          `[circuit-breaker] [${this.options.name}] Transitioning from OPEN to HALF-OPEN`,
        );
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        throw new Error(
          `Circuit breaker [${this.options.name}] is OPEN — rejecting call`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
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
    console.log(`[circuit-breaker] [${this.options.name}] Manually reset to CLOSED`);
  }

  // -------------------------------------------------------------------------
  // Internal state transitions
  // -------------------------------------------------------------------------

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        console.log(
          `[circuit-breaker] [${this.options.name}] HALF-OPEN -> CLOSED (${this.successCount} consecutive successes)`,
        );
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === 'closed') {
      // Reset failure counter on any success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open immediately re-opens the circuit
      console.log(
        `[circuit-breaker] [${this.options.name}] HALF-OPEN -> OPEN (failure during probe)`,
      );
      this.state = 'open';
      this.failureCount = this.options.failureThreshold; // keep at threshold
      this.successCount = 0;
    } else if (this.state === 'closed') {
      this.failureCount++;
      if (this.failureCount >= this.options.failureThreshold) {
        console.log(
          `[circuit-breaker] [${this.options.name}] CLOSED -> OPEN (${this.failureCount} consecutive failures)`,
        );
        this.state = 'open';
        this.successCount = 0;
      }
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
