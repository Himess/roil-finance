import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import {
  rateLimiter,
  sanitizeInput,
  securityHeaders,
  requestSizeLimiter,
  _resetRateLimiterState,
} from '../src/middleware/security.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Request object */
function mockReq(overrides: Partial<Request> = {}): Request {
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
  return req;
}

/** Build a mock Response object that captures status + json calls */
function mockRes() {
  let statusCode = 200;
  let body: unknown = null;
  const headers = new Map<string, string>();

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    // Expose captured data for assertions
    get _statusCode() { return statusCode; },
    get _body() { return body; },
    get _headers() { return headers; },
  } as unknown as Response & { _statusCode: number; _body: unknown; _headers: Map<string, string> };

  return res;
}

/** Simple next() tracker */
function trackNext() {
  let called = false;
  const fn: NextFunction = (() => { called = true; }) as NextFunction;
  return { fn, get called() { return called; } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security Middleware', () => {
  // -----------------------------------------------------------------------
  // Rate limiter
  // -----------------------------------------------------------------------

  describe('rateLimiter', () => {
    beforeEach(() => {
      _resetRateLimiterState();
    });

    it('should allow requests under the rate limit', () => {
      const req = mockReq();
      const res = mockRes();
      const next = trackNext();

      rateLimiter(req, res, next.fn);

      expect(next.called).toBe(true);
    });

    it('should block after 100 requests from the same IP', () => {
      const req = mockReq();

      // Send 100 requests (all allowed)
      for (let i = 0; i < 100; i++) {
        const res = mockRes();
        const next = trackNext();
        rateLimiter(req, res, next.fn);
        expect(next.called).toBe(true);
      }

      // 101st request should be blocked
      const res = mockRes();
      const next = trackNext();
      rateLimiter(req, res, next.fn);

      expect(next.called).toBe(false);
      expect(res._statusCode).toBe(429);
      expect(res._body).toEqual({ success: false, error: 'Too many requests' });
    });

    it('should reset after the rate window expires', () => {
      const req = mockReq();

      // Exhaust the limit
      for (let i = 0; i < 100; i++) {
        rateLimiter(req, mockRes(), trackNext().fn);
      }

      // Verify it blocks
      const blockedRes = mockRes();
      const blockedNext = trackNext();
      rateLimiter(req, blockedRes, blockedNext.fn);
      expect(blockedNext.called).toBe(false);

      // Reset state to simulate window expiry
      _resetRateLimiterState();

      // Should allow again
      const res = mockRes();
      const next = trackNext();
      rateLimiter(req, res, next.fn);
      expect(next.called).toBe(true);
    });

    it('should track different IPs independently', () => {
      const req1 = mockReq({ socket: { remoteAddress: '10.0.0.1' } } as Partial<Request>);
      const req2 = mockReq({ socket: { remoteAddress: '10.0.0.2' } } as Partial<Request>);

      // Exhaust limit for IP 1
      for (let i = 0; i < 100; i++) {
        rateLimiter(req1, mockRes(), trackNext().fn);
      }

      // IP 2 should still be allowed
      const res = mockRes();
      const next = trackNext();
      rateLimiter(req2, res, next.fn);
      expect(next.called).toBe(true);

      // IP 1 should be blocked
      const blockedRes = mockRes();
      const blockedNext = trackNext();
      rateLimiter(req1, blockedRes, blockedNext.fn);
      expect(blockedNext.called).toBe(false);
      expect(blockedRes._statusCode).toBe(429);
    });
  });

  // -----------------------------------------------------------------------
  // Input sanitization
  // -----------------------------------------------------------------------

  describe('sanitizeInput', () => {
    it('should strip __proto__ from request body', () => {
      const body = { name: 'test', __proto__: { admin: true } };
      // Manually set __proto__ as own property
      const safeBody = Object.create(null);
      safeBody.name = 'test';
      safeBody.__proto__ = { admin: true };

      const req = mockReq({ body: safeBody });
      const res = mockRes();
      const next = trackNext();

      sanitizeInput(req, res, next.fn);

      expect(next.called).toBe(true);
      expect(req.body.__proto__).toBeUndefined();
      expect(req.body.name).toBe('test');
    });

    it('should strip constructor from request body', () => {
      // Use Object.create(null) to avoid inherited constructor, then set it as own property
      const body: Record<string, unknown> = Object.create(null);
      body.data = 123;
      body.constructor = 'evil';
      const req = mockReq({ body } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      sanitizeInput(req, res, next.fn);

      expect(next.called).toBe(true);
      expect(body.constructor).toBeUndefined();
      expect(body.data).toBe(123);
    });

    it('should strip prototype from request body', () => {
      const body: Record<string, unknown> = { valid: true, prototype: {} };
      const req = mockReq({ body } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      sanitizeInput(req, res, next.fn);

      expect(next.called).toBe(true);
      expect(body.prototype).toBeUndefined();
      expect(body.valid).toBe(true);
    });

    it('should pass through when body is empty or null', () => {
      const req1 = mockReq({ body: null } as Partial<Request>);
      const next1 = trackNext();
      sanitizeInput(req1, mockRes(), next1.fn);
      expect(next1.called).toBe(true);

      const req2 = mockReq({ body: undefined } as Partial<Request>);
      const next2 = trackNext();
      sanitizeInput(req2, mockRes(), next2.fn);
      expect(next2.called).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Security headers
  // -----------------------------------------------------------------------

  describe('securityHeaders', () => {
    it('should set all required security headers', () => {
      const req = mockReq();
      const res = mockRes();
      const next = trackNext();

      securityHeaders(req, res, next.fn);

      expect(next.called).toBe(true);
      expect(res._headers.get('x-content-type-options')).toBe('nosniff');
      expect(res._headers.get('x-frame-options')).toBe('DENY');
      expect(res._headers.get('x-xss-protection')).toBe('1; mode=block');
      expect(res._headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
      expect(res._headers.get('content-security-policy')).toBe("default-src 'self'");
    });
  });

  // -----------------------------------------------------------------------
  // Request size limiter
  // -----------------------------------------------------------------------

  describe('requestSizeLimiter', () => {
    it('should allow requests within the size limit', () => {
      const limiter = requestSizeLimiter(1024);
      const req = mockReq({ headers: { 'content-length': '512' } } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      limiter(req, res, next.fn);

      expect(next.called).toBe(true);
    });

    it('should reject requests exceeding the size limit', () => {
      const limiter = requestSizeLimiter(1024);
      const req = mockReq({ headers: { 'content-length': '2048' } } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      limiter(req, res, next.fn);

      expect(next.called).toBe(false);
      expect(res._statusCode).toBe(413);
      expect(res._body).toEqual({ success: false, error: 'Payload too large' });
    });

    it('should use default 1MB limit when no argument given', () => {
      const limiter = requestSizeLimiter();
      // 2MB = 2_097_152 bytes → exceeds default 1MB
      const req = mockReq({ headers: { 'content-length': '2097152' } } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      limiter(req, res, next.fn);

      expect(next.called).toBe(false);
      expect(res._statusCode).toBe(413);
    });

    it('should allow requests with no content-length header', () => {
      const limiter = requestSizeLimiter(1024);
      const req = mockReq({ headers: {} } as Partial<Request>);
      const res = mockRes();
      const next = trackNext();

      limiter(req, res, next.fn);

      expect(next.called).toBe(true);
    });
  });
});
