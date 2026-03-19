import { describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { vi } from 'vitest';
import { recordSnapshot, getPerformance, getPerformanceSummary } from '../src/services/performance-tracker.js';

describe('Performance Tracker', () => {
  const party = 'test-party::1220abc';

  it('records and retrieves snapshots', () => {
    recordSnapshot(party, 10000, [{ asset: 'CC', amount: 5000, valueCc: 5000 }]);
    const history = getPerformance(party);
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].totalValueCc).toBe(10000);
  });

  it('returns empty for unknown party', () => {
    const history = getPerformance('unknown-party');
    expect(history).toEqual([]);
  });

  it('computes performance summary', () => {
    recordSnapshot(party, 10000, []);
    const summary = getPerformanceSummary(party);
    expect(summary.current).toBe(10000);
    expect(typeof summary.change24h).toBe('number');
    expect(typeof summary.high30d).toBe('number');
    expect(typeof summary.low30d).toBe('number');
  });

  it('filters by time window', () => {
    const history = getPerformance(party, '24h');
    // All snapshots from this test run are within 24h
    expect(history.length).toBeGreaterThan(0);
  });
});
