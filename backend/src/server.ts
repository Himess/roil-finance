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
import { rateLimiter, sanitizeInput, securityHeaders, requestSizeLimiter } from './middleware/security.js';
import { metricsMiddleware } from './middleware/metrics-middleware.js';
import { logger } from './monitoring/logger.js';
import { globalErrorHandler } from './middleware/error-handler.js';

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
  app.use(rateLimiter);
  app.use(requestSizeLimiter());
  app.use(cors());
  app.use(express.json());
  app.use(sanitizeInput);

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
  app.use('/metrics', metricsRouter);

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'canton-rebalancer-backend',
      timestamp: new Date().toISOString(),
      config: {
        jsonApiUrl: config.jsonApiUrl,
        platformParty: config.platformParty,
        cantexApiUrl: config.cantexApiUrl,
      },
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: `Route not found: ${_req.method} ${_req.url}`,
    });
  });

  // Global error handler (must be last — 4-parameter signature)
  app.use(globalErrorHandler);

  return app;
}
