// ---------------------------------------------------------------------------
// Admin-only authorization middleware
// ---------------------------------------------------------------------------
//
// Verifies that the authenticated party is the platform party (admin).
// Rejects non-admin requests with 403.
// ---------------------------------------------------------------------------

import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';

/**
 * Middleware that ensures the request comes from the platform admin party.
 *
 * In localnet mode, authorization is skipped for ease of development.
 * In all other environments, the JWT must contain the platform party
 * in its `actAs` array.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // In localnet, skip admin check for development convenience
  if (config.network === 'localnet') {
    next();
    return;
  }

  const actAs = req.actAs || [];
  const platformParty = config.platformParty;

  if (!actAs.includes(platformParty)) {
    logger.warn('Admin endpoint access denied', {
      component: 'admin-auth',
      path: req.path,
      actAs: actAs.join(','),
      requiredParty: platformParty,
    });

    res.status(403).json({
      success: false,
      error: 'Admin access required. Must authenticate as platform party.',
    });
    return;
  }

  next();
}
