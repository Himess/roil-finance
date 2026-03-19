import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies that rewards.ts imports at module level
// ---------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  config: {
    platformParty: 'test-platform::1220abc',
    network: 'localnet',
    minTxValue: 10.0,
    damlPackageName: 'canton-rebalancer',
  },
  TEMPLATES: {
    RewardTracker: '#canton-rebalancer:RewardTracker:RewardTracker',
    RewardPayout: '#canton-rebalancer:RewardTracker:RewardPayout',
  },
}));

vi.mock('../src/ledger.js', () => ({
  ledger: {
    query: vi.fn().mockResolvedValue([]),
    createAs: vi.fn().mockResolvedValue('mock-id'),
    exerciseAs: vi.fn().mockResolvedValue('mock-result'),
  },
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  getTier,
  getFeeRebatePct,
  txToNextTier,
  calculateRewardAmount,
  parseTier,
  currentMonthId,
  type RewardTier,
} from '../src/engine/rewards.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rewards Engine', () => {
  // -----------------------------------------------------------------------
  // getTier
  // -----------------------------------------------------------------------

  describe('getTier', () => {
    it('returns Bronze for 0-50 txs', () => {
      expect(getTier(0)).toBe('Bronze');
      expect(getTier(25)).toBe('Bronze');
      expect(getTier(50)).toBe('Bronze');
    });

    it('returns Silver for 51-200 txs', () => {
      expect(getTier(51)).toBe('Silver');
      expect(getTier(100)).toBe('Silver');
      expect(getTier(200)).toBe('Silver');
    });

    it('returns Gold for 201-500 txs', () => {
      expect(getTier(201)).toBe('Gold');
      expect(getTier(350)).toBe('Gold');
      expect(getTier(500)).toBe('Gold');
    });

    it('returns Platinum for 501+ txs', () => {
      expect(getTier(501)).toBe('Platinum');
      expect(getTier(1000)).toBe('Platinum');
      expect(getTier(99999)).toBe('Platinum');
    });

    it('handles boundary values correctly', () => {
      expect(getTier(50)).toBe('Bronze');
      expect(getTier(51)).toBe('Silver');
      expect(getTier(200)).toBe('Silver');
      expect(getTier(201)).toBe('Gold');
      expect(getTier(500)).toBe('Gold');
      expect(getTier(501)).toBe('Platinum');
    });
  });

  // -----------------------------------------------------------------------
  // getFeeRebatePct
  // -----------------------------------------------------------------------

  describe('getFeeRebatePct', () => {
    it('returns correct rebate for each tier', () => {
      expect(getFeeRebatePct('Bronze')).toBe(0.5);
      expect(getFeeRebatePct('Silver')).toBe(1.0);
      expect(getFeeRebatePct('Gold')).toBe(2.0);
      expect(getFeeRebatePct('Platinum')).toBe(3.0);
    });
  });

  // -----------------------------------------------------------------------
  // txToNextTier
  // -----------------------------------------------------------------------

  describe('txToNextTier', () => {
    it('calculates correct remaining txs for Bronze', () => {
      expect(txToNextTier(0, 'Bronze')).toBe(51);
      expect(txToNextTier(25, 'Bronze')).toBe(26);
      expect(txToNextTier(50, 'Bronze')).toBe(1);
    });

    it('calculates correct remaining txs for Silver', () => {
      expect(txToNextTier(51, 'Silver')).toBe(150);
      expect(txToNextTier(100, 'Silver')).toBe(101);
      expect(txToNextTier(200, 'Silver')).toBe(1);
    });

    it('returns 0 for Platinum', () => {
      expect(txToNextTier(501, 'Platinum')).toBe(0);
      expect(txToNextTier(1000, 'Platinum')).toBe(0);
      expect(txToNextTier(0, 'Platinum')).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // calculateRewardAmount
  // -----------------------------------------------------------------------

  describe('calculateRewardAmount', () => {
    it('calculates reward correctly', () => {
      // Bronze: 0.10 CC per TX
      expect(calculateRewardAmount('Bronze', 10)).toBe(1.0);
      expect(calculateRewardAmount('Bronze', 50)).toBe(5.0);

      // Silver: 0.25 CC per TX
      expect(calculateRewardAmount('Silver', 100)).toBe(25.0);

      // Gold: 0.50 CC per TX
      expect(calculateRewardAmount('Gold', 200)).toBe(100.0);

      // Platinum: 1.00 CC per TX
      expect(calculateRewardAmount('Platinum', 500)).toBe(500.0);

      // Zero TXs
      expect(calculateRewardAmount('Bronze', 0)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // parseTier
  // -----------------------------------------------------------------------

  describe('parseTier', () => {
    it('parses string tier', () => {
      expect(parseTier('Bronze')).toBe('Bronze');
      expect(parseTier('Silver')).toBe('Silver');
      expect(parseTier('Gold')).toBe('Gold');
      expect(parseTier('Platinum')).toBe('Platinum');
    });

    it('parses object tier with tag', () => {
      expect(parseTier({ tag: 'Bronze' })).toBe('Bronze');
      expect(parseTier({ tag: 'Silver' })).toBe('Silver');
      expect(parseTier({ tag: 'Gold' })).toBe('Gold');
      expect(parseTier({ tag: 'Platinum' })).toBe('Platinum');
    });

    it('defaults to Bronze for unknown', () => {
      // When tag is missing from the object, parseTier falls back via ??
      expect(parseTier({ tag: 'Bronze' })).toBe('Bronze');
      // String unknown values pass through as-is (cast), but default object
      // with no tag defaults to Bronze
      const noTag = {} as { tag: string };
      expect(parseTier(noTag)).toBe('Bronze');
    });
  });

  // -----------------------------------------------------------------------
  // currentMonthId
  // -----------------------------------------------------------------------

  describe('currentMonthId', () => {
    it('returns YYYY-MM format', () => {
      const monthId = currentMonthId();
      // Should match pattern YYYY-MM
      expect(monthId).toMatch(/^\d{4}-\d{2}$/);

      // Should reflect current year and month
      const now = new Date();
      const expectedYear = now.getFullYear();
      const expectedMonth = String(now.getMonth() + 1).padStart(2, '0');
      expect(monthId).toBe(`${expectedYear}-${expectedMonth}`);
    });
  });
});
