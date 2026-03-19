import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies so dca.ts module can be imported without side effects
// ---------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  config: {
    platformParty: 'test-platform::1220abc',
    network: 'localnet',
  },
  TEMPLATES: {
    DCASchedule: '#roil-finance:DCA:DCASchedule',
    DCAExecution: '#roil-finance:DCA:DCAExecution',
    DCALog: '#roil-finance:DCA:DCALog',
  },
}));

vi.mock('../src/ledger.js', () => ({
  ledger: {
    query: vi.fn().mockResolvedValue([]),
    createAs: vi.fn().mockResolvedValue('mock-cid'),
    exerciseAs: vi.fn().mockResolvedValue('mock-result'),
  },
}));

vi.mock('../src/cantex.js', () => ({
  cantex: {
    executeSwap: vi.fn().mockResolvedValue({
      txId: 'mock-tx', fromAsset: 'USDCx', toAsset: 'CC',
      inputAmount: 100, outputAmount: 666, fee: 0.3, timestamp: new Date().toISOString(),
    }),
  },
}));

vi.mock('../src/engine/featured-app.js', () => ({
  featuredApp: {
    recordActivity: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  frequencyToMs,
  parseFrequency,
  isDue as isDueSource,
  computeNextExecution,
} from '../src/engine/dca.js';
import type { DCASchedulePayload } from '../src/engine/dca.js';

// ---------------------------------------------------------------------------
// DCA scheduling logic tests
//
// These tests verify the schedule-checking logic without hitting the ledger.
// The pure functions (isDue, computeNextExecution, frequencyToMs, parseFrequency)
// are imported directly from the source module.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test adapter for isDue
//
// The source isDue uses Date.now() internally, so we wrap it with vi.spyOn
// to control the current time. The test signature remains unchanged.
// ---------------------------------------------------------------------------

function isDue(
  frequency: string,
  isActive: boolean,
  createdAt: string,
  lastExecution: string | null,
  now: number,
): boolean {
  if (!isActive) return false;

  // Build a minimal DCASchedulePayload for the source function
  const schedule: DCASchedulePayload = {
    platform: 'test',
    user: 'test-user',
    sourceAsset: { symbol: 'USDCx', admin: 'admin' },
    targetAsset: { symbol: 'CC', admin: 'admin' },
    amountPerBuy: '100',
    frequency,
    totalExecutions: 0,
    isActive,
    createdAt,
  };

  // Temporarily override Date.now to control timing
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return isDueSource(schedule, lastExecution);
  } finally {
    Date.now = originalNow;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DCA Scheduling Logic', () => {
  // -----------------------------------------------------------------------
  // frequencyToMs
  // -----------------------------------------------------------------------

  describe('frequencyToMs', () => {
    it('should return 1 hour in ms for Hourly', () => {
      expect(frequencyToMs('Hourly')).toBe(3_600_000);
    });

    it('should return 24 hours in ms for Daily', () => {
      expect(frequencyToMs('Daily')).toBe(86_400_000);
    });

    it('should return 7 days in ms for Weekly', () => {
      expect(frequencyToMs('Weekly')).toBe(604_800_000);
    });

    it('should return 30 days in ms for Monthly', () => {
      expect(frequencyToMs('Monthly')).toBe(2_592_000_000);
    });

    it('should default to Daily for unknown frequencies', () => {
      expect(frequencyToMs('Biweekly')).toBe(86_400_000);
    });
  });

  // -----------------------------------------------------------------------
  // parseFrequency
  // -----------------------------------------------------------------------

  describe('parseFrequency', () => {
    it('should pass through string frequencies', () => {
      expect(parseFrequency('Hourly')).toBe('Hourly');
      expect(parseFrequency('Daily')).toBe('Daily');
    });

    it('should extract tag from Daml variant encoding', () => {
      expect(parseFrequency({ tag: 'Weekly' })).toBe('Weekly');
      expect(parseFrequency({ tag: 'Monthly' })).toBe('Monthly');
    });
  });

  // -----------------------------------------------------------------------
  // isDue
  // -----------------------------------------------------------------------

  describe('isDue', () => {
    const HOUR = 3_600_000;
    const DAY = 86_400_000;

    it('should return false for inactive schedules', () => {
      const now = Date.now();
      const createdAt = new Date(now - DAY * 2).toISOString();
      expect(isDue('Daily', false, createdAt, null, now)).toBe(false);
    });

    it('should be due if enough time passed since creation (no prior execution)', () => {
      const now = Date.now();
      const createdAt = new Date(now - HOUR * 2).toISOString();
      expect(isDue('Hourly', true, createdAt, null, now)).toBe(true);
    });

    it('should not be due if not enough time passed since creation', () => {
      const now = Date.now();
      const createdAt = new Date(now - HOUR * 0.5).toISOString();
      expect(isDue('Hourly', true, createdAt, null, now)).toBe(false);
    });

    it('should be due if enough time passed since last execution', () => {
      const now = Date.now();
      const createdAt = new Date(now - DAY * 10).toISOString();
      const lastExecution = new Date(now - DAY * 2).toISOString();
      expect(isDue('Daily', true, createdAt, lastExecution, now)).toBe(true);
    });

    it('should not be due if last execution was recent', () => {
      const now = Date.now();
      const createdAt = new Date(now - DAY * 10).toISOString();
      const lastExecution = new Date(now - HOUR * 12).toISOString();
      expect(isDue('Daily', true, createdAt, lastExecution, now)).toBe(false);
    });

    it('should handle Weekly frequency correctly', () => {
      const now = Date.now();
      const WEEK = 7 * DAY;

      // Not enough time
      const lastRecent = new Date(now - DAY * 3).toISOString();
      expect(isDue('Weekly', true, '', lastRecent, now)).toBe(false);

      // Enough time
      const lastOld = new Date(now - WEEK - HOUR).toISOString();
      expect(isDue('Weekly', true, '', lastOld, now)).toBe(true);
    });

    it('should handle Monthly frequency correctly', () => {
      const now = Date.now();
      const MONTH = 30 * DAY;

      // Not enough time
      const lastRecent = new Date(now - DAY * 15).toISOString();
      expect(isDue('Monthly', true, '', lastRecent, now)).toBe(false);

      // Enough time
      const lastOld = new Date(now - MONTH - HOUR).toISOString();
      expect(isDue('Monthly', true, '', lastOld, now)).toBe(true);
    });

    it('should be due at exact interval boundary', () => {
      const now = Date.now();
      const lastExecution = new Date(now - DAY).toISOString();
      expect(isDue('Daily', true, '', lastExecution, now)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // computeNextExecution
  // -----------------------------------------------------------------------

  describe('computeNextExecution', () => {
    it('should compute next execution from last execution timestamp', () => {
      const last = '2026-03-15T10:00:00.000Z';
      const next = computeNextExecution('Hourly', last, '');

      expect(next).toBe('2026-03-15T11:00:00.000Z');
    });

    it('should compute next execution from creation time when no prior execution', () => {
      const created = '2026-03-15T08:00:00.000Z';
      const next = computeNextExecution('Daily', null, created);

      expect(next).toBe('2026-03-16T08:00:00.000Z');
    });

    it('should return null for invalid timestamps', () => {
      const next = computeNextExecution('Daily', null, 'not-a-date');
      expect(next).toBeNull();
    });

    it('should correctly add weekly interval', () => {
      const last = '2026-03-08T12:00:00.000Z';
      const next = computeNextExecution('Weekly', last, '');

      expect(next).toBe('2026-03-15T12:00:00.000Z');
    });

    it('should correctly add monthly interval', () => {
      const last = '2026-02-15T00:00:00.000Z';
      const next = computeNextExecution('Monthly', last, '');

      // 30 days from Feb 15 = Mar 17
      const expected = new Date(new Date(last).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(next).toBe(expected);
    });
  });

  // -----------------------------------------------------------------------
  // Integration-style: schedule lifecycle
  // -----------------------------------------------------------------------

  describe('Schedule lifecycle', () => {
    it('should model a Daily schedule across multiple days', () => {
      const DAY = 86_400_000;
      const created = '2026-03-10T09:00:00.000Z';
      const createdTs = new Date(created).getTime();

      // Day 1: just created — not due yet
      expect(isDue('Daily', true, created, null, createdTs + DAY * 0.5)).toBe(false);

      // Day 1 end: due for first execution
      const firstExecTime = createdTs + DAY;
      expect(isDue('Daily', true, created, null, firstExecTime)).toBe(true);

      // After first execution
      const firstExec = new Date(firstExecTime).toISOString();

      // Day 2: too early
      expect(isDue('Daily', true, created, firstExec, firstExecTime + DAY * 0.5)).toBe(false);

      // Day 2 end: due again
      expect(isDue('Daily', true, created, firstExec, firstExecTime + DAY)).toBe(true);
    });

    it('should compute consecutive next executions correctly', () => {
      const start = '2026-03-10T00:00:00.000Z';
      const HOUR = 3_600_000;

      let next = computeNextExecution('Hourly', null, start)!;
      expect(next).toBe('2026-03-10T01:00:00.000Z');

      next = computeNextExecution('Hourly', next, start)!;
      expect(next).toBe('2026-03-10T02:00:00.000Z');

      next = computeNextExecution('Hourly', next, start)!;
      expect(next).toBe('2026-03-10T03:00:00.000Z');
    });
  });
});
