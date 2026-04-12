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
// This prevents duplicate side-effects (e.g. double swaps, double DCA
// creation) when clients retry requests due to network issues.
// ---------------------------------------------------------------------------

interface CachedResponse {
  status: number;
  body: any;
  timestamp: number;
}

const idempotencyCache = new Map<string, CachedResponse>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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
 * When a request includes an `Idempotency-Key` header, the response is
 * cached. Subsequent requests with the same key return the cached response.
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

  // Check cache for existing response
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    logger.info('Idempotency cache hit', { key: idempotencyKey });
    res.status(cached.status).json(cached.body);
    return;
  }

  // Intercept res.json to cache the response before sending
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    idempotencyCache.set(idempotencyKey, {
      status: res.statusCode,
      body,
      timestamp: Date.now(),
    });
    return originalJson(body);
  };

  next();
}

/**
 * Reset internal idempotency cache.
 * @internal Test-only -- not intended for production use.
 */
export function _resetIdempotencyCache(): void {
  idempotencyCache.clear();
}
