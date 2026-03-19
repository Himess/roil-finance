// ---------------------------------------------------------------------------
// Core Daml-mirror types
// ---------------------------------------------------------------------------

/** Matches Daml Types.AssetId */
export interface AssetId {
  symbol: string;
  admin: string;
}

/** Matches Daml Types.TargetAllocation */
export interface TargetAllocation {
  asset: AssetId;
  targetPct: number;
}

/** Matches Daml Types.Holding */
export interface Holding {
  asset: AssetId;
  amount: number;
  valueCc: number;
}

/** Matches Daml Types.TriggerMode */
export type TriggerMode =
  | { tag: 'Manual' }
  | { tag: 'DriftThreshold'; value: number }
  | { tag: 'PriceCondition'; value: { conditionAsset: string; targetPrice: number; conditionAction: string } };

/** Matches Daml Types.DCAFrequency */
export type DCAFrequency = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly';

/** Matches Daml Types.RewardTier */
export type RewardTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

/** Matches Daml Types.RebalanceStatus */
export type RebalanceStatus =
  | { tag: 'Pending' }
  | { tag: 'Executing' }
  | { tag: 'Completed' }
  | { tag: 'Failed'; reason: string };

/** Matches Daml Types.SwapLeg */
export interface SwapLeg {
  fromAsset: AssetId;
  toAsset: AssetId;
  fromAmount: number;
  toAmount: number;
}

// ---------------------------------------------------------------------------
// Contract payloads (what the API returns)
// ---------------------------------------------------------------------------

/** Matches Daml Portfolio.Portfolio */
export interface Portfolio {
  platform: string;
  user: string;
  targets: TargetAllocation[];
  holdings: Holding[];
  triggerMode: TriggerMode;
  totalRebalances: number;
  isActive: boolean;
}

/** Matches Daml DCA.DCASchedule */
export interface DCASchedule {
  platform: string;
  user: string;
  sourceAsset: AssetId;
  targetAsset: AssetId;
  amountPerBuy: number;
  frequency: DCAFrequency;
  totalExecutions: number;
  isActive: boolean;
  createdAt: string;
}

/** Matches Daml Portfolio.RebalanceLog */
export interface RebalanceLog {
  platform: string;
  user: string;
  swapLegs: SwapLeg[];
  driftBefore: number;
  timestamp: string;
}

/** Matches Daml DCA.DCALog */
export interface DCALog {
  platform: string;
  user: string;
  sourceAsset: AssetId;
  targetAsset: AssetId;
  sourceAmount: number;
  targetAmount: number;
  executionNumber: number;
  timestamp: string;
}

/** Matches Daml RewardTracker.RewardTracker */
export interface RewardTracker {
  platform: string;
  user: string;
  monthId: string;
  txCount: number;
  tier: RewardTier;
  consecutiveMonths: number;
  totalRewardsEarned: number;
}

/** Matches Daml RewardTracker.RewardPayout */
export interface RewardPayout {
  platform: string;
  user: string;
  amount: number;
  tier: RewardTier;
  monthId: string;
  txCount: number;
}

/** Matches Daml RewardTracker.Referral */
export interface Referral {
  platform: string;
  referrer: string;
  referee: string;
  isActive: boolean;
  referrerBonusPct: number;
}

/** Matches Daml RewardTracker.ReferralCredit */
export interface ReferralCredit {
  platform: string;
  referrer: string;
  referee: string;
  amount: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// UI-specific helper types
// ---------------------------------------------------------------------------

/** Market price feed entry */
export interface MarketPrice {
  symbol: string;
  priceUsd: number;
  change24h: number;
}

/** Liquidity pool info */
export interface Pool {
  id: string;
  assetA: AssetId;
  assetB: AssetId;
  reserveA: number;
  reserveB: number;
  feePct: number;
}

/** Combined activity entry for the swap history table */
export interface ActivityEntry {
  id: string;
  type: 'rebalance' | 'dca';
  timestamp: string;
  swapLegs: SwapLeg[];
  driftBefore?: number;
  status: 'completed' | 'pending' | 'failed';
}
