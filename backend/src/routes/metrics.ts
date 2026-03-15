// ---------------------------------------------------------------------------
// /metrics endpoint — Prometheus-compatible text + JSON
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { metrics } from '../monitoring/metrics.js';

export const metricsRouter = Router();

// Prometheus text exposition format
metricsRouter.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(metrics.toPrometheusText());
});

// JSON format (for dashboards / debugging)
metricsRouter.get('/json', (_req: Request, res: Response) => {
  res.json(metrics.toJSON());
});
