import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Mock config — must be set up before importing the auth module
// ---------------------------------------------------------------------------

const mockConfig = vi.hoisted(() => ({
  network: 'devnet' as string,
  jwtMode: 'hmac256' as string,
  jwtSecret: 'test-secret-key-for-auth-tests',
  jwtAudience: 'https://daml.com/jwt/aud/participant/sandbox',
}));

vi.mock('../src/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { authMiddleware } from '../src/middleware/auth.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Request object */
function mockReq(overrides: Partial<Request> = {}): Request {
  const req = {
    path: '/api/portfolio/test-party',
    headers: {},
    ...overrides,
  } as unknown as Request;
  return req;
}

/** Build a mock Response object that captures status + json calls */
function mockRes() {
  let statusCode = 200;
  let body: unknown = null;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
    get _statusCode() { return statusCode; },
    get _body() { return body; },
  } as unknown as Response & { _statusCode: number; _body: unknown };

  return res;
}

/** Simple next() tracker */
function trackNext() {
  let called = false;
  const fn: NextFunction = (() => { called = true; }) as NextFunction;
  return { fn, get called() { return called; } };
}

/** Create a JWT with given header, payload, and optional HMAC signing */
function createJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret?: string,
): string {
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  let signature = '';
  if (secret && header.alg === 'HS256') {
    signature = crypto.createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url');
  }

  return `${headerB64}.${payloadB64}.${signature}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auth Middleware', () => {
  beforeEach(() => {
    // Reset to non-localnet mode by default
    mockConfig.network = 'devnet';
    mockConfig.jwtMode = 'hmac256';
    mockConfig.jwtSecret = 'test-secret-key-for-auth-tests';
  });

  it('allows requests to public paths without auth', () => {
    const publicPaths = ['/health', '/metrics', '/api/health'];

    for (const path of publicPaths) {
      const req = mockReq({ path });
      const res = mockRes();
      const next = trackNext();

      authMiddleware(req, res, next.fn);

      expect(next.called).toBe(true);
    }
  });

  it('allows all requests in localnet mode', () => {
    mockConfig.network = 'localnet';

    const req = mockReq({ path: '/api/portfolio/test-party' });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(true);
  });

  it('rejects requests without Bearer token in non-localnet', () => {
    const req = mockReq({ path: '/api/portfolio/test-party', headers: {} });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(false);
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ success: false, error: 'Authorization header required' });
  });

  it('rejects expired JWT tokens', () => {
    const token = createJwt(
      { alg: 'HS256', typ: 'JWT' },
      { actAs: ['test-party'], exp: Math.floor(Date.now() / 1000) - 3600 }, // expired 1 hour ago
      mockConfig.jwtSecret,
    );

    const req = mockReq({
      path: '/api/portfolio/test-party',
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(false);
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ success: false, error: 'Invalid or expired token' });
  });

  it('correctly extracts actAs parties from JWT', () => {
    const parties = ['alice::1220abc', 'bob::1220def'];
    const token = createJwt(
      { alg: 'HS256', typ: 'JWT' },
      { actAs: parties, exp: Math.floor(Date.now() / 1000) + 3600 },
      mockConfig.jwtSecret,
    );

    const req = mockReq({
      path: '/api/portfolio/test-party',
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(true);
    expect(req.actAs).toEqual(parties);
  });

  it('rejects JWT with invalid HMAC signature', () => {
    // Sign with wrong secret
    const token = createJwt(
      { alg: 'HS256', typ: 'JWT' },
      { actAs: ['test-party'], exp: Math.floor(Date.now() / 1000) + 3600 },
      'wrong-secret-key',
    );

    const req = mockReq({
      path: '/api/portfolio/test-party',
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(false);
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ success: false, error: 'Invalid or expired token' });
  });

  it('accepts valid HMAC-signed JWT', () => {
    const token = createJwt(
      { alg: 'HS256', typ: 'JWT' },
      {
        actAs: ['platform::1220abc'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: 'https://daml.com/jwt/aud/participant/sandbox',
      },
      mockConfig.jwtSecret,
    );

    const req = mockReq({
      path: '/api/portfolio/test-party',
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = trackNext();

    authMiddleware(req, res, next.fn);

    expect(next.called).toBe(true);
    expect(req.actAs).toEqual(['platform::1220abc']);
  });

  it('handles malformed JWT gracefully', () => {
    const malformedTokens = [
      'not-a-jwt',
      'only.two-parts',
      'a.b.c.d.e',  // too many parts
      `${Buffer.from('{}').toString('base64url')}.not-valid-base64!.sig`, // invalid payload
    ];

    for (const token of malformedTokens) {
      const req = mockReq({
        path: '/api/portfolio/test-party',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockRes();
      const next = trackNext();

      authMiddleware(req, res, next.fn);

      expect(next.called).toBe(false);
      expect(res._statusCode).toBe(401);
    }
  });
});
