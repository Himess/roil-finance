// ---------------------------------------------------------------------------
// Admin control endpoints
// ---------------------------------------------------------------------------
//
// Platform administration: pause/resume operations, fee management, asset
// allow-lists, emergency freeze, and audit logging.
//
// All endpoints require platform party authentication (requireAdmin).
// State is kept in-memory with all mutations logged to an audit trail.
// ---------------------------------------------------------------------------

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { config, INSTRUMENTS } from '../config.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Stricter rate limiter for admin endpoints: 10 requests per minute per IP
// ---------------------------------------------------------------------------

const ADMIN_RATE_LIMIT = 10;
const ADMIN_RATE_WINDOW = 60_000; // 1 minute
const adminRequestCounts = new Map<string, { count: number; resetAt: number }>();

function adminRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = adminRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    adminRequestCounts.set(ip, { count: 1, resetAt: now + ADMIN_RATE_WINDOW });
    next();
    return;
  }

  if (entry.count >= ADMIN_RATE_LIMIT) {
    logger.warn('Admin rate limit exceeded', { ip, path: req.path, count: entry.count });
    res.status(429).json({ success: false, error: 'Admin rate limit exceeded. Max 10 requests per minute.' });
    return;
  }

  entry.count++;
  next();
}

// Cleanup expired admin rate limit entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of adminRequestCounts.entries()) {
    if (now > entry.resetAt) adminRequestCounts.delete(ip);
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const FeeRateSchema = z.object({
  feeRate: z.number().min(0).max(0.1),
});

const AllowedAssetsSchema = z.object({
  assets: z.array(z.string().min(1)).min(1),
});

// ---------------------------------------------------------------------------
// In-memory admin state
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  action: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
}

interface AdminState {
  paused: boolean;
  frozen: boolean;
  feeRate: number;
  allowedAssets: string[];
  startedAt: string;
  auditLog: AuditLogEntry[];
}

const MAX_AUDIT_LOG_ENTRIES = 1000;

const adminState: AdminState = {
  paused: false,
  frozen: false,
  feeRate: config.platformFeeRate,
  allowedAssets: Object.keys(INSTRUMENTS),
  startedAt: new Date().toISOString(),
  auditLog: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActorParty(req: Request): string {
  const actAs = req.actAs || [];
  return actAs[0] || 'unknown';
}

function addAuditEntry(action: string, actor: string, details: Record<string, unknown>): void {
  const entry: AuditLogEntry = {
    action,
    actor,
    timestamp: new Date().toISOString(),
    details,
  };

  adminState.auditLog.unshift(entry);

  // Cap the in-memory log
  if (adminState.auditLog.length > MAX_AUDIT_LOG_ENTRIES) {
    adminState.auditLog.length = MAX_AUDIT_LOG_ENTRIES;
  }

  logger.info(`Admin action: ${action}`, {
    component: 'admin',
    actor,
    ...details,
  });
}

// ---------------------------------------------------------------------------
// Exported state accessors (for use by engines)
// ---------------------------------------------------------------------------

/**
 * Returns true if the platform is paused or frozen.
 * Engines should check this before executing scheduled operations.
 */
export function isPlatformPaused(): boolean {
  return adminState.paused || adminState.frozen;
}

/**
 * Returns true if the platform is in emergency freeze mode.
 */
export function isPlatformFrozen(): boolean {
  return adminState.frozen;
}

/**
 * Returns the current platform fee rate.
 */
export function getPlatformFeeRate(): number {
  return adminState.feeRate;
}

/**
 * Returns the current list of allowed asset symbols.
 */
export function getAllowedAssets(): string[] {
  return [...adminState.allowedAssets];
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter = Router();

/**
 * GET /api/admin/me
 *
 * Lightweight "am I an admin?" probe for the frontend. Must be reachable by
 * ANY authenticated user (it's how the UI decides whether to render the
 * /admin link or hard-gate the route). Runs BEFORE `requireAdmin` so
 * non-admin requests get a clean `{ admin: false }` instead of a 403.
 *
 * Returns `{ admin: true }` only if the caller's JWT `actAs` includes the
 * platform party. This matches the `requireAdmin` check below.
 */
adminRouter.get('/me', (req: Request, res: Response) => {
  const actAsOK = req.actAs?.includes(config.platformParty) ?? false;
  const partyOK = req.partyId === config.platformParty;
  res.json({ success: true, admin: actAsOK || partyOK });
});

// All admin routes AFTER this point: stricter rate limit + platform party auth.
adminRouter.use(adminRateLimiter);
adminRouter.use(requireAdmin);

/**
 * GET /api/admin/status
 *
 * Get current platform admin status.
 */
adminRouter.get('/status', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  logger.info('Admin action', {
    action: 'GET_STATUS',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: {},
  });

  res.json({
    success: true,
    data: {
      paused: adminState.paused,
      frozen: adminState.frozen,
      feeRate: adminState.feeRate,
      allowedAssets: adminState.allowedAssets,
      activePortfolios: 0, // TODO: wire to actual count from ledger queries
      activeDCAs: 0,       // TODO: wire to actual count from ledger queries
      startedAt: adminState.startedAt,
    },
  });
});

/**
 * POST /api/admin/pause
 *
 * Pause all rebalancing and DCA execution globally.
 */
adminRouter.post('/pause', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const reason = (req.body?.reason as string) || '';
  const actor = getActorParty(req);

  if (adminState.paused) {
    return res.status(400).json({
      success: false,
      error: 'Platform is already paused',
    });
  }

  adminState.paused = true;
  addAuditEntry('pause', actor, { reason });

  logger.info('Admin action', {
    action: 'PAUSE',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { reason },
  });

  res.json({
    success: true,
    data: {
      paused: true,
      message: 'All rebalancing and DCA operations paused',
      reason,
    },
  });
});

/**
 * POST /api/admin/resume
 *
 * Resume all operations (clears both pause and freeze).
 */
adminRouter.post('/resume', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const actor = getActorParty(req);

  if (!adminState.paused && !adminState.frozen) {
    return res.status(400).json({
      success: false,
      error: 'Platform is already running',
    });
  }

  const wasFrozen = adminState.frozen;
  adminState.paused = false;
  adminState.frozen = false;
  addAuditEntry('resume', actor, { wasFrozen });

  logger.info('Admin action', {
    action: 'RESUME',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { wasFrozen },
  });

  res.json({
    success: true,
    data: {
      paused: false,
      frozen: false,
      message: wasFrozen ? 'Emergency freeze lifted — operations resumed' : 'Operations resumed',
    },
  });
});

/**
 * PUT /api/admin/fee-rate
 *
 * Update the platform fee rate.
 */
adminRouter.put('/fee-rate', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const parsed = FeeRateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.format(),
    });
  }

  const actor = getActorParty(req);
  const previousRate = adminState.feeRate;
  adminState.feeRate = parsed.data.feeRate;

  addAuditEntry('update-fee-rate', actor, {
    previousRate,
    newRate: parsed.data.feeRate,
  });

  logger.info('Admin action', {
    action: 'UPDATE_FEE_RATE',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { previousRate, newRate: parsed.data.feeRate },
  });

  res.json({
    success: true,
    data: {
      feeRate: adminState.feeRate,
      previousRate,
    },
  });
});

/**
 * PUT /api/admin/allowed-assets
 *
 * Update the list of allowed asset symbols.
 */
adminRouter.put('/allowed-assets', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const parsed = AllowedAssetsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.format(),
    });
  }

  const actor = getActorParty(req);
  const previousAssets = [...adminState.allowedAssets];
  adminState.allowedAssets = parsed.data.assets;

  addAuditEntry('update-allowed-assets', actor, {
    previousAssets,
    newAssets: parsed.data.assets,
  });

  logger.info('Admin action', {
    action: 'UPDATE_ALLOWED_ASSETS',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { previousAssets, newAssets: parsed.data.assets },
  });

  res.json({
    success: true,
    data: {
      allowedAssets: adminState.allowedAssets,
      previousAssets,
    },
  });
});

/**
 * POST /api/admin/emergency-freeze
 *
 * Emergency freeze all portfolio operations.
 * This is stronger than pause — it also blocks manual operations.
 */
adminRouter.post('/emergency-freeze', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const reason = (req.body?.reason as string) || 'No reason provided';
  const actor = getActorParty(req);

  if (adminState.frozen) {
    return res.status(400).json({
      success: false,
      error: 'Platform is already frozen',
    });
  }

  adminState.paused = true;
  adminState.frozen = true;
  addAuditEntry('emergency-freeze', actor, { reason });

  logger.error('EMERGENCY FREEZE activated', {
    component: 'admin',
    actor,
    reason,
  });

  logger.info('Admin action', {
    action: 'EMERGENCY_FREEZE',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { reason },
  });

  res.json({
    success: true,
    data: {
      frozen: true,
      paused: true,
      message: 'Emergency freeze activated — all operations halted',
      reason,
    },
  });
});

/**
 * GET /api/admin/audit-log
 *
 * Get recent admin actions.
 * Query parameter `limit` controls how many entries to return (default: 50).
 */
adminRouter.get('/audit-log', (req: Request, res: Response) => {
  if (req.actAs !== undefined && !req.actAs?.includes(config.platformParty) && req.partyId !== config.platformParty) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

  logger.info('Admin action', {
    action: 'GET_AUDIT_LOG',
    party: req.actAs?.[0] || req.partyId,
    timestamp: new Date().toISOString(),
    details: { limit },
  });

  res.json({
    success: true,
    data: adminState.auditLog.slice(0, limit),
  });
});
