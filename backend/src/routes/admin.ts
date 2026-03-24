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

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, INSTRUMENTS } from '../config.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { logger } from '../monitoring/logger.js';

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

// All admin routes require platform party authentication
adminRouter.use(requireAdmin);

/**
 * GET /api/admin/status
 *
 * Get current platform admin status.
 */
adminRouter.get('/status', (_req: Request, res: Response) => {
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
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

  res.json({
    success: true,
    data: adminState.auditLog.slice(0, limit),
  });
});
