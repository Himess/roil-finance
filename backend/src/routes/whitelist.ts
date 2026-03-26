import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { whitelistManager } from '../services/whitelist.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const JoinSchema = z.object({
  partyId: z.string().min(1),
  email: z.string().email().optional(),
});

const RedeemSchema = z.object({
  partyId: z.string().min(1),
  code: z.string().min(1).max(20),
});

const GenerateInviteSchema = z.object({
  partyId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const whitelistRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/whitelist/join — Join whitelist (if spots available)
// ---------------------------------------------------------------------------

whitelistRouter.post('/join', async (req: Request, res: Response) => {
  try {
    const parsed = JoinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }

    const { partyId, email } = parsed.data;

    // Check if already whitelisted
    if (whitelistManager.isWhitelisted(partyId)) {
      return res.json({
        success: true,
        data: {
          status: 'already_whitelisted',
          message: 'You are already on the whitelist',
        },
      });
    }

    // Check available spots
    const stats = whitelistManager.getStats();
    if (stats.spotsRemaining <= 0) {
      return res.status(409).json({
        success: false,
        error: 'Whitelist is full. Request an invite code from an existing member.',
        spotsRemaining: 0,
      });
    }

    const added = whitelistManager.addUser(partyId, email);
    if (!added) {
      return res.status(409).json({
        success: false,
        error: 'Could not join whitelist',
      });
    }

    res.status(201).json({
      success: true,
      data: {
        status: 'joined',
        partyId,
        message: 'Welcome to Roil Finance',
        spotsRemaining: stats.spotsRemaining - 1,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[whitelist] Join failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/whitelist/status — Check whitelist status for a user
// ---------------------------------------------------------------------------

whitelistRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const partyId = req.query.partyId as string || req.partyId;
    if (!partyId) {
      return res.status(400).json({ success: false, error: 'partyId query parameter is required' });
    }

    const entry = whitelistManager.getUserInfo(partyId);
    if (!entry) {
      return res.json({
        success: true,
        data: {
          isWhitelisted: false,
          partyId,
        },
      });
    }

    const remainingInvites = whitelistManager.getRemainingInvites(partyId);

    res.json({
      success: true,
      data: {
        isWhitelisted: true,
        isActive: entry.isActive,
        partyId: entry.partyId,
        email: entry.email ?? null,
        invitedBy: entry.invitedBy ?? null,
        joinedAt: entry.joinedAt,
        dailySwapUsed: entry.dailySwapUsed,
        lastSwapDate: entry.lastSwapDate || null,
        remainingInvites,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/whitelist/invite-codes — Generate invite code
// ---------------------------------------------------------------------------

whitelistRouter.post('/invite-codes', async (req: Request, res: Response) => {
  try {
    const parsed = GenerateInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }

    const { partyId } = parsed.data;

    if (!whitelistManager.isWhitelisted(partyId)) {
      return res.status(403).json({
        success: false,
        error: 'Must be whitelisted to generate invite codes',
      });
    }

    const remaining = whitelistManager.getRemainingInvites(partyId);
    if (remaining <= 0) {
      return res.status(429).json({
        success: false,
        error: 'No invite codes remaining. Each user gets 3 invite codes.',
        remaining: 0,
      });
    }

    const code = whitelistManager.generateInviteCode(partyId);
    if (!code) {
      return res.status(429).json({
        success: false,
        error: 'Could not generate invite code',
      });
    }

    res.status(201).json({
      success: true,
      data: {
        code,
        remaining: remaining - 1,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[whitelist] Generate invite failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/whitelist/invite-codes — Get user's invite codes
// ---------------------------------------------------------------------------

whitelistRouter.get('/invite-codes', async (req: Request, res: Response) => {
  try {
    const partyId = req.query.partyId as string || req.partyId;
    if (!partyId) {
      return res.status(400).json({ success: false, error: 'partyId query parameter is required' });
    }

    if (!whitelistManager.isWhitelisted(partyId)) {
      return res.status(403).json({
        success: false,
        error: 'Must be whitelisted to view invite codes',
      });
    }

    const codes = whitelistManager.getInviteCodes(partyId);
    const remaining = whitelistManager.getRemainingInvites(partyId);

    res.json({
      success: true,
      data: {
        codes,
        remaining,
        maxCodes: 3,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/whitelist/redeem — Redeem an invite code
// ---------------------------------------------------------------------------

whitelistRouter.post('/redeem', async (req: Request, res: Response) => {
  try {
    const parsed = RedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }

    const { partyId, code } = parsed.data;

    // Check if already whitelisted
    if (whitelistManager.isWhitelisted(partyId)) {
      return res.json({
        success: true,
        data: {
          status: 'already_whitelisted',
          message: 'You are already on the whitelist',
        },
      });
    }

    const redeemed = whitelistManager.redeemInviteCode(code, partyId);
    if (!redeemed) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or already used invite code, or whitelist is full',
      });
    }

    res.status(201).json({
      success: true,
      data: {
        status: 'joined_via_invite',
        partyId,
        message: 'Welcome to Roil Finance! You joined via invite.',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[whitelist] Redeem failed', { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/whitelist/stats — Public stats
// ---------------------------------------------------------------------------

whitelistRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = whitelistManager.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
