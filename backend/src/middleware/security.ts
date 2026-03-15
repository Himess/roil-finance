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

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  // Strip any potential prototype pollution
  if (req.body && typeof req.body === 'object') {
    delete req.body.__proto__;
    delete req.body.constructor;
    delete req.body.prototype;
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
