import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Express } from 'express';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the server
// ---------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  config: {
    platformParty: 'test-platform::1220abc',
    network: 'localnet',
    jsonApiUrl: 'http://localhost:3975',
    cantexApiUrl: 'http://localhost:6100',
    scanUrl: 'http://scan.localhost:4000',
    jwtMode: 'unsafe',
    jwtSecret: 'test-secret',
    jwtAudience: 'https://daml.com/jwt/aud/participant/sandbox',
    applicationId: 'roil-finance',
    ledgerUserId: 'app-provider',
    defaultDriftThreshold: 5.0,
    minTxValue: 10.0,
    damlPackageName: 'roil-finance',
    port: 3001,
  },
  TEMPLATES: {
    Portfolio: '#roil-finance:Portfolio:Portfolio',
    PortfolioProposal: '#roil-finance:Portfolio:PortfolioProposal',
    RebalanceRequest: '#roil-finance:Portfolio:RebalanceRequest',
    RebalanceLog: '#roil-finance:Portfolio:RebalanceLog',
    DCASchedule: '#roil-finance:DCA:DCASchedule',
    DCAExecution: '#roil-finance:DCA:DCAExecution',
    DCALog: '#roil-finance:DCA:DCALog',
    RewardTracker: '#roil-finance:RewardTracker:RewardTracker',
    RewardPayout: '#roil-finance:RewardTracker:RewardPayout',
    Referral: '#roil-finance:RewardTracker:Referral',
    ReferralCredit: '#roil-finance:RewardTracker:ReferralCredit',
    FeaturedAppConfig: '#roil-finance:FeaturedApp:FeaturedAppConfig',
    ActivityRecord: '#roil-finance:FeaturedApp:ActivityRecord',
  },
  TOKEN_STANDARD: {
    Holding: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    TransferInstruction: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
    TransferFactory: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
    AllocationFactory: '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:AllocationFactory',
  },
  INSTRUMENTS: {
    CC: { id: 'CC', admin: '' },
    USDCx: { id: 'USDCx', admin: '' },
    CBTC: { id: 'CBTC', admin: '' },
  },
  PORTFOLIO_TEMPLATES: [
    {
      id: 'conservative',
      name: 'Conservative',
      description: 'Low-risk allocation',
      targets: [
        { asset: { symbol: 'USDCx', admin: '' }, targetPct: 60 },
        { asset: { symbol: 'CC', admin: '' }, targetPct: 30 },
        { asset: { symbol: 'CBTC', admin: '' }, targetPct: 10 },
      ],
      triggerMode: { tag: 'DriftThreshold', value: '3.0' },
      riskLevel: 'low',
      tags: ['stablecoin', 'low-risk'],
    },
    {
      id: 'balanced',
      name: 'Balanced Growth',
      description: 'Equal-weight strategy',
      targets: [
        { asset: { symbol: 'CC', admin: '' }, targetPct: 40 },
        { asset: { symbol: 'USDCx', admin: '' }, targetPct: 35 },
        { asset: { symbol: 'CBTC', admin: '' }, targetPct: 25 },
      ],
      triggerMode: { tag: 'DriftThreshold', value: '5.0' },
      riskLevel: 'medium',
      tags: ['balanced', 'growth'],
    },
  ],
}));

vi.mock('../src/ledger.js', () => ({
  ledger: {
    query: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ transaction: { events: [] } }),
    exercise: vi.fn().mockResolvedValue({ transaction: { events: [] } }),
    createAs: vi.fn().mockResolvedValue('mock-contract-id'),
    exerciseAs: vi.fn().mockResolvedValue('mock-result'),
    queryContracts: vi.fn().mockResolvedValue([]),
    health: vi.fn().mockResolvedValue(true),
  },
  extractCreatedContractId: vi.fn().mockReturnValue('mock-contract-id'),
  extractExerciseResult: vi.fn().mockReturnValue('mock-result'),
}));

vi.mock('../src/cantex.js', () => ({
  cantex: {
    getPrices: vi.fn().mockResolvedValue({ CC: 0.15, USDCx: 1.0, CBTC: 40000 }),
    getBalances: vi.fn().mockResolvedValue([
      { asset: 'CC', amount: 50000 },
      { asset: 'USDCx', amount: 10000 },
      { asset: 'CBTC', amount: 0.25 },
    ]),
    executeSwap: vi.fn().mockResolvedValue({
      txId: 'mock-tx', fromAsset: 'CC', toAsset: 'USDCx',
      inputAmount: 100, outputAmount: 15, fee: 0.045, timestamp: new Date().toISOString(),
    }),
    getQuote: vi.fn().mockResolvedValue({
      fromAsset: 'CC', toAsset: 'USDCx', inputAmount: 100,
      outputAmount: 15, price: 0.15, fee: 0.045, slippage: 0,
    }),
    getPoolInfo: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../src/cantex-client.js', () => ({
  CantexRealClient: vi.fn(),
}));

vi.mock('../src/services/price-oracle.js', () => ({
  priceOracle: {
    getPrice: vi.fn().mockResolvedValue({
      asset: 'CC', priceUsdcx: 0.15, change24h: 0, volume24h: 0,
      source: 'cantex', timestamp: new Date().toISOString(), confidence: 'high',
    }),
    getAllPrices: vi.fn().mockResolvedValue({}),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  },
}));

vi.mock('../src/engine/featured-app.js', () => ({
  featuredApp: {
    recordActivity: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    getActivitySummary: vi.fn().mockResolvedValue(null),
    getUserActivities: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/monitoring/metrics.js', () => ({
  metrics: {
    increment: vi.fn(),
    setGauge: vi.fn(),
    histogram: vi.fn(),
    observe: vi.fn(),
    toPrometheusText: vi.fn().mockReturnValue('# HELP http_requests Counter\n# TYPE http_requests counter\nhttp_requests 0\n'),
    toJSON: vi.fn().mockReturnValue({ counters: [], gauges: [], histograms: [] }),
  },
  METRICS: {
    httpRequests: 'http_requests',
    httpLatency: 'http_latency',
    httpRequestsTotal: 'http_requests_total',
    httpRequestDurationMs: 'http_request_duration_ms',
    httpResponseStatus: 'http_response_status',
    activePortfolios: 'active_portfolios',
    activeDcaSchedules: 'active_dca_schedules',
    circuitBreakerState: 'circuit_breaker_state',
    dcaExecuted: 'dca_executed',
    rewardDistributed: 'reward_distributed',
  },
}));

vi.mock('../src/middleware/security.js', () => {
  // Track request counts per IP for the rate limiter mock
  const requestCounts = new Map<string, number>();
  const RATE_LIMIT = 100;

  return {
    rateLimiter: (req: any, res: any, next: any) => {
      const ip = req.socket?.remoteAddress || 'unknown';
      const count = (requestCounts.get(ip) ?? 0) + 1;
      requestCounts.set(ip, count);
      if (count > RATE_LIMIT) {
        res.status(429).json({ success: false, error: 'Too many requests' });
        return;
      }
      next();
    },
    sanitizeInput: (_req: any, _res: any, next: any) => next(),
    securityHeaders: (_req: any, _res: any, next: any) => next(),
    requestSizeLimiter: () => (_req: any, _res: any, next: any) => next(),
    _resetRateLimiterState: () => requestCounts.clear(),
  };
});

vi.mock('../src/middleware/auth.js', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  requireParty: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/metrics-middleware.js', () => ({
  metricsMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middleware/error-handler.js', () => ({
  globalErrorHandler: (err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  },
}));

vi.mock('../src/utils/errors.js', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    isRetryable: boolean;
    constructor(message: string, statusCode = 500, code = 'INTERNAL', isRetryable = false) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isRetryable = isRetryable;
    }
  },
  LedgerError: class LedgerError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  CantexError: class CantexError extends Error {},
}));

// ---------------------------------------------------------------------------
// Import app after all mocks are in place
// ---------------------------------------------------------------------------

import { createApp } from '../src/server.js';
import { _resetRateLimiterState } from '../src/middleware/security.js';

// ---------------------------------------------------------------------------
// Supertest-like helper (avoids adding a dependency)
// ---------------------------------------------------------------------------

async function request(app: Express, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown; headers: Record<string, string> }>((resolve, reject) => {
    const http = require('http');
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const options = {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          server.close();
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
          });
        });
      });

      req.on('error', (err: Error) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Route-level tests', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();
  });

  // -----------------------------------------------------------------------
  // Health endpoint
  // -----------------------------------------------------------------------

  describe('GET /health', () => {
    it('should return 200 with healthy status', async () => {
      const res = await request(app, 'GET', '/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('network', 'localnet');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('checks');
    });
  });

  // -----------------------------------------------------------------------
  // Portfolio endpoint
  // -----------------------------------------------------------------------

  describe('GET /api/portfolio/:party', () => {
    it('should return data for a valid party', async () => {
      const res = await request(app, 'GET', '/api/portfolio/test-party');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray((res.body as any).data)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // POST with invalid body
  // -----------------------------------------------------------------------

  describe('POST /api/portfolio', () => {
    it('should return 400 for invalid body (missing required fields)', async () => {
      const res = await request(app, 'POST', '/api/portfolio', { invalid: true });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 400 when targets do not sum to 100%', async () => {
      const res = await request(app, 'POST', '/api/portfolio', {
        user: 'test-user',
        targets: [
          { asset: { symbol: 'CC', admin: 'admin' }, targetPct: 30 },
          { asset: { symbol: 'USDCx', admin: 'admin' }, targetPct: 30 },
        ],
        triggerMode: 'Manual',
      });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  // -----------------------------------------------------------------------
  // 404 route
  // -----------------------------------------------------------------------

  describe('Unknown routes', () => {
    it('should return 404 for an unknown route', async () => {
      const res = await request(app, 'GET', '/api/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('success', false);
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting
  // -----------------------------------------------------------------------

  describe('Rate limiting', () => {
    it('should return 429 after exceeding the rate limit', async () => {
      // Send 101 requests rapidly — the 101st should be rate-limited
      // We use a simpler approach: make enough requests to exceed the limit
      const results: number[] = [];

      for (let i = 0; i < 102; i++) {
        const res = await request(app, 'GET', '/health');
        results.push(res.status);
      }

      // At least one request should have been rate-limited
      const rateLimited = results.filter((s) => s === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // DCA endpoint
  // -----------------------------------------------------------------------

  describe('POST /api/dca', () => {
    it('should return 201 with valid data', async () => {
      const { ledger } = await import('../src/ledger.js');
      (ledger.createAs as ReturnType<typeof vi.fn>).mockResolvedValueOnce('mock-dca-contract-id');

      const res = await request(app, 'POST', '/api/dca', {
        user: 'test-user',
        sourceAsset: { symbol: 'USDCx', admin: 'admin-party' },
        targetAsset: { symbol: 'CBTC', admin: 'admin-party' },
        amountPerBuy: 100.0,
        frequency: 'Weekly',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect((res.body as any).data).toHaveProperty('contractId');
      expect((res.body as any).data).toHaveProperty('frequency', 'Weekly');
    });
  });

  // -----------------------------------------------------------------------
  // Rewards endpoint
  // -----------------------------------------------------------------------

  describe('GET /api/rewards/:party', () => {
    it('should return reward stats', async () => {
      const res = await request(app, 'GET', '/api/rewards/test-party');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });
  });

  // -----------------------------------------------------------------------
  // Transfers swap endpoint
  // -----------------------------------------------------------------------

  describe('POST /api/transfers/swap', () => {
    it('should return 201 with valid data', async () => {
      const res = await request(app, 'POST', '/api/transfers/swap', {
        user: 'test-user',
        sellAsset: 'CC',
        sellAmount: 100,
        buyAsset: 'USDCx',
        expectedBuyAmount: 15,
      });

      // The mock executeSwap returns success, so expect 201
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect((res.body as any).data).toHaveProperty('sellAsset', 'CC');
      expect((res.body as any).data).toHaveProperty('buyAsset', 'USDCx');
    });
  });

  // -----------------------------------------------------------------------
  // Metrics endpoints
  // -----------------------------------------------------------------------

  describe('GET /metrics', () => {
    it('should return prometheus format', async () => {
      const res = await request(app, 'GET', '/metrics');

      expect(res.status).toBe(200);
      // Prometheus text format has Content-Type text/plain
      expect(res.headers['content-type']).toContain('text/plain');
    });
  });

  describe('GET /metrics/json', () => {
    it('should return JSON format', async () => {
      const res = await request(app, 'GET', '/metrics/json');

      expect(res.status).toBe(200);
      // Should return an object with counters, gauges, histograms keys
      expect(res.body).toHaveProperty('counters');
      expect(res.body).toHaveProperty('gauges');
      expect(res.body).toHaveProperty('histograms');
    });
  });

  // -----------------------------------------------------------------------
  // Portfolio templates endpoint
  // -----------------------------------------------------------------------

  describe('GET /api/portfolio/templates', () => {
    it('should return portfolio templates', async () => {
      const res = await request(app, 'GET', '/api/portfolio/templates');
      expect(res.status).toBe(200);
      expect((res.body as any).data).toBeInstanceOf(Array);
      expect((res.body as any).data.length).toBeGreaterThan(0);
      expect((res.body as any).data[0]).toHaveProperty('id');
      expect((res.body as any).data[0]).toHaveProperty('name');
      expect((res.body as any).data[0]).toHaveProperty('targets');
    });
  });

  // -----------------------------------------------------------------------
  // Readiness probe endpoint
  // -----------------------------------------------------------------------

  describe('GET /readyz', () => {
    it('should return readiness status', async () => {
      const res = await request(app, 'GET', '/readyz');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ready');
    });
  });

  // -----------------------------------------------------------------------
  // Portfolio from-template endpoint
  // -----------------------------------------------------------------------

  describe('POST /api/portfolio/from-template', () => {
    it('should return 400 without required fields', async () => {
      const res = await request(app, 'POST', '/api/portfolio/from-template', {});
      expect(res.status).toBe(400);
    });

    it('should return 404 for unknown template', async () => {
      const res = await request(app, 'POST', '/api/portfolio/from-template', {
        user: 'test-user',
        templateId: 'nonexistent',
      });
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Referral endpoint
  // -----------------------------------------------------------------------

  describe('POST /api/rewards/referral', () => {
    it('should return 400 without required fields', async () => {
      const res = await request(app, 'POST', '/api/rewards/referral', {});
      expect(res.status).toBe(400);
    });

    it('should create referral with valid data', async () => {
      const res = await request(app, 'POST', '/api/rewards/referral', {
        referrer: 'alice::1220abc',
        referee: 'bob::1220def',
        referrerBonusPct: 10,
      });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
    });
  });
});
