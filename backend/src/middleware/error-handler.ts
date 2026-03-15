// ---------------------------------------------------------------------------
// Global Express error handler
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';

/**
 * Global error-handling middleware.
 *
 * Must be registered **after** all routes and the 404 handler so Express
 * recognises the 4-parameter signature as an error handler.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Structured log
  console.error(`[ERROR] ${req.method} ${req.url}:`, {
    message: err.message,
    code: err instanceof AppError ? err.code : 'INTERNAL',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      retryable: err.isRetryable,
    });
    return;
  }

  // Unknown / unhandled error — hide details in production
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL',
  });
}
