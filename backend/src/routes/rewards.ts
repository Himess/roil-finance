import { Router, type Request, type Response } from 'express';
import { rewardsEngine } from '../engine/rewards.js';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const rewardsRouter = Router();

/**
 * GET /api/rewards/:party
 *
 * Get current reward stats and tier for a party.
 */
rewardsRouter.get('/:party', async (req: Request, res: Response) => {
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
rewardsRouter.get('/:party/history', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const history = await rewardsEngine.getPayoutHistory(party!);
    res.json({ success: true, data: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
