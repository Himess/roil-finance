import { type Request, type Response, type NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, simple)
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100; // requests per window
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
 * Reset internal rate-limiter state. Exposed for testing only.
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
// Input sanitization
// ---------------------------------------------------------------------------

function sanitizeObject(obj: unknown, depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
  for (const key of dangerousKeys) {
    if (key in record) {
      record[key] = undefined;
      Reflect.deleteProperty(record, key);
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      sanitizeObject(value, depth + 1);
    }
  }
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  // Recursively strip prototype pollution keys from body
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
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

// For production multi-instance deployment, use rate-limiter.ts instead
