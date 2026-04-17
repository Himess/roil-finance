import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Idempotency key middleware
// ---------------------------------------------------------------------------
//
// Caches responses for POST/PUT requests that include an `Idempotency-Key`
// header. If the same key is seen again within the TTL window, the cached
// response is returned immediately without re-executing the handler.
//
// Concurrency model: a per-key in-flight promise lock ensures that two
// simultaneous requests with the same idempotency key do NOT both execute
// the handler — the second request waits for the first to complete, then
// receives the cached response. This prevents double-spend / double-submit
// under concurrent retries, not just sequential ones.
// ---------------------------------------------------------------------------

interface CachedResponse {
  status: number;
  body: any;
  timestamp: number;
}

const idempotencyCache = new Map<string, CachedResponse>();

// Per-key lock: resolves to the cached entry once the first request completes.
// While present, concurrent requests with the same key wait on this promise
// instead of executing the handler.
const inFlight = new Map<string, Promise<CachedResponse>>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_WAIT_MS = 60_000; // 60s maximum wait for concurrent in-flight request

// Cleanup old entries every hour to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of idempotencyCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      idempotencyCache.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

/**
 * Idempotency middleware for POST and PUT requests.
 *
 * When a request includes an `Idempotency-Key` header:
 *   1. If a cached response exists → return it immediately.
 *   2. If another request with the same key is in flight → wait for it,
 *      then return the same cached response.
 *   3. Otherwise → register an in-flight lock, run the handler, cache
 *      the response, and release the lock (so future duplicates hit
 *      step 1 or 2).
 *
 * Requests without the header pass through normally.
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to state-changing methods
  if (req.method !== 'POST' && req.method !== 'PUT') {
    next();
    return;
  }

  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  if (!idempotencyKey) {
    next();
    return;
  }

  // Fast path: cached response already exists
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    logger.info('Idempotency cache hit', { key: idempotencyKey });
    res.status(cached.status).json(cached.body);
    return;
  }

  // Concurrent path: another request with this key is already in flight
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    logger.info('Idempotency waiting on in-flight request', { key: idempotencyKey });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('idempotency-wait-timeout')), MAX_WAIT_MS).unref(),
    );
    Promise.race([pending, timeout])
      .then((entry) => {
        // Guard: client may have disconnected while we were waiting
        if (res.headersSent || res.destroyed) return;
        res.status(entry.status).json(entry.body);
      })
      .catch((err) => {
        if (res.headersSent || res.destroyed) return;
        logger.warn('Idempotency wait failed', {
          key: idempotencyKey,
          error: (err as Error).message,
        });
        res
          .status(503)
          .json({ success: false, error: 'Concurrent request timed out; retry with backoff' });
      });
    return;
  }

  // Primary path: claim the lock and run the handler
  let resolveLock!: (entry: CachedResponse) => void;
  let rejectLock!: (reason: unknown) => void;
  const lockPromise = new Promise<CachedResponse>((resolve, reject) => {
    resolveLock = resolve;
    rejectLock = reject;
  });
  inFlight.set(idempotencyKey, lockPromise);

  const releaseLock = (entry: CachedResponse | null, err?: unknown) => {
    inFlight.delete(idempotencyKey);
    if (entry) resolveLock(entry);
    else rejectLock(err ?? new Error('handler-failed-no-response'));
  };

  // Intercept res.json to cache the response and release the lock
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    const entry: CachedResponse = {
      status: res.statusCode,
      body,
      timestamp: Date.now(),
    };
    idempotencyCache.set(idempotencyKey, entry);
    releaseLock(entry);
    return originalJson(body);
  };

  // If the response is closed without json() being called (e.g. res.end or error),
  // release the lock so waiters don't hang until MAX_WAIT_MS.
  res.once('close', () => {
    if (inFlight.get(idempotencyKey) === lockPromise) {
      releaseLock(null, new Error('response-closed-without-body'));
    }
  });

  next();
}

/**
 * Reset internal idempotency cache.
 * @internal Test-only -- not intended for production use.
 */
export function _resetIdempotencyCache(): void {
  idempotencyCache.clear();
  inFlight.clear();
}
