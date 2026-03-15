// ---------------------------------------------------------------------------
// Custom error types for the Canton Rebalancer backend
// ---------------------------------------------------------------------------

/**
 * Base application error with structured fields for API responses.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Errors originating from the Canton JSON Ledger API.
 */
export class LedgerError extends AppError {
  constructor(
    message: string,
    public readonly ledgerStatus?: number,
  ) {
    super(message, 'LEDGER_ERROR', 502, true);
    this.name = 'LedgerError';
  }
}

/**
 * Errors originating from the Cantex DEX (Python bridge or HTTP API).
 */
export class CantexError extends AppError {
  constructor(message: string) {
    super(message, 'CANTEX_ERROR', 502, true);
    this.name = 'CantexError';
  }
}

/**
 * Request validation errors (bad input from the client).
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}

/**
 * Rate limit exceeded.
 */
export class RateLimitError extends AppError {
  constructor() {
    super('Too many requests', 'RATE_LIMIT', 429, false);
    this.name = 'RateLimitError';
  }
}

/**
 * A circuit breaker is open — the downstream service is considered unavailable.
 */
export class CircuitOpenError extends AppError {
  constructor(service: string) {
    super(`Service unavailable: ${service}`, 'CIRCUIT_OPEN', 503, true);
    this.name = 'CircuitOpenError';
  }
}
