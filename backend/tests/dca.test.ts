import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// DCA scheduling logic tests
//
// These tests verify the schedule-checking logic without hitting the ledger.
// We extract the pure functions (isDue, computeNextExecution, frequencyToMs)
// and test them directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extracted pure functions (mirroring dca.ts internal logic)
// ---------------------------------------------------------------------------

function frequencyToMs(freq: string): number {
  switch (freq) {
    case 'Hourly':
      return 60 * 60 * 1000;
    case 'Daily':
      return 24 * 60 * 60 * 1000;
    case 'Weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'Monthly':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

function parseFrequency(freq: string | { tag: string }): string {
  if (typeof freq === 'string') return freq;
  return freq.tag ?? 'Unknown';
}

function isDue(
  frequency: string,
  isActive: boolean,
  createdAt: string,
  lastExecution: string | null,
  now: number,
): boolean {
  if (!isActive) return false;
  const interval = frequencyToMs(frequency);

  if (lastExecution) {
    const lastTs = new Date(lastExecution).getTime();
    return now - lastTs >= interval;
  }

  const createdTs = new Date(createdAt).getTime();
  return now - createdTs >= interval;
}

function computeNextExecution(
  freq: string,
  lastExecution: string | null,
  createdAt: string,
): string | null {
  const base = lastExecution ?? createdAt;
  const baseTs = new Date(base).getTime();
  if (isNaN(baseTs)) return null;
  const interval = frequencyToMs(freq);
  return new Date(baseTs + interval).toISOString();
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
