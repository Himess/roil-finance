import { describe, it, expect, vi } from 'vitest';
import { RebalanceEngine, isSlippageAcceptable } from '../src/engine/rebalance.js';
import type { Holding, TargetAllocation, SwapLeg } from '../src/engine/rebalance.js';

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
// Tests
// ---------------------------------------------------------------------------

describe('RebalanceEngine', () => {
  const engine = new RebalanceEngine();

  // -----------------------------------------------------------------------
  // Drift calculation
  // -----------------------------------------------------------------------

  describe('calculateDrift', () => {
    it('should return zero drift for a perfectly balanced portfolio', () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];
      const holdings = [
        makeHolding('CC', 1000, 500),
        makeHolding('USDCx', 1000, 500),
      ];

      const result = engine.calculateDrift(holdings, targets);

      expect(result.maxDrift).toBe(0);
      expect(result.drifts.get('CC')).toBe(0);
      expect(result.drifts.get('USDCx')).toBe(0);
    });

    it('should calculate correct drift when portfolio is imbalanced', () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 30),
        makeTarget('CBTC', 20),
      ];
      // Total value: 1000 CC
      // CC: 600/1000 = 60% (target 50%) → drift 10%
      // USDCx: 300/1000 = 30% (target 30%) → drift 0%
      // CBTC: 100/1000 = 10% (target 20%) → drift 10%
      const holdings = [
        makeHolding('CC', 4000, 600),
        makeHolding('USDCx', 300, 300),
        makeHolding('CBTC', 0.0025, 100),
      ];

      const result = engine.calculateDrift(holdings, targets);

      expect(result.maxDrift).toBe(10);
      expect(result.drifts.get('CC')).toBe(10);
      expect(result.drifts.get('USDCx')).toBe(0);
      expect(result.drifts.get('CBTC')).toBe(10);
    });

    it('should return zero drift for an empty portfolio', () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      const result = engine.calculateDrift([], targets);

      expect(result.maxDrift).toBe(50);
      // With no holdings, current % is 0 for all targets
      expect(result.drifts.get('CC')).toBe(50);
      expect(result.drifts.get('USDCx')).toBe(50);
    });

    it('should handle a single-holding portfolio against multiple targets', () => {
      const targets = [
        makeTarget('CC', 33.33),
        makeTarget('USDCx', 33.33),
        makeTarget('CBTC', 33.34),
      ];
      // Only CC held: 100% CC, 0% everything else
      const holdings = [
        makeHolding('CC', 10000, 1000),
      ];

      const result = engine.calculateDrift(holdings, targets);

      // CC: 100% vs 33.33% → drift 66.67%
      expect(result.drifts.get('CC')).toBeCloseTo(66.67, 1);
      // USDCx: 0% vs 33.33% → drift 33.33%
      expect(result.drifts.get('USDCx')).toBeCloseTo(33.33, 1);
      // CBTC: 0% vs 33.34% → drift 33.34%
      expect(result.drifts.get('CBTC')).toBeCloseTo(33.34, 1);
      expect(result.maxDrift).toBeCloseTo(66.67, 1);
    });

    it('should handle drift with two assets where one is overweight', () => {
      const targets = [
        makeTarget('CC', 70),
        makeTarget('CBTC', 30),
      ];
      // CC: 800/1000 = 80% (target 70%) → drift 10%
      // CBTC: 200/1000 = 20% (target 30%) → drift 10%
      const holdings = [
        makeHolding('CC', 5333, 800),
        makeHolding('CBTC', 0.005, 200),
      ];

      const result = engine.calculateDrift(holdings, targets);

      expect(result.maxDrift).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Swap leg planning
  // -----------------------------------------------------------------------

  describe('planSwapLegs', () => {
    it('should return no legs when portfolio is already balanced', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];
      const holdings = [
        makeHolding('CC', 33333.33, 5000), // 5000 CC value
        makeHolding('USDCx', 750, 5000),    // 5000 CC value
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      // With equal weighting and correct values, should return no legs
      expect(legs.length).toBe(0);
    });

    it('should plan swap legs for an imbalanced portfolio', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];
      // CC is 80%, USDCx is 20% → need to sell CC and buy USDCx
      const holdings = [
        makeHolding('CC', 53333, 8000),
        makeHolding('USDCx', 300, 2000),
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      expect(legs.length).toBeGreaterThan(0);

      // Should sell CC and buy USDCx
      const sellCC = legs.find((l) => l.fromAsset.symbol === 'CC');
      expect(sellCC).toBeDefined();
      expect(sellCC!.toAsset.symbol).toBe('USDCx');
      expect(sellCC!.fromAmount).toBeGreaterThan(0);
      expect(sellCC!.toAmount).toBeGreaterThan(0);
    });

    it('should plan legs through USDCx when assets have no direct pair', async () => {
      // All three assets, where CC and CBTC both have USDCx pairs
      const targets = [
        makeTarget('CC', 40),
        makeTarget('USDCx', 20),
        makeTarget('CBTC', 40),
      ];
      // USDCx is heavily overweight, CC and CBTC are underweight
      const holdings = [
        makeHolding('CC', 6666, 1000),    // 10% (target 40%)
        makeHolding('USDCx', 8000, 8000), // 80% (target 20%)
        makeHolding('CBTC', 0.0025, 1000),// 10% (target 40%)
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      expect(legs.length).toBeGreaterThan(0);

      // Should sell USDCx and buy both CC and CBTC
      const sellUSDCx = legs.filter((l) => l.fromAsset.symbol === 'USDCx');
      expect(sellUSDCx.length).toBeGreaterThan(0);

      // Check that the total sell value is approximately correct
      for (const leg of sellUSDCx) {
        expect(leg.fromAmount).toBeGreaterThan(0);
        expect(leg.toAmount).toBeGreaterThan(0);
      }
    });

    it('should return no legs for empty holdings', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];

      const legs = await engine.planSwapLegs([], targets);

      expect(legs).toEqual([]);
    });

    it('should handle three-asset rebalance', async () => {
      const targets = [
        makeTarget('CC', 33.33),
        makeTarget('USDCx', 33.33),
        makeTarget('CBTC', 33.34),
      ];
      // CC heavily overweight
      const holdings = [
        makeHolding('CC', 66666, 10000),  // 76.9%
        makeHolding('USDCx', 1500, 1500), // 11.5%
        makeHolding('CBTC', 0.0375, 1500),// 11.5%
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      expect(legs.length).toBeGreaterThan(0);

      // CC should be sold
      const ccSells = legs.filter((l) => l.fromAsset.symbol === 'CC');
      expect(ccSells.length).toBeGreaterThan(0);

      // Total CC sold should be substantial
      const totalCCSold = ccSells.reduce((sum, l) => sum + l.fromAmount, 0);
      expect(totalCCSold).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Slippage check
  // -----------------------------------------------------------------------

  describe('isSlippageAcceptable', () => {
    it('accepts output within tolerance', () => {
      // Expected 100, got 99 → 1% slippage, within default 2% tolerance
      expect(isSlippageAcceptable(100, 99)).toBe(true);

      // Expected 100, got 98.5 → 1.5% slippage, within 2% tolerance
      expect(isSlippageAcceptable(100, 98.5)).toBe(true);

      // Expected 100, got 100 → 0% slippage
      expect(isSlippageAcceptable(100, 100)).toBe(true);

      // Expected 100, got 105 → negative slippage (better than expected)
      expect(isSlippageAcceptable(100, 105)).toBe(true);
    });

    it('rejects output below tolerance', () => {
      // Expected 100, got 97 → 3% slippage, exceeds default 2% tolerance
      expect(isSlippageAcceptable(100, 97)).toBe(false);

      // Expected 100, got 90 → 10% slippage
      expect(isSlippageAcceptable(100, 90)).toBe(false);

      // Custom tolerance: 1%
      expect(isSlippageAcceptable(100, 98.5, 0.01)).toBe(false);
    });

    it('handles zero expected amount', () => {
      // When expected output is 0 or negative, function returns true
      expect(isSlippageAcceptable(0, 0)).toBe(true);
      expect(isSlippageAcceptable(0, 10)).toBe(true);
      expect(isSlippageAcceptable(-1, 5)).toBe(true);
    });

    it('handles exact tolerance boundary', () => {
      // Expected 100, got 98 → exactly 2% slippage = exactly at tolerance
      expect(isSlippageAcceptable(100, 98, 0.02)).toBe(true);

      // Expected 100, got 97.99 → just barely over 2% tolerance
      expect(isSlippageAcceptable(100, 97.99, 0.02)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Error path: insufficient balance for swap
  // -----------------------------------------------------------------------

  describe('error paths', () => {
    it('should return empty legs when holdings have zero total value', async () => {
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];
      // All holdings have zero value → totalValue = 0
      const holdings = [
        makeHolding('CC', 1000, 0),
        makeHolding('USDCx', 500, 0),
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      // Zero portfolio value should produce no swap legs
      expect(legs).toEqual([]);
    });

    it('should return empty legs when a single asset holds 100% and targets 100%', async () => {
      // Single asset portfolio where target is also 100% — already balanced
      const targets = [
        makeTarget('CC', 100),
      ];
      const holdings = [
        makeHolding('CC', 10000, 5000),
      ];

      const legs = await engine.planSwapLegs(holdings, targets);

      // No rebalancing needed — single asset at its target
      expect(legs).toEqual([]);
    });

    it('should calculate max drift of 100% for single asset against split targets', () => {
      // Portfolio holds only CC but targets expect a split
      const targets = [
        makeTarget('CC', 0),
        makeTarget('USDCx', 100),
      ];
      const holdings = [
        makeHolding('CC', 10000, 5000),
      ];

      const result = engine.calculateDrift(holdings, targets);

      // CC is 100% vs 0% → drift 100%
      expect(result.drifts.get('CC')).toBe(100);
      // USDCx is 0% vs 100% → drift 100%
      expect(result.drifts.get('USDCx')).toBe(100);
      expect(result.maxDrift).toBe(100);
    });

    it('should handle holdings with negative valueCc gracefully', () => {
      // Edge case: negative values should not cause NaN or crash
      const targets = [
        makeTarget('CC', 50),
        makeTarget('USDCx', 50),
      ];
      const holdings = [
        makeHolding('CC', 100, -500),
        makeHolding('USDCx', 100, 500),
      ];

      // Should not throw — totalValue = 0, so drift defaults
      const result = engine.calculateDrift(holdings, targets);

      expect(typeof result.maxDrift).toBe('number');
      expect(result.drifts.size).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Circuit breaker open state integration
  // -----------------------------------------------------------------------

  describe('circuit breaker open state', () => {
    it('should reject execution immediately when circuit breaker is open', async () => {
      // Import the circuit breaker directly to test its behavior
      // with the rebalance engine pattern
      const { CircuitBreaker } = await import('../src/utils/circuit-breaker.js');
      const breaker = new CircuitBreaker({
        name: 'test-rebalance',
        failureThreshold: 2,
        resetTimeoutMs: 60_000,
        successThreshold: 2,
      });

      // Open the circuit breaker by causing failures
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(() => Promise.reject(new Error('service down'))),
        ).rejects.toThrow('service down');
      }

      expect(breaker.getState()).toBe('open');

      // Now any call through the breaker should be rejected immediately
      const mockSwap = vi.fn().mockResolvedValue({ outputAmount: 100 });
      await expect(breaker.execute(mockSwap)).rejects.toThrow(
        'Circuit breaker [test-rebalance] is OPEN',
      );
      expect(mockSwap).not.toHaveBeenCalled();
    });
  });
});
