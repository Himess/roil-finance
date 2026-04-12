import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { idempotencyMiddleware, _resetIdempotencyCache } from '../src/middleware/idempotency.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Request object */
function mockReq(overrides: Partial<Request> = {}): Request {
  const req = {
    method: 'POST',
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

  const res = {
    statusCode: 200,
    status(code: number) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
    // Expose captured data for assertions
    get _statusCode() { return statusCode; },
    get _body() { return body; },
  } as unknown as Response & { _statusCode: number; _body: unknown };

  // Bind json so the middleware can override it
  res.json = res.json.bind(res);

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

describe('Idempotency Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetIdempotencyCache();
  });

  // -----------------------------------------------------------------------
  // First request processes normally
  // -----------------------------------------------------------------------

  it('should process the first request normally and call next()', () => {
    const req = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-001' },
    } as Partial<Request>);
    const res = mockRes();
    const next = trackNext();

    idempotencyMiddleware(req, res, next.fn);

    // First request should call next() to proceed to the handler
    expect(next.called).toBe(true);
  });

  it('should cache the response after the handler calls res.json()', () => {
    const req = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-002' },
    } as Partial<Request>);
    const res = mockRes();
    const next = trackNext();

    idempotencyMiddleware(req, res, next.fn);
    expect(next.called).toBe(true);

    // Simulate the handler setting status and calling json
    res.status(201);
    res.json({ success: true, data: { id: 'abc' } });

    // Now a second request with the same key should return cached response
    const req2 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-002' },
    } as Partial<Request>);
    const res2 = mockRes();
    const next2 = trackNext();

    idempotencyMiddleware(req2, res2, next2.fn);

    // Should NOT call next() — returns cached response directly
    expect(next2.called).toBe(false);
    expect(res2._statusCode).toBe(201);
    expect(res2._body).toEqual({ success: true, data: { id: 'abc' } });
  });

  // -----------------------------------------------------------------------
  // Duplicate request returns cached response
  // -----------------------------------------------------------------------

  it('should return the cached response for duplicate idempotency keys', () => {
    const idempotencyKey = 'dedup-key-100';

    // First request
    const req1 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as Partial<Request>);
    const res1 = mockRes();
    const next1 = trackNext();

    idempotencyMiddleware(req1, res1, next1.fn);
    expect(next1.called).toBe(true);

    // Handler responds
    res1.status(200);
    res1.json({ success: true, message: 'created' });

    // Second request — same key
    const req2 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as Partial<Request>);
    const res2 = mockRes();
    const next2 = trackNext();

    idempotencyMiddleware(req2, res2, next2.fn);

    expect(next2.called).toBe(false);
    expect(res2._statusCode).toBe(200);
    expect(res2._body).toEqual({ success: true, message: 'created' });

    // Third request — same key again
    const req3 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    } as Partial<Request>);
    const res3 = mockRes();
    const next3 = trackNext();

    idempotencyMiddleware(req3, res3, next3.fn);

    expect(next3.called).toBe(false);
    expect(res3._body).toEqual({ success: true, message: 'created' });
  });

  // -----------------------------------------------------------------------
  // Different idempotency keys process independently
  // -----------------------------------------------------------------------

  it('should process requests with different idempotency keys independently', () => {
    // First key
    const reqA = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-A' },
    } as Partial<Request>);
    const resA = mockRes();
    const nextA = trackNext();

    idempotencyMiddleware(reqA, resA, nextA.fn);
    expect(nextA.called).toBe(true);
    resA.status(201);
    resA.json({ id: 'A' });

    // Second key — different
    const reqB = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-B' },
    } as Partial<Request>);
    const resB = mockRes();
    const nextB = trackNext();

    idempotencyMiddleware(reqB, resB, nextB.fn);

    // Should call next() because it is a different key
    expect(nextB.called).toBe(true);

    resB.status(202);
    resB.json({ id: 'B' });

    // Verify cached responses are independent
    const reqA2 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-A' },
    } as Partial<Request>);
    const resA2 = mockRes();
    const nextA2 = trackNext();

    idempotencyMiddleware(reqA2, resA2, nextA2.fn);
    expect(nextA2.called).toBe(false);
    expect(resA2._statusCode).toBe(201);
    expect(resA2._body).toEqual({ id: 'A' });

    const reqB2 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': 'key-B' },
    } as Partial<Request>);
    const resB2 = mockRes();
    const nextB2 = trackNext();

    idempotencyMiddleware(reqB2, resB2, nextB2.fn);
    expect(nextB2.called).toBe(false);
    expect(resB2._statusCode).toBe(202);
    expect(resB2._body).toEqual({ id: 'B' });
  });

  // -----------------------------------------------------------------------
  // Cache TTL expiry
  // -----------------------------------------------------------------------

  it('should not serve expired cache entries after manual reset', () => {
    // We cannot easily simulate 24h passing, but we can test that
    // _resetIdempotencyCache clears the cache (simulating TTL expiry)
    const key = 'ttl-test-key';

    // First request + response
    const req1 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': key },
    } as Partial<Request>);
    const res1 = mockRes();
    const next1 = trackNext();

    idempotencyMiddleware(req1, res1, next1.fn);
    res1.status(200);
    res1.json({ cached: true });

    // Verify cached
    const req2 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': key },
    } as Partial<Request>);
    const res2 = mockRes();
    const next2 = trackNext();

    idempotencyMiddleware(req2, res2, next2.fn);
    expect(next2.called).toBe(false);

    // Simulate TTL expiry via cache reset
    _resetIdempotencyCache();

    // After reset, same key should be treated as a new request
    const req3 = mockReq({
      method: 'POST',
      headers: { 'idempotency-key': key },
    } as Partial<Request>);
    const res3 = mockRes();
    const next3 = trackNext();

    idempotencyMiddleware(req3, res3, next3.fn);
    expect(next3.called).toBe(true); // Processed as new request
  });

  // -----------------------------------------------------------------------
  // Non-POST requests bypass idempotency
  // -----------------------------------------------------------------------

  it('should bypass idempotency for GET requests', () => {
    const req = mockReq({
      method: 'GET',
      headers: { 'idempotency-key': 'get-key-001' },
    } as Partial<Request>);
    const res = mockRes();
    const next = trackNext();

    idempotencyMiddleware(req, res, next.fn);

    // GET requests should always pass through
    expect(next.called).toBe(true);
  });

  it('should bypass idempotency for DELETE requests', () => {
    const req = mockReq({
      method: 'DELETE',
      headers: { 'idempotency-key': 'delete-key-001' },
    } as Partial<Request>);
    const res = mockRes();
    const next = trackNext();

    idempotencyMiddleware(req, res, next.fn);

    expect(next.called).toBe(true);
  });

  it('should apply idempotency for PUT requests', () => {
    const key = 'put-key-001';

    // First PUT
    const req1 = mockReq({
      method: 'PUT',
      headers: { 'idempotency-key': key },
    } as Partial<Request>);
    const res1 = mockRes();
    const next1 = trackNext();

    idempotencyMiddleware(req1, res1, next1.fn);
    expect(next1.called).toBe(true);

    res1.status(200);
    res1.json({ updated: true });

    // Duplicate PUT — should return cached
    const req2 = mockReq({
      method: 'PUT',
      headers: { 'idempotency-key': key },
    } as Partial<Request>);
    const res2 = mockRes();
    const next2 = trackNext();

    idempotencyMiddleware(req2, res2, next2.fn);

    expect(next2.called).toBe(false);
    expect(res2._body).toEqual({ updated: true });
  });

  // -----------------------------------------------------------------------
  // Requests without idempotency key
  // -----------------------------------------------------------------------

  it('should pass through POST requests without an idempotency key', () => {
    const req = mockReq({
      method: 'POST',
      headers: {},
    } as Partial<Request>);
    const res = mockRes();
    const next = trackNext();

    idempotencyMiddleware(req, res, next.fn);

    expect(next.called).toBe(true);
  });

  it('should not cache responses for requests without an idempotency key', () => {
    // First request without key
    const req1 = mockReq({ method: 'POST', headers: {} } as Partial<Request>);
    const res1 = mockRes();
    const next1 = trackNext();

    idempotencyMiddleware(req1, res1, next1.fn);
    res1.status(201);
    res1.json({ id: 'no-cache' });

    // Second request without key — should also pass through
    const req2 = mockReq({ method: 'POST', headers: {} } as Partial<Request>);
    const res2 = mockRes();
    const next2 = trackNext();

    idempotencyMiddleware(req2, res2, next2.fn);

    expect(next2.called).toBe(true);
  });
});
