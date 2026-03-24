import { config, TEMPLATES } from '../config.js';
import { ledger } from '../ledger.js';
import { logger } from '../monitoring/logger.js';
import { featuredApp } from './featured-app.js';
import { decimalToNumber } from '../utils/decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RewardTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface RewardTrackerPayload {
  platform: string;
  user: string;
  monthId: string;
  txCount: number;
  tier: string | { tag: string };
  consecutiveMonths: number;
  totalRewardsEarned: string; // Daml Decimal
}

export interface RewardPayoutPayload {
  platform: string;
  user: string;
  amount: string;
  tier: string | { tag: string };
  monthId: string;
  txCount: number;
}

export interface RewardStats {
  user: string;
  monthId: string;
  txCount: number;
  tier: RewardTier;
  consecutiveMonths: number;
  totalRewardsEarned: number;
  feeRebatePct: number;
  nextTier: RewardTier | null;
  txToNextTier: number;
}

export interface PayoutRecord {
  amount: number;
  tier: RewardTier;
  monthId: string;
  txCount: number;
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

/** Determine reward tier from monthly TX count — mirrors Daml getTier */
export function getTier(txCount: number): RewardTier {
  if (txCount <= 50) return 'Bronze';
  if (txCount <= 200) return 'Silver';
  if (txCount <= 500) return 'Gold';
  return 'Platinum';
}

/** Fee rebate percentage per tier — mirrors Daml getFeeRebatePct */
export function getFeeRebatePct(tier: RewardTier): number {
  switch (tier) {
    case 'Bronze':
      return 0.5;
    case 'Silver':
      return 1.0;
    case 'Gold':
      return 2.0;
    case 'Platinum':
      return 3.0;
  }
}

/** Get the next tier above the current one, or null if at max */
export function getNextTier(tier: RewardTier): RewardTier | null {
  switch (tier) {
    case 'Bronze':
      return 'Silver';
    case 'Silver':
      return 'Gold';
    case 'Gold':
      return 'Platinum';
    case 'Platinum':
      return null;
  }
}

/** TXs needed to reach the next tier */
export function txToNextTier(currentTxCount: number, tier: RewardTier): number {
  switch (tier) {
    case 'Bronze':
      return Math.max(0, 51 - currentTxCount);
    case 'Silver':
      return Math.max(0, 201 - currentTxCount);
    case 'Gold':
      return Math.max(0, 501 - currentTxCount);
    case 'Platinum':
      return 0; // already max
  }
}

/** Parse Daml tier variant encoding into a tier string */
export function parseTier(tier: string | { tag: string }): RewardTier {
  if (typeof tier === 'string') return tier as RewardTier;
  return (tier.tag ?? 'Bronze') as RewardTier;
}

/** Get current month ID in YYYY-MM format */
export function currentMonthId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Calculate reward amount based on tier and TX count.
 * Higher tiers earn more CC tokens per TX.
 *
 * Base rewards (CC per qualifying TX):
 * - Bronze:   0.10 CC
 * - Silver:   0.25 CC
 * - Gold:     0.50 CC
 * - Platinum: 1.00 CC
 */
export function calculateRewardAmount(tier: RewardTier, txCount: number): number {
  const ratePerTx: Record<RewardTier, number> = {
    Bronze: 0.1,
    Silver: 0.25,
    Gold: 0.5,
    Platinum: 1.0,
  };
  return txCount * (ratePerTx[tier] ?? 0.1);
}

// ---------------------------------------------------------------------------
// RewardsEngine
// ---------------------------------------------------------------------------

/**
 * Manages reward tracking, tier calculation, and monthly reward distribution.
 *
 * Each user has one RewardTracker per month. When a qualifying transaction
 * occurs (rebalance, DCA, etc.), the engine records it on the tracker.
 * At month-end, rewards are distributed based on tier.
 */
export class RewardsEngine {
  // -----------------------------------------------------------------------
  // TX Recording
  // -----------------------------------------------------------------------

  /**
   * Record a qualifying transaction for a user.
   *
   * If no RewardTracker exists for the current month, one is created first.
   */
  async recordTransaction(userId: string, txValue: number): Promise<void> {
    const platform = config.platformParty;
    const monthId = currentMonthId();

    // Find existing tracker for this user + month
    const trackers = await ledger.query<RewardTrackerPayload>(TEMPLATES.RewardTracker, platform);
    const tracker = trackers.find(
      (t) => t.payload.user === userId && t.payload.monthId === monthId,
    );

    if (tracker) {
      // Exercise RecordTx on existing tracker
      await ledger.exerciseAs(
        TEMPLATES.RewardTracker,
        tracker.contractId,
        'RecordTx',
        {
          txMinValue: String(config.minTxValue),
          txValue: String(txValue),
        },
        platform,
      );
    } else {
      // Create a new tracker for this month, then record the TX
      const createResult = await ledger.createAs(
        TEMPLATES.RewardTracker,
        {
          platform,
          user: userId,
          monthId,
          txCount: 0,
          tier: { tag: 'Bronze', value: {} },
          previousTier: null, // Canton JSON API v2: null = Daml Optional None
          consecutiveMonths: 0,
          totalRewardsEarned: '0.0',
        },
        platform,
      );

      await ledger.exerciseAs(
        TEMPLATES.RewardTracker,
        createResult,
        'RecordTx',
        {
          txMinValue: String(config.minTxValue),
          txValue: String(txValue),
        },
        platform,
      );
    }

    // After successful TX recording, check for referrals and credit referrer
    try {
      const referrals = await ledger.query(TEMPLATES.Referral, platform);
      const userReferral = referrals.find((r: any) => r.payload.referee === userId);
      if (userReferral && (userReferral.payload as any).isActive) {
        await ledger.exerciseAs(
          TEMPLATES.Referral,
          userReferral.contractId,
          'CreditReferrer',
          { refereeTxValue: String(txValue), timestamp: new Date().toISOString() },
          platform,
        );
        logger.info('Referral credit recorded', { referee: userId, referrer: (userReferral.payload as any).referrer });
      }
    } catch (err) {
      logger.warn('Referral credit failed', { error: String(err) });
    }
  }

  // -----------------------------------------------------------------------
  // Stats query
  // -----------------------------------------------------------------------

  /**
   * Get comprehensive reward stats for a user.
   * Returns the current month's tracker data enriched with tier info.
   */
  async getRewardStats(userId: string): Promise<RewardStats | null> {
    const platform = config.platformParty;
    const monthId = currentMonthId();

    const trackers = await ledger.query<RewardTrackerPayload>(TEMPLATES.RewardTracker, platform);
    const tracker = trackers.find(
      (t) => t.payload.user === userId && t.payload.monthId === monthId,
    );

    if (!tracker) {
      // Return default stats for a user with no activity this month
      return {
        user: userId,
        monthId,
        txCount: 0,
        tier: 'Bronze',
        consecutiveMonths: 0,
        totalRewardsEarned: 0,
        feeRebatePct: getFeeRebatePct('Bronze'),
        nextTier: 'Silver',
        txToNextTier: 51,
      };
    }

    const { payload } = tracker;
    const tier = parseTier(payload.tier);

    return {
      user: userId,
      monthId: payload.monthId,
      txCount: payload.txCount,
      tier,
      consecutiveMonths: payload.consecutiveMonths,
      totalRewardsEarned: Number(payload.totalRewardsEarned),
      feeRebatePct: getFeeRebatePct(tier),
      nextTier: getNextTier(tier),
      txToNextTier: txToNextTier(payload.txCount, tier),
    };
  }

  // -----------------------------------------------------------------------
  // Payout history
  // -----------------------------------------------------------------------

  /**
   * Get reward payout history for a user.
   */
  async getPayoutHistory(userId: string): Promise<PayoutRecord[]> {
    const platform = config.platformParty;
    const payouts = await ledger.query<RewardPayoutPayload>(TEMPLATES.RewardPayout, platform);

    return payouts
      .filter((p) => p.payload.user === userId)
      .map((p) => ({
        amount: decimalToNumber(p.payload.amount),
        tier: parseTier(p.payload.tier),
        monthId: p.payload.monthId,
        txCount: p.payload.txCount,
      }))
      .sort((a, b) => b.monthId.localeCompare(a.monthId));
  }

  // -----------------------------------------------------------------------
  // Monthly reward distribution
  // -----------------------------------------------------------------------

  /**
   * Distribute monthly rewards to all users.
   *
   * Called at the end of each month (or beginning of the next). For each
   * user's RewardTracker, exercises `DistributeReward` which:
   * 1. Creates a RewardPayout record
   * 2. Rolls the tracker over to the new month
   */
  async distributeMonthlyRewards(): Promise<{ distributed: number; failed: number }> {
    const platform = config.platformParty;

    // Determine the previous month's ID (we distribute for the month just ended)
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthId = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const newMonthId = currentMonthId();

    let distributed = 0;
    let failed = 0;

    try {
      const trackers = await ledger.query<RewardTrackerPayload>(TEMPLATES.RewardTracker, platform);
      const prevTrackers = trackers.filter((t) => t.payload.monthId === prevMonthId);

      for (const tracker of prevTrackers) {
        try {
          const { payload } = tracker;
          const tier = parseTier(payload.tier);
          const rewardAmount = calculateRewardAmount(tier, payload.txCount);

          if (rewardAmount <= 0) {
            continue; // No reward for 0 TXs
          }

          await ledger.exerciseAs(
            TEMPLATES.RewardTracker,
            tracker.contractId,
            'DistributeReward',
            {
              rewardAmount: String(rewardAmount),
              newMonthId,
            },
            platform,
          );

          logger.info(
            `Distributed ${rewardAmount.toFixed(2)} CC to ${payload.user} ` +
              `(tier=${tier}, txCount=${payload.txCount}, month=${prevMonthId})`,
            { component: 'rewards' },
          );

          // Record Featured App activity for reward distribution
          try {
            await featuredApp.recordRewardDistribution(
              payload.user,
              rewardAmount,
              tier,
              prevMonthId,
            );
          } catch {
            // Best effort — don't fail the distribution for activity recording
          }

          distributed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Failed for ${tracker.payload.user}: ${message}`, { component: 'rewards' });
          failed++;
        }
      }
    } catch (err) {
      logger.error('Error distributing rewards', { component: 'rewards', error: err instanceof Error ? err.message : String(err) });
    }

    return { distributed, failed };
  }
}

/** Singleton instance */
export const rewardsEngine = new RewardsEngine();
