import * as crypto from 'node:crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Extend Express Request to carry verified party info
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** Parties extracted from the verified JWT */
      actAs?: string[];
    }
  }
}

// ---------------------------------------------------------------------------
// Paths that skip authentication
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = new Set(['/health', '/metrics', '/api/health']);

// ---------------------------------------------------------------------------
// Startup validation — call this at server boot to fail fast on misconfig
// ---------------------------------------------------------------------------

/**
 * Validate JWT configuration at startup. Throws if RS256/ES256 mode is
 * selected but JWT_PUBLIC_KEY is not set. Must be called before the server
 * starts accepting requests.
 */
export function validateAuthConfig(): void {
  if (
    (config.jwtMode === 'rs256' || config.jwtMode === 'es256') &&
    !process.env.JWT_PUBLIC_KEY
  ) {
    throw new Error(
      `JWT_MODE is '${config.jwtMode}' but JWT_PUBLIC_KEY is not set. ` +
      `Cannot verify tokens without a public key. Set JWT_PUBLIC_KEY or change JWT_MODE.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Auth configuration error — thrown when public key is missing at runtime
// ---------------------------------------------------------------------------

class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

// ---------------------------------------------------------------------------
// JWT verification helpers
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload;
  } catch {
    return null;
  }
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  // Check expiry
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Verify signature based on JWT mode
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const signingInput = `${parts[0]}.${parts[1]}`;

  switch (header.alg) {
    case 'none':
      // Only accept unsigned tokens in unsafe mode
      if (config.jwtMode !== 'unsafe') return null;
      return payload;

    case 'HS256': {
      const expected = crypto.createHmac('sha256', config.jwtSecret)
        .update(signingInput)
        .digest('base64url');
      const expectedBuf = Buffer.from(expected, 'base64url');
      const actualBuf = Buffer.from(parts[2], 'base64url');
      if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
        return null;
      }
      return payload;
    }

    case 'RS256': {
      // Verify RS256 signature using public key
      const rs256PublicKey = process.env.JWT_PUBLIC_KEY;
      if (!rs256PublicKey) {
        // This should have been caught at startup by validateAuthConfig().
        // If we reach here, reject with a clear server error rather than silently returning null.
        throw new AuthConfigError('JWT_PUBLIC_KEY is not configured for RS256 verification');
      }
      const rs256Verifier = crypto.createVerify('RSA-SHA256');
      rs256Verifier.update(signingInput);
      const rs256Valid = rs256Verifier.verify(rs256PublicKey, parts[2], 'base64url');
      if (!rs256Valid) return null;
      return payload;
    }

    case 'ES256': {
      // Verify ES256 signature using public key
      const es256PublicKey = process.env.JWT_PUBLIC_KEY;
      if (!es256PublicKey) {
        // This should have been caught at startup by validateAuthConfig().
        // If we reach here, reject with a clear server error rather than silently returning null.
        throw new AuthConfigError('JWT_PUBLIC_KEY is not configured for ES256 verification');
      }
      const es256Verifier = crypto.createVerify('SHA256');
      es256Verifier.update(signingInput);
      const es256Valid = es256Verifier.verify(
        { key: es256PublicKey, dsaEncoding: 'ieee-p1363' },
        parts[2],
        'base64url',
      );
      if (!es256Valid) return null;
      return payload;
    }

    default:
      // Unknown algorithm — reject
      logger.warn(`Unsupported JWT algorithm: ${header.alg}`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    let payload: Record<string, unknown> | null;
    try {
      payload = verifyJwt(token);
    } catch (err) {
      if (err instanceof AuthConfigError) {
        // Server misconfiguration — return 500, not 401
        logger.error(`Auth configuration error: ${err.message}`);
        res.status(500).json({ success: false, error: 'Server authentication configuration error' });
        return;
      }
      throw err;
    }

    if (payload) {
      // Extract actAs parties from JWT
      const actAs = Array.isArray(payload.actAs) ? payload.actAs as string[] : [];
      req.actAs = actAs;
      next();
      return;
    }

    // Token present but invalid
    if (config.network !== 'localnet') {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    // In localnet mode, log warning but allow through
    logger.warn('Invalid JWT in localnet mode, allowing request', { path: req.path });
  } else if (config.network !== 'localnet') {
    // No token in non-localnet mode
    res.status(401).json({ success: false, error: 'Authorization header required' });
    return;
  }

  // Localnet: allow unauthenticated requests
  next();
}

// ---------------------------------------------------------------------------
// Route-level party authorization
// ---------------------------------------------------------------------------

/**
 * Middleware that verifies the authenticated user has the right to act as the
 * party specified in the request (route param, body.user, or body.party).
 * In localnet mode, authorization is skipped.
 */
export function requireParty(paramName: string = 'party') {
  return (req: Request, res: Response, next: NextFunction) => {
    // In localnet, skip authorization
    if (config.network === 'localnet') return next();

    const targetParty = req.params[paramName] || req.body?.user || req.body?.party;
    if (!targetParty) return next(); // No party to check

    const actAs = (req as any).actAs as string[] | undefined;
    if (!actAs || !actAs.includes(targetParty)) {
      return res.status(403).json({
        success: false,
        error: `Not authorized to act as party: ${targetParty}`,
      });
    }
    next();
  };
}
