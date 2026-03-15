// ---------------------------------------------------------------------------
// Express middleware — automatic HTTP metrics collection
// ---------------------------------------------------------------------------

import { type Request, type Response, type NextFunction } from 'express';
import { metrics, METRICS } from '../monitoring/metrics.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route?.path || req.path;
    const method = req.method;
    const status = String(res.statusCode);

    metrics.increment(METRICS.httpRequestsTotal, { method, route, status });
    metrics.observe(METRICS.httpRequestDurationMs, duration, { method, route });
  });

  next();
}
