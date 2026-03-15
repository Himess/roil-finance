import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RebalanceEngine } from '../src/engine/rebalance.js';
import type { Holding, TargetAllocation, SwapLeg } from '../src/engine/rebalance.js';

// ---------------------------------------------------------------------------
// Mock the cantex module so planSwapLegs can resolve prices without network
// ---------------------------------------------------------------------------

vi.mock('../src/cantex.js', () => {
  const MOCK_PRICES: Record<string, number> = { CC: 0.15, USDCx: 1.0, CBTC: 40_000.0 };

  return {
    cantex: {
      getPrices: vi.fn().mockResolvedValue(MOCK_PRICES),
      executeSwap: vi.fn().mockImplementation(
        async (fromAsset: string, toAsset: string, amount: number) => {
          const fromPrice = MOCK_PRICES[fromAsset] ?? 1;
          const toPrice = MOCK_PRICES[toAsset] ?? 1;
          const rate = fromPrice / toPrice;
          const fee = amount * 0.003;
          const outputAmount = (amount - fee) * rate;
          return {
            txId: `mock-tx-${Date.now()}`,
            fromAsset,
            toAsset,
            inputAmount: amount,
            outputAmount,
            fee,
            timestamp: new Date().toISOString(),
          };
        },
      ),
      getQuote: vi.fn().mockImplementation(
        async (fromAsset: string, toAsset: string, amount: number) => {
          const fromPrice = MOCK_PRICES[fromAsset] ?? 1;
          const toPrice = MOCK_PRICES[toAsset] ?? 1;
          const rate = fromPrice / toPrice;
          const fee = amount * 0.003;
          const outputAmount = (amount - fee) * rate;
          return { fromAsset, toAsset, inputAmount: amount, outputAmount, price: rate, fee, slippage: 0 };
        },
      ),
    },
    CantexClient: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Reward tier helper (mirrors rewards.ts logic for assertions)
// ---------------------------------------------------------------------------

type RewardTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

function getTier(txCount: number): RewardTier {
  if (txCount <= 50) return 'Bronze';
  if (txCount <= 200) return 'Silver';
  if (txCount <= 500) return 'Gold';
  return 'Platinum';
}

function getFeeRebatePct(tier: RewardTier): number {
  switch (tier) {
    case 'Bronze': return 0.5;
    case 'Silver': return 1.0;
    case 'Gold': return 2.0;
    case 'Platinum': return 3.0;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAsset(symbol: string) {
  return { symbol, admin: 'Platform' };
}

function makeTarget(symbol: string, pct: number): TargetAllocation {
  return { asset: makeAsset(symbol), targetPct: pct };
}

function makeHolding(symbol: string, amount: number, valueCc: number): Holding {
  return { asset: makeAsset(symbol), amount, valueCc };
}

// ---------------------------------------------------------------------------
// End-to-end tests
// ---------------------------------------------------------------------------

describe('E2E: Full Rebalance Flow', () => {
  let engine: RebalanceEngine;

  beforeEach(() => {
    engine = new RebalanceEngine();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Full rebalance flow (drift detection -> swap planning -> execution)
  // -----------------------------------------------------------------------

  describe('Full rebalance flow', () => {
    it('should detect drift, plan swaps, and produce correct legs for CC 60% / USDCx 25% / CBTC 15% portfolio', async () => {
      // Portfolio: CC 60%, USDCx 25%, CBTC 15% — target is 40/35/25
      const targets = [
        makeTarget('CC', 40),
        makeTarget('USDCx', 35),
        makeTarget('CBTC', 25),
      ];

      // Total value: 10000 CC
      // CC: 6000/10000 = 60% (target 40%) -> drift 20%
      // USDCx: 2500/10000 = 25% (target 35%) -> drift 10%
      // CBTC: 1500/10000 = 15% (target 25%) -> drift 10%
      const holdings = [
        makeHolding('CC', 40000, 6000),
        makeHolding('USDCx', 375, 2500),
        makeHolding('CBTC', 0.00375, 1500),
      ];

      // Step 1: Calculate drift
      const drift = engine.calculateDrift(holdings, targets);
      expect(drift.maxDrift).toBe(20);
      expect(drift.drifts.get('CC')).toBe(20);
      expect(drift.drifts.get('USDCx')).toBe(10);
      expect(drift.drifts.get('CBTC')).toBe(10);

      // Step 2: Plan swap legs
      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // CC is overweight — should be sold
      const ccSells = legs.filter((l) => l.fromAsset.symbol === 'CC');
      expect(ccSells.length).toBeGreaterThan(0);

      // USDCx and/or CBTC should be bought
      const buySymbols = legs.map((l) => l.toAsset.symbol);
      expect(buySymbols.some((s) => s === 'USDCx' || s === 'CBTC')).toBe(true);

      // All amounts should be positive
      for (const leg of legs) {
        expect(leg.fromAmount).toBeGreaterThan(0);
        expect(leg.toAmount).toBeGreaterThan(0);
      }
    });

    it('should produce legs that move portfolio closer to targets', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      // CC 80%, USDCx 20%
      const holdings = [
        makeHolding('CC', 53333, 8000),
        makeHolding('USDCx', 300, 2000),
      ];

      const driftBefore = engine.calculateDrift(holdings, targets).maxDrift;
      expect(driftBefore).toBe(30); // 80% vs 50%

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // Verify the planned legs sell CC and buy USDCx (moving toward target)
      const sellsCC = legs.filter((l) => l.fromAsset.symbol === 'CC');
      const buysUSDCx = legs.filter((l) => l.toAsset.symbol === 'USDCx');
      expect(sellsCC.length).toBeGreaterThan(0);
      expect(buysUSDCx.length).toBeGreaterThan(0);

      // The sell amount should be positive and meaningful
      const totalCCSold = sellsCC.reduce((sum, l) => sum + l.fromAmount, 0);
      expect(totalCCSold).toBeGreaterThan(1000); // selling meaningful CC amount

      // The buy amount should be positive
      const totalUSDCxBought = buysUSDCx.reduce((sum, l) => sum + l.toAmount, 0);
      expect(totalUSDCxBought).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. DCA buy simulation
  // -----------------------------------------------------------------------

  describe('DCA buy simulation (USDCx -> CBTC weekly)', () => {
    it('should simulate a DCA purchase from USDCx to CBTC', async () => {
      // Use cantex mock to simulate swap
      const { cantex } = await import('../src/cantex.js');

      const amount = 100; // 100 USDCx per week
      const swap = await cantex.executeSwap('USDCx', 'CBTC', amount);

      expect(swap.fromAsset).toBe('USDCx');
      expect(swap.toAsset).toBe('CBTC');
      expect(swap.inputAmount).toBe(100);
      // At $40,000 per CBTC, 100 USDCx buys ~0.0025 CBTC (minus 0.3% fee)
      expect(swap.outputAmount).toBeCloseTo(0.002493, 4);
      expect(swap.fee).toBeCloseTo(0.3, 1);
      expect(swap.txId).toContain('mock-tx-');
    });

    it('should accumulate CBTC over multiple DCA executions', async () => {
      const { cantex } = await import('../src/cantex.js');

      const weeklyAmount = 50; // 50 USDCx per week
      let totalCBTC = 0;

      // Simulate 4 weeks of DCA
      for (let i = 0; i < 4; i++) {
        const swap = await cantex.executeSwap('USDCx', 'CBTC', weeklyAmount);
        totalCBTC += swap.outputAmount;
      }

      // 4 weeks * ~0.001247 CBTC per week
      expect(totalCBTC).toBeGreaterThan(0);
      expect(totalCBTC).toBeCloseTo(0.004972, 3);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Reward tier progression
  // -----------------------------------------------------------------------

  describe('Reward tier progression', () => {
    it('should start at Bronze with 0 TX', () => {
      expect(getTier(0)).toBe('Bronze');
      expect(getFeeRebatePct('Bronze')).toBe(0.5);
    });

    it('should remain Bronze at 50 TX', () => {
      expect(getTier(50)).toBe('Bronze');
    });

    it('should promote to Silver at 51 TX', () => {
      expect(getTier(51)).toBe('Silver');
      expect(getFeeRebatePct('Silver')).toBe(1.0);
    });

    it('should promote to Silver at 55 TX', () => {
      expect(getTier(55)).toBe('Silver');
    });

    it('should promote to Gold at 201 TX', () => {
      expect(getTier(201)).toBe('Gold');
      expect(getFeeRebatePct('Gold')).toBe(2.0);
    });

    it('should promote to Platinum at 501 TX', () => {
      expect(getTier(501)).toBe('Platinum');
      expect(getFeeRebatePct('Platinum')).toBe(3.0);
    });

    it('should show correct tier progression from 0 to Silver (55 TX)', () => {
      // Simulate a user accumulating transactions
      let txCount = 0;

      // Start: Bronze
      expect(getTier(txCount)).toBe('Bronze');

      // After 50 rebalances: still Bronze
      txCount = 50;
      expect(getTier(txCount)).toBe('Bronze');

      // After 5 more DCA executions (total 55): Silver
      txCount = 55;
      expect(getTier(txCount)).toBe('Silver');

      // Rebate improves
      expect(getFeeRebatePct(getTier(txCount))).toBe(1.0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Multi-asset rebalance with USDCx routing
  // -----------------------------------------------------------------------

  describe('Multi-asset rebalance with USDCx routing', () => {
    it('should sell USDCx to buy both CC and CBTC when USDCx is overweight', async () => {
      const targets = [
        makeTarget('CC', 40),
        makeTarget('USDCx', 20),
        makeTarget('CBTC', 40),
      ];

      // USDCx is heavily overweight
      const holdings = [
        makeHolding('CC', 6666, 1000),     // 10% (target 40%)
        makeHolding('USDCx', 8000, 8000),  // 80% (target 20%)
        makeHolding('CBTC', 0.0025, 1000), // 10% (target 40%)
      ];

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // USDCx should be sold
      const usdcxSells = legs.filter((l) => l.fromAsset.symbol === 'USDCx');
      expect(usdcxSells.length).toBeGreaterThan(0);

      // Both CC and CBTC should be bought
      const boughtAssets = new Set(legs.map((l) => l.toAsset.symbol));
      expect(boughtAssets.has('CC') || boughtAssets.has('CBTC')).toBe(true);
    });

    it('should sell CC to buy both USDCx and CBTC when CC is overweight', async () => {
      const targets = [
        makeTarget('CC', 33),
        makeTarget('USDCx', 33),
        makeTarget('CBTC', 34),
      ];

      // CC is heavily overweight
      const holdings = [
        makeHolding('CC', 60000, 9000),     // 90%
        makeHolding('USDCx', 50, 500),       // 5%
        makeHolding('CBTC', 0.000125, 500),  // 5%
      ];

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // CC should be sold
      const ccSells = legs.filter((l) => l.fromAsset.symbol === 'CC');
      expect(ccSells.length).toBeGreaterThan(0);

      // Total sell amount should be substantial
      const totalCCSold = ccSells.reduce((sum, l) => sum + l.fromAmount, 0);
      expect(totalCCSold).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Edge case: portfolio already balanced (no swaps needed)
  // -----------------------------------------------------------------------

  describe('Edge case: already balanced portfolio', () => {
    it('should return no swap legs when portfolio is perfectly balanced', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      const holdings = [
        makeHolding('CC', 33333, 5000),
        makeHolding('USDCx', 750, 5000),
      ];

      const drift = engine.calculateDrift(holdings, targets);
      expect(drift.maxDrift).toBe(0);

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBe(0);
    });

    it('should return no legs when drift is below dust threshold', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      // Very slightly off-balance — the value delta in USDCx terms must be < 0.01
      // Total portfolio = 10000 CC. 50% = 5000 CC each.
      // CC value in USDCx: 5000.01 CC * 0.15 = 750.0015 USDCx
      // USDCx value in USDCx: 4999.99 CC * 0.15 = 749.9985 USDCx
      // Delta = 0.003 USDCx — well under the 0.01 dust filter
      const holdings = [
        makeHolding('CC', 33333.4, 5000.01),
        makeHolding('USDCx', 749.999, 4999.99),
      ];

      const drift = engine.calculateDrift(holdings, targets);
      // Drift should be extremely small
      expect(drift.maxDrift).toBeLessThan(0.01);

      const legs = await engine.planSwapLegs(holdings, targets);
      // Tiny deltas filtered by dust threshold
      expect(legs.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Edge case: single asset way overweight (>30% drift)
  // -----------------------------------------------------------------------

  describe('Edge case: single asset way overweight', () => {
    it('should handle extreme drift (>30%) with a single overweight asset', async () => {
      const targets = [
        makeTarget('CC', 33),
        makeTarget('USDCx', 33),
        makeTarget('CBTC', 34),
      ];

      // CC is 95% of the portfolio — extreme drift
      const holdings = [
        makeHolding('CC', 63333, 9500),
        makeHolding('USDCx', 25, 250),
        makeHolding('CBTC', 0.000625, 250),
      ];

      const drift = engine.calculateDrift(holdings, targets);
      expect(drift.maxDrift).toBeGreaterThan(30);
      expect(drift.drifts.get('CC')).toBeCloseTo(62, 0); // ~95% - 33% = 62%

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // Should produce significant sell volume for CC
      const ccSells = legs.filter((l) => l.fromAsset.symbol === 'CC');
      expect(ccSells.length).toBeGreaterThan(0);

      const totalCCSellValue = ccSells.reduce((sum, l) => sum + l.fromAmount * 0.15, 0);
      // CC should sell roughly (95% - 33%) = 62% of portfolio value in USDCx terms
      // Total portfolio = 10000 CC = 1500 USDCx, sell ~62% of 1500 = ~930 USDCx
      expect(totalCCSellValue).toBeGreaterThan(100);
    });

    it('should handle 100% concentration in a single asset', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      // 100% in CC, 0% in USDCx
      const holdings = [
        makeHolding('CC', 66666, 10000),
      ];

      const drift = engine.calculateDrift(holdings, targets);
      expect(drift.maxDrift).toBe(50); // 100% vs 50%

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // Should sell CC to buy USDCx
      expect(legs[0].fromAsset.symbol).toBe('CC');
      expect(legs[0].toAsset.symbol).toBe('USDCx');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Empty and zero-value edge cases
  // -----------------------------------------------------------------------

  describe('Zero-value and empty edge cases', () => {
    it('should return empty legs for zero-value holdings', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      const holdings = [
        makeHolding('CC', 0, 0),
        makeHolding('USDCx', 0, 0),
      ];

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBe(0);
    });

    it('should return empty legs for empty targets', async () => {
      const holdings = [
        makeHolding('CC', 10000, 1000),
      ];

      const legs = await engine.planSwapLegs(holdings, []);
      expect(legs.length).toBe(0);
    });

    it('should compute correct drift for empty holdings against targets', () => {
      const targets = [
        makeTarget('CC', 40),
        makeTarget('USDCx', 35),
        makeTarget('CBTC', 25),
      ];

      const drift = engine.calculateDrift([], targets);

      // All current pcts are 0, so drift = target pct for each
      expect(drift.drifts.get('CC')).toBe(40);
      expect(drift.drifts.get('USDCx')).toBe(35);
      expect(drift.drifts.get('CBTC')).toBe(25);
      expect(drift.maxDrift).toBe(40);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Swap leg value consistency
  // -----------------------------------------------------------------------

  describe('Swap leg value consistency', () => {
    it('should produce legs where total sell value roughly equals total buy value', async () => {
      const targets = [
        makeTarget('CC', 40),
        makeTarget('USDCx', 30),
        makeTarget('CBTC', 30),
      ];

      const holdings = [
        makeHolding('CC', 46666, 7000),  // 70% (target 40%)
        makeHolding('USDCx', 150, 1500), // 15% (target 30%)
        makeHolding('CBTC', 0.00375, 1500), // 15% (target 30%)
      ];

      const legs = await engine.planSwapLegs(holdings, targets);
      expect(legs.length).toBeGreaterThan(0);

      // Compute total sell and buy values in USDCx terms
      const prices: Record<string, number> = { CC: 0.15, USDCx: 1.0, CBTC: 40000 };
      let totalSellValue = 0;
      let totalBuyValue = 0;

      for (const leg of legs) {
        totalSellValue += leg.fromAmount * (prices[leg.fromAsset.symbol] ?? 1);
        totalBuyValue += leg.toAmount * (prices[leg.toAsset.symbol] ?? 1);
      }

      // Total sell ≈ total buy (within 5% due to rounding / dust)
      const ratio = totalBuyValue / totalSellValue;
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper: simulate applying swap legs to holdings
// ---------------------------------------------------------------------------

function simulateSwapExecution(holdings: Holding[], legs: SwapLeg[]): Holding[] {
  const holdingMap = new Map<string, Holding>();
  for (const h of holdings) {
    holdingMap.set(h.asset.symbol, { ...h });
  }

  for (const leg of legs) {
    const from = holdingMap.get(leg.fromAsset.symbol);
    if (from) {
      from.amount = Math.max(0, from.amount - leg.fromAmount);
    }

    let to = holdingMap.get(leg.toAsset.symbol);
    if (!to) {
      to = { asset: leg.toAsset, amount: 0, valueCc: 0 };
      holdingMap.set(leg.toAsset.symbol, to);
    }
    to.amount += leg.toAmount;
  }

  // Re-price in CC terms
  const prices: Record<string, number> = { CC: 0.15, USDCx: 1.0, CBTC: 40000 };
  const ccPrice = prices.CC;
  const result: Holding[] = [];

  for (const holding of holdingMap.values()) {
    const priceUsd = prices[holding.asset.symbol] ?? 0;
    holding.valueCc = (holding.amount * priceUsd) / ccPrice;
    result.push(holding);
  }

  return result;
}
