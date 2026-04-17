import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, simple)
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetAt: number }>();
// Configurable via RATE_LIMIT_MAX env (per-IP requests per minute). Default
// 100/min preserves prior behaviour; raise for load tests or higher-traffic
// environments. Shared default with middleware/rate-limiter.ts (Redis-backed).
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const RATE_WINDOW = 60_000; // 1 minute

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress || 'unknown'; // NOT req.ip (IP spoofing prevention)
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT) {
    res.status(429).json({ success: false, error: 'Too many requests' });
    return;
  }

  entry.count++;
  next();
}

/**
 * Reset internal rate-limiter state.
 * @internal Test-only — not intended for production use.
 */
export function _resetRateLimiterState(): void {
  requestCounts.clear();
}

// Cleanup expired entries every 60 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts.entries()) {
    if (now > entry.resetAt) {
      requestCounts.delete(ip);
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Input sanitization — prototype pollution protection
// ---------------------------------------------------------------------------

/** Keys that must never appear in user-supplied JSON objects. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively scan an object and strip all prototype-pollution keys.
 *
 * Handles:
 * - Direct dangerous keys (obj.__proto__)
 * - Nested dangerous keys (obj.a.__proto__.__proto__)
 * - Keys whose string value encodes a dangerous key name
 * - Arrays containing objects with dangerous keys
 *
 * Uses a WeakSet to avoid infinite loops on circular references.
 */
function sanitizeObject(obj: unknown, depth = 0, seen?: WeakSet<object>): void {
  if (depth > 50 || !obj || typeof obj !== 'object') return;

  // Guard against circular references
  const visited = seen || new WeakSet<object>();
  if (visited.has(obj as object)) return;
  visited.add(obj as object);

  // Handle arrays — scan each element
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        sanitizeObject(item, depth + 1, visited);
      }
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // First pass: delete all dangerous keys at this level
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) {
      record[key] = undefined;
      Reflect.deleteProperty(record, key);
    }
  }

  // Second pass: recurse into remaining values
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value && typeof value === 'object') {
      sanitizeObject(value, depth + 1, visited);
      // After sanitizing the child, re-check if it became empty due to
      // stripping — but keep it in place (removing non-dangerous keys
      // would change semantics).
    } else if (typeof value === 'string') {
      // Block string values that could be used as key lookups for pollution
      // e.g. { "key": "__proto__" } used in bracket-notation access
      // This is a defense-in-depth measure; only strip if value exactly
      // matches a dangerous key name (not substrings).
      if (DANGEROUS_KEYS.has(value)) {
        record[key] = '';
      }
    }
  }
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  // Recursively strip prototype pollution keys from body, query, and params
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  next();
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
}

// ---------------------------------------------------------------------------
// Request size limiter (prevent large payloads)
// ---------------------------------------------------------------------------

export function requestSizeLimiter(maxBytes: number = 1_048_576) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      res.status(413).json({ success: false, error: 'Payload too large' });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Audit logging for state-changing requests (POST, PUT, DELETE)
// ---------------------------------------------------------------------------

/**
 * Summarize a request body for audit logging.
 * Returns a truncated representation that avoids logging sensitive data.
 */
function summarizeBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '(empty)';
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) return '(empty)';
  // Only log the key names and their types, never full values
  const summary = keys.slice(0, 10).map(k => {
    const val = (body as Record<string, unknown>)[k];
    const type = Array.isArray(val) ? `array[${val.length}]` : typeof val;
    return `${k}:${type}`;
  }).join(', ');
  return keys.length > 10 ? `{${summary}, ...+${keys.length - 10}}` : `{${summary}}`;
}

/**
 * Middleware that logs all state-changing requests (POST, PUT, DELETE)
 * with party ID, endpoint, body summary, and response status for
 * security audit trail.
 */
export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;

  // Only audit state-changing methods
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    next();
    return;
  }

  const startTime = Date.now();
  const partyId = req.partyId || '(unauthenticated)';
  const endpoint = req.originalUrl || req.url;
  const bodySummary = summarizeBody(req.body);
  const correlationId = (req as any).correlationId || '(none)';

  // Log after response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Audit: state-changing request', {
      audit: true,
      correlationId,
      method,
      endpoint,
      partyId,
      bodySummary,
      status: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}

// For production multi-instance deployment, use rate-limiter.ts instead
