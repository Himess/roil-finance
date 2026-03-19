import { describe, it, expect } from 'vitest';
import { ASSET_COLORS, TIER_THRESHOLDS, FEE_REBATE_PCT, AVAILABLE_ASSETS, PORTFOLIO_TEMPLATES } from '@/config';

describe('Config', () => {
  it('has colors for all standard assets', () => {
    expect(ASSET_COLORS.CC).toBeDefined();
    expect(ASSET_COLORS.USDCx).toBeDefined();
    expect(ASSET_COLORS.CBTC).toBeDefined();
  });

  it('tier thresholds are in ascending order', () => {
    expect(TIER_THRESHOLDS.Bronze.max).toBeLessThan(TIER_THRESHOLDS.Silver.max);
    expect(TIER_THRESHOLDS.Silver.max).toBeLessThan(TIER_THRESHOLDS.Gold.max);
    expect(TIER_THRESHOLDS.Gold.max).toBeLessThan(TIER_THRESHOLDS.Platinum.max);
  });

  it('fee rebates increase with tier', () => {
    expect(FEE_REBATE_PCT.Bronze).toBeLessThan(FEE_REBATE_PCT.Silver);
    expect(FEE_REBATE_PCT.Silver).toBeLessThan(FEE_REBATE_PCT.Gold);
    expect(FEE_REBATE_PCT.Gold).toBeLessThan(FEE_REBATE_PCT.Platinum);
  });

  it('has at least 3 available assets', () => {
    expect(AVAILABLE_ASSETS.length).toBeGreaterThanOrEqual(3);
    expect(AVAILABLE_ASSETS.find(a => a.symbol === 'CC')).toBeDefined();
    expect(AVAILABLE_ASSETS.find(a => a.symbol === 'USDCx')).toBeDefined();
    expect(AVAILABLE_ASSETS.find(a => a.symbol === 'CBTC')).toBeDefined();
  });

  it('has at least 5 portfolio templates', () => {
    expect(PORTFOLIO_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const t of PORTFOLIO_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.targets.length).toBeGreaterThanOrEqual(2);
      expect(t.riskLevel).toMatch(/^(low|medium|high)$/);
      // Target percentages should sum to ~100
      const sum = t.targets.reduce((s, tgt) => s + tgt.targetPct, 0);
      expect(sum).toBeGreaterThanOrEqual(99.9);
      expect(sum).toBeLessThanOrEqual(100.1);
    }
  });
});
