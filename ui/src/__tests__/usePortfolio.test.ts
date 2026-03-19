import { describe, it, expect } from 'vitest';

// Test the pure drift calculation logic that mirrors Daml's calcMaxDrift
describe('Drift Calculation', () => {
  function calcMaxDrift(
    targets: { asset?: { symbol: string }; targetPct: number }[],
    holdings: { asset: { symbol: string }; valueCc: number }[],
  ): number {
    const totalValue = holdings.reduce((sum, h) => sum + h.valueCc, 0);
    if (totalValue === 0) return 0;

    let maxDrift = 0;
    for (const target of targets) {
      const holding = holdings.find(h => h.asset.symbol === target.asset?.symbol);
      const currentPct = holding ? (holding.valueCc / totalValue) * 100 : 0;
      const drift = Math.abs(currentPct - target.targetPct);
      maxDrift = Math.max(maxDrift, drift);
    }
    return maxDrift;
  }

  it('returns 0 for empty holdings', () => {
    expect(calcMaxDrift([{ asset: { symbol: 'CC' }, targetPct: 50 }, { asset: { symbol: 'CBTC' }, targetPct: 50 }], [])).toBe(0);
  });

  it('returns 0 for perfectly balanced portfolio', () => {
    const targets = [{ asset: { symbol: 'CC' }, targetPct: 50 }, { asset: { symbol: 'CBTC' }, targetPct: 50 }];
    const holdings = [
      { asset: { symbol: 'CC' }, valueCc: 500 },
      { asset: { symbol: 'CBTC' }, valueCc: 500 },
    ];
    expect(calcMaxDrift(targets, holdings)).toBe(0);
  });

  it('calculates drift correctly for imbalanced portfolio', () => {
    const targets = [{ asset: { symbol: 'CC' }, targetPct: 50 }, { asset: { symbol: 'CBTC' }, targetPct: 50 }];
    const holdings = [
      { asset: { symbol: 'CC' }, valueCc: 700 },
      { asset: { symbol: 'CBTC' }, valueCc: 300 },
    ];
    // CC: 70% vs 50% target = 20% drift; CBTC: 30% vs 50% target = 20% drift
    expect(calcMaxDrift(targets, holdings)).toBe(20);
  });
});
