import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rewardsEngine } from '../engine/rewards.js';
import { requireParty } from '../middleware/auth.js';
import { config, TEMPLATES } from '../config.js';
import { ledger } from '../ledger.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateReferralSchema = z.object({
  referrer: z.string().min(1),
  referee: z.string().min(1),
  referrerBonusPct: z.number().min(0).max(100).optional().default(10),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const rewardsRouter = Router();

/**
 * GET /api/rewards/leaderboard
 *
 * Privacy-preserving leaderboard of top users by tier and TX count.
 * Party identifiers are anonymized.
 */
rewardsRouter.get('/leaderboard', async (_req, res) => {
  try {
    const trackers = await ledger.query(TEMPLATES.RewardTracker, config.platformParty);
    const leaderboard = trackers
      .map((t: any) => ({
        rank: 0,
        tier: typeof t.payload.tier === 'string' ? t.payload.tier : t.payload.tier?.tag || 'Bronze',
        txCount: parseInt(t.payload.txCount) || 0,
        // Privacy: only show truncated anonymous ID, not real party
        anonymousId: `user-${Buffer.from(t.payload.user || '').toString('base64url').slice(0, 6)}`,
      }))
      .sort((a: any, b: any) => b.txCount - a.txCount)
      .slice(0, 20)
      .map((entry: any, i: number) => ({ ...entry, rank: i + 1 }));

    res.json({ success: true, data: leaderboard });
  } catch {
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/rewards/:party
 *
 * Get current reward stats and tier for a party.
 */
rewardsRouter.get('/:party', requireParty('party'), async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const stats = await rewardsEngine.getRewardStats(party!);
    res.json({ success: true, data: stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/rewards/:party/history
 *
 * Get reward payout history for a party.
 */
rewardsRouter.get('/:party/history', requireParty('party'), async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const history = await rewardsEngine.getPayoutHistory(party!);
    res.json({ success: true, data: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/rewards/referral — create a referral
rewardsRouter.post('/referral', async (req, res) => {
  try {
    const parsed = CreateReferralSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }
    const { referrer, referee, referrerBonusPct } = parsed.data;
    const contractId = await ledger.createAs(
      TEMPLATES.Referral,
      {
        platform: config.platformParty,
        referrer,
        referee,
        referrerBonusPct: String(referrerBonusPct || 10.0),
        isActive: true,
      },
      config.platformParty,
    );
    res.status(201).json({ success: true, data: { contractId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/rewards/:party/referrals — list referrals
rewardsRouter.get('/:party/referrals', requireParty('party'), async (req, res) => {
  try {
    const { party } = req.params as Record<string, string>;
    const referrals = await ledger.query(TEMPLATES.Referral, party!);
    res.json({ success: true, data: referrals });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
