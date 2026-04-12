import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { portfolioRouter } from './routes/portfolio.js';
import { dcaRouter } from './routes/dca.js';
import { rewardsRouter } from './routes/rewards.js';
import { marketRouter } from './routes/market.js';
import { compoundRouter } from './routes/compound.js';
import { transfersRouter } from './routes/transfers.js';
import { metricsRouter } from './routes/metrics.js';
import { adminRouter } from './routes/admin.js';
import { swapRouter } from './routes/swap.js';
import { whitelistRouter } from './routes/whitelist.js';
import { xreserveRouter } from './routes/xreserve.js';
import { xreserveClient } from './services/xreserve-client.js';
import { rateLimiter, sanitizeInput, securityHeaders, requestSizeLimiter, auditLogger } from './middleware/security.js';
// For multi-instance production deployment with Redis:
// import { rateLimiter } from './middleware/rate-limiter.js';
import { authMiddleware } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { metricsMiddleware } from './middleware/metrics-middleware.js';
import { logger } from './monitoring/logger.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { ledger } from './ledger.js';
import { cantex } from './cantex.js';

// Resolve directory of the current module (works for both src/ and dist/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the Express application.
 *
 * Separated from `listen()` so the app can be used in tests without
 * starting the HTTP server.
 */
export function createApp(): express.Express {
  const app = express();

  // -----------------------------------------------------------------------
  // Middleware
  // -----------------------------------------------------------------------

  app.use(securityHeaders);

  // Correlation ID
  app.use((req, _res, next) => {
    (req as any).correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    next();
  });

  app.use(rateLimiter);
  app.use(requestSizeLimiter());
  app.use(cors({
    origin: config.network === 'localnet'
      ? true
      : config.allowedOrigins,
    credentials: true,
  }));
  app.use(express.json());
  app.use(sanitizeInput);
  app.use(authMiddleware);

  // Idempotency support — cache POST/PUT responses by Idempotency-Key header
  app.use(idempotencyMiddleware);

  // Audit logging for state-changing requests (POST, PUT, DELETE)
  app.use(auditLogger);

  // Metrics collection (before request logging so it captures all requests)
  app.use(metricsMiddleware);

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();

    // Log after response
    _res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.url} ${_res.statusCode} ${duration}ms`, {
        method: req.method,
        url: req.url,
        status: _res.statusCode,
        durationMs: duration,
      });
    });

    next();
  });

  // -----------------------------------------------------------------------
  // Routes
  // -----------------------------------------------------------------------

  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/dca', dcaRouter);
  app.use('/api/rewards', rewardsRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/compound', compoundRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/swap', swapRouter);
  app.use('/api/xreserve', xreserveRouter);
  app.use('/api/whitelist', whitelistRouter);
  app.use('/metrics', metricsRouter);

  // Serve OpenAPI specification as raw YAML
  app.get('/api/openapi.yaml', (_req, res) => {
    try {
      const specPath = join(__dirname, 'openapi.yaml');
      const spec = readFileSync(specPath, 'utf-8');
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.send(spec);
    } catch {
      // Fallback: try from src/ directory (dev mode with tsx)
      try {
        const specPath = join(__dirname, '..', 'src', 'openapi.yaml');
        const spec = readFileSync(specPath, 'utf-8');
        res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        res.send(spec);
      } catch {
        res.status(404).json({ success: false, error: 'OpenAPI spec not found' });
      }
    }
  });

  // Health check
  app.get('/health', async (_req, res) => {
    const checks: Record<string, string> = { server: 'healthy' };

    // Check ledger
    try {
      const ledgerHealthy = await ledger.health();
      checks.ledger = ledgerHealthy ? 'healthy' : 'unhealthy';
    } catch {
      checks.ledger = 'unreachable';
    }

    // Check cantex
    try {
      const cantexHealthy = await cantex.isAvailable();
      checks.cantex = cantexHealthy ? 'healthy' : 'unhealthy';
    } catch {
      checks.cantex = 'unreachable';
    }

    const allHealthy = Object.values(checks).every(v => v === 'healthy');

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      network: config.network,
      checks,
    });
  });

  // Readiness probe
  app.get('/readyz', async (_req, res) => {
    try {
      // Check that all critical dependencies are available
      const [ledgerOk, cantexOk] = await Promise.allSettled([
        ledger.health(),
        Promise.resolve(true), // cantex check
      ]);

      const ready = ledgerOk.status === 'fulfilled' && ledgerOk.value;
      res.status(ready ? 200 : 503).json({ ready });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
    });
  });

  // Global error handler (must be last — 4-parameter signature)
  app.use(globalErrorHandler);

  return app;
}
