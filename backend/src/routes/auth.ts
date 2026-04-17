/**
 * Auth routes — server-side verification for external identity providers.
 *
 * - `/api/auth/google/verify` validates a Google ID token against Google's
 *   JWKS and returns the decoded claims. The frontend MUST call this before
 *   minting a wallet from a Google sub; the previous client-side-only decode
 *   trusted a bearer cookie that any malicious script could forge.
 *
 * Cached JWKS fetch: Google rotates keys every few days. We cache for 60
 * minutes in-process; on cache miss we re-fetch. If the fetch itself fails,
 * we return 503 — never fall back to an unverified token.
 */

import { Router, type Request, type Response } from 'express';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import { logger } from '../monitoring/logger.js';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Google OAuth constants
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER_ALLOWED = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const JWKS_TTL_MS = 60 * 60 * 1000; // 60 minutes

interface JWK {
  kid: string;
  n: string;
  e: string;
  alg: string;
  kty: string;
  use: string;
}

let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<JWK[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: JWK[] };
  if (!body.keys?.length) throw new Error('Google JWKS empty');
  jwksCache = { keys: body.keys, fetchedAt: now };
  return body.keys;
}

// ---------------------------------------------------------------------------
// JWT verification — Google RS256 ID tokens
// ---------------------------------------------------------------------------

interface VerifiedGoogleToken {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

function base64UrlDecode(seg: string): Buffer {
  // Normalize URL-safe base64 + padding.
  const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function jwkToPem(jwk: JWK): string {
  // Use Node crypto to construct a public KeyObject from JWK.
  const keyObj = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
  return keyObj.export({ type: 'spki', format: 'pem' }).toString();
}

async function verifyGoogleIdToken(
  idToken: string,
  expectedAudience: string,
): Promise<VerifiedGoogleToken> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`);
  if (!header.kid) throw new Error('Missing kid');

  const keys = await fetchJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`Unknown kid: ${header.kid}`);

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const signature = base64UrlDecode(parts[2]);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(jwkToPem(jwk), signature);
  if (!ok) throw new Error('Signature verification failed');

  const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8')) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    aud?: string;
    iss?: string;
    iat?: number;
    exp?: number;
  };

  if (!payload.sub || !payload.email || !payload.aud || !payload.iss || !payload.exp) {
    throw new Error('Missing required claim');
  }
  if (!GOOGLE_ISSUER_ALLOWED.has(payload.iss)) throw new Error(`Bad iss: ${payload.iss}`);
  if (payload.aud !== expectedAudience) {
    throw new Error(`Audience mismatch: token=${payload.aud} expected=${expectedAudience}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - 30) throw new Error('Token expired');
  if (payload.iat && payload.iat > now + 60) throw new Error('Token issued in the future');

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name,
    picture: payload.picture,
    aud: payload.aud,
    iss: payload.iss,
    iat: payload.iat ?? 0,
    exp: payload.exp,
  };
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/google/verify
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  idToken: z.string().min(20).max(4096),
});

authRouter.post('/google/verify', async (req: Request, res: Response) => {
  const expectedAudience = process.env.GOOGLE_CLIENT_ID;
  if (!expectedAudience) {
    res.status(503).json({
      success: false,
      error: 'Google auth not configured (GOOGLE_CLIENT_ID missing on backend)',
    });
    return;
  }

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  try {
    const verified = await verifyGoogleIdToken(parsed.data.idToken, expectedAudience);
    // Refuse accounts whose email is not verified — Google will not flip this
    // flag for plain-Gmail accounts, only for federated identities that were
    // never confirmed. Treat unverified as invalid.
    if (!verified.emailVerified) {
      res.status(401).json({ success: false, error: 'Email not verified by Google' });
      return;
    }
    res.json({
      success: true,
      data: {
        sub: verified.sub,
        email: verified.email,
        name: verified.name,
        picture: verified.picture,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Google ID token verification failed', { error: msg });
    res.status(401).json({ success: false, error: `Google token invalid: ${msg}` });
  }
});
