import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { portfolioRouter } from './routes/portfolio.js';
import { dcaRouter } from './routes/dca.js';
import { rewardsRouter } from './routes/rewards.js';
import { marketRouter } from './routes/market.js';

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

  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    const originalEnd = _res.end;

    // Log after response
    _res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.url} ${_res.statusCode} ${duration}ms`);
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

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  return app;
}
