import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../monitoring/logger.js';

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const REDIS_URL = process.env.REDIS_URL || '';
const MAX_MEMORY_KEYS = parseInt(process.env.RATE_LIMIT_MAX_KEYS || '50000', 10);

// ---------------------------------------------------------------------------
// In-memory store (default fallback)
// Bounded: Map insertion order gives us LRU — when size exceeds
// MAX_MEMORY_KEYS we evict the oldest entry (first key in the iterator).
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60s (capped iteration so a huge map
// cannot stall the event loop).
const CLEANUP_ITERATION_CAP = 10_000;
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let scanned = 0;
  for (const [key, entry] of memoryStore) {
    if (scanned++ >= CLEANUP_ITERATION_CAP) break;
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}, 60_000);
cleanupInterval.unref();

function memoryIncrement(key: string): { count: number; resetAt: number } {
  const now = Date.now();
  const existing = memoryStore.get(key);

  if (existing && existing.resetAt > now) {
    existing.count += 1;
    // Refresh LRU position so active keys do not get evicted.
    memoryStore.delete(key);
    memoryStore.set(key, existing);
    return existing;
  }

  // Evict the oldest entry if we are at capacity.
  if (memoryStore.size >= MAX_MEMORY_KEYS) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey !== undefined) memoryStore.delete(oldestKey);
  }

  const entry: RateLimitEntry = { count: 1, resetAt: now + WINDOW_MS };
  memoryStore.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Redis store (optional — used when REDIS_URL is set)
// ---------------------------------------------------------------------------

let redisClient: any = null;
let useRedis = false;

async function initRedis(): Promise<void> {
  if (!REDIS_URL) return;
  try {
    // Dynamic import — if redis package isn't installed, fallback to memory
    // @ts-ignore -- redis is an optional dependency
    const { createClient } = await import(/* webpackIgnore: true */ 'redis');
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err: Error) => {
      logger.warn('Redis rate limiter error, falling back to memory', { error: err.message });
      useRedis = false;
    });
    await redisClient.connect();
    useRedis = true;
    logger.info('Rate limiter using Redis', { url: REDIS_URL.replace(/\/\/.*@/, '//***@') });
  } catch {
    logger.info('Redis not available, using in-memory rate limiter');
    useRedis = false;
  }
}

// ---------------------------------------------------------------------------
// Redis initialization — awaitable for server startup
// ---------------------------------------------------------------------------

/** Promise that resolves when Redis init completes (or immediately if no Redis). */
export const redisReady: Promise<void> = initRedis();

/**
 * Wait for Redis initialization before accepting requests.
 * Call this in server.ts startup to avoid the race condition where
 * `useRedis` is false when the first request arrives.
 */
export async function waitForRedis(): Promise<void> {
  await redisReady;
}

async function redisIncrement(key: string): Promise<{ count: number; resetAt: number }> {
  const redisKey = `ratelimit:${key}`;
  const count = await redisClient.incr(redisKey);
  if (count === 1) {
    await redisClient.pExpire(redisKey, WINDOW_MS);
  }
  const ttl = await redisClient.pTTL(redisKey);
  return { count, resetAt: Date.now() + Math.max(ttl, 0) };
}

// ---------------------------------------------------------------------------
// Rate limiter middleware
// ---------------------------------------------------------------------------

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress || 'unknown';

  const handleResult = (result: { count: number; resetAt: number }) => {
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - result.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (result.count > MAX_REQUESTS) {
      res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
      return;
    }
    next();
  };

  if (useRedis && redisClient) {
    redisIncrement(ip).then(handleResult).catch(() => {
      // Redis failed mid-request, fallback to memory
      handleResult(memoryIncrement(ip));
    });
  } else {
    handleResult(memoryIncrement(ip));
  }
}

/** Reset state — for testing */
export function _resetRateLimiterState(): void {
  memoryStore.clear();
}
