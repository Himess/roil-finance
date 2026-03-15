import { useQuery } from './useApi';
import type { RewardTracker, RewardPayout, RewardTier } from '@/types';
import { TIER_THRESHOLDS, FEE_REBATE_PCT } from '@/config';

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_TRACKER: RewardTracker = {
  platform: 'Canton::Platform',
  user: 'Canton::Alice',
  monthId: '2026-03',
  txCount: 87,
  tier: 'Silver',
  consecutiveMonths: 4,
  totalRewardsEarned: 142.5,
};

const DEMO_PAYOUTS: RewardPayout[] = [
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    amount: 45.0,
    tier: 'Silver',
    monthId: '2026-02',
    txCount: 112,
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    amount: 38.5,
    tier: 'Silver',
    monthId: '2026-01',
    txCount: 98,
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    amount: 32.0,
    tier: 'Bronze',
    monthId: '2025-12',
    txCount: 45,
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    amount: 27.0,
    tier: 'Bronze',
    monthId: '2025-11',
    txCount: 38,
  },
];

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface RewardStats {
  tracker: RewardTracker;
  tier: RewardTier;
  txCount: number;
  consecutiveMonths: number;
  totalEarned: number;
  feeRebatePct: number;
  nextTier: RewardTier | null;
  txToNextTier: number;
  progressPct: number;
}

/**
 * Fetch reward stats for a party.
 * GET /api/rewards/:party
 */
export function useRewards(party?: string) {
  const path = party ? `/api/rewards/${encodeURIComponent(party)}` : null;
  const query = useQuery<RewardTracker>(path, [party]);

  const tracker = query.data ?? DEMO_TRACKER;

  const tier = tracker.tier;
  const txCount = tracker.txCount;

  // Calculate next tier progress
  const tierOrder: RewardTier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const currentTierIndex = tierOrder.indexOf(tier);
  const nextTier =
    currentTierIndex < tierOrder.length - 1
      ? tierOrder[currentTierIndex + 1]
      : null;

  const currentRange = TIER_THRESHOLDS[tier];
  const nextThreshold = nextTier ? TIER_THRESHOLDS[nextTier].min : currentRange.max;
  const progressPct =
    nextTier
      ? Math.min(
          100,
          ((txCount - currentRange.min) / (nextThreshold - currentRange.min)) *
            100,
        )
      : 100;
  const txToNextTier = nextTier ? Math.max(0, nextThreshold - txCount) : 0;

  const stats: RewardStats = {
    tracker,
    tier,
    txCount,
    consecutiveMonths: tracker.consecutiveMonths,
    totalEarned: tracker.totalRewardsEarned,
    feeRebatePct: FEE_REBATE_PCT[tier],
    nextTier,
    txToNextTier,
    progressPct,
  };

  return {
    stats,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isFromBackend: query.isFromBackend,
  };
}

/**
 * Fetch payout history.
 * GET /api/rewards/:party/history
 */
export function usePayoutHistory(party?: string) {
  const path = party
    ? `/api/rewards/${encodeURIComponent(party)}/history`
    : null;
  const query = useQuery<RewardPayout[]>(path, [party]);

  const payouts = query.data ?? DEMO_PAYOUTS;
  return {
    payouts,
    isLoading: query.isLoading,
    error: query.error,
    isFromBackend: query.isFromBackend,
  };
}
