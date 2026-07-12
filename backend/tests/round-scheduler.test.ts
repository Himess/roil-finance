import { describe, it, expect } from 'vitest';
import {
  CATCHUP_WINDOW_SLOTS,
  currentRoundSlot,
  isInSlot,
  slotForContractId,
  slotsSince,
} from '../src/engine/round-scheduler.js';

describe('round-scheduler', () => {
  describe('currentRoundSlot', () => {
    it('returns 0 at exactly 00:00 UTC', () => {
      const midnightUTC = Date.UTC(2026, 0, 1, 0, 0, 0);
      expect(currentRoundSlot(midnightUTC)).toBe(0);
    });

    it('returns 1 after the first 10-minute slot', () => {
      const t = Date.UTC(2026, 0, 1, 0, 10, 0);
      expect(currentRoundSlot(t)).toBe(1);
    });

    it('returns 143 in the last slot of the day', () => {
      const t = Date.UTC(2026, 0, 1, 23, 59, 0);
      expect(currentRoundSlot(t)).toBe(143);
    });

    it('wraps back to 0 at midnight the next day', () => {
      const t = Date.UTC(2026, 0, 2, 0, 0, 0);
      expect(currentRoundSlot(t)).toBe(0);
    });

    it('produces values strictly in [0, 144) for any moment in a day', () => {
      const base = Date.UTC(2026, 0, 1, 0, 0, 0);
      for (let m = 0; m < 1440; m++) {
        const slot = currentRoundSlot(base + m * 60_000);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(144);
      }
    });
  });

  describe('slotForContractId', () => {
    it('returns the same slot for the same contract ID', () => {
      const cid = '001d3bfeb52a3ff7337f2698deb95bf2a3d76f756105520886590c6523119eea';
      expect(slotForContractId(cid)).toBe(slotForContractId(cid));
    });

    it('returns a value in [0, 144)', () => {
      const ids = [
        '00abc', '00def', '11122', 'cid_with_under_score', '🦄',
        ''.padStart(64, 'a'), ''.padStart(64, 'f'),
      ];
      for (const id of ids) {
        const s = slotForContractId(id);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(144);
      }
    });

    it('spreads 10_000 random IDs roughly uniformly across 144 slots', () => {
      const counts = new Array(144).fill(0);
      for (let i = 0; i < 10_000; i++) {
        const id = `cid-${i.toString(36)}-${(i * 31).toString(36)}`;
        counts[slotForContractId(id)]++;
      }
      // Expected mean per slot: ~69.4. With this many samples no slot
      // should be empty and none should be wildly off the mean.
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      expect(min).toBeGreaterThan(20);   // worst-case ~3x below mean
      expect(max).toBeLessThan(140);     // worst-case ~2x above mean
    });
  });

  describe('isInSlot', () => {
    it('returns true when the contract slot matches', () => {
      const cid = 'cid-x';
      const target = slotForContractId(cid);
      expect(isInSlot(cid, target)).toBe(true);
    });

    it('returns false otherwise', () => {
      const cid = 'cid-x';
      const target = slotForContractId(cid);
      expect(isInSlot(cid, (target + 1) % 144)).toBe(false);
    });
  });

  describe('slotsSince', () => {
    it('returns 0 when ts equals now', () => {
      const now = Date.now();
      expect(slotsSince(now, now)).toBe(0);
    });

    it('returns 1 after 10 minutes', () => {
      const now = Date.now();
      expect(slotsSince(now - 10 * 60_000, now)).toBe(1);
    });

    it('returns 144 after a full day', () => {
      const now = Date.now();
      expect(slotsSince(now - 144 * 10 * 60_000, now)).toBe(144);
    });
  });

  it('catch-up window is short enough to avoid skipping a day for daily DCAs', () => {
    // Daily DCA cadence = 144 slots. Catch-up must be << 144 so a missed
    // slot doesn't snowball into postponing into the next day.
    expect(CATCHUP_WINDOW_SLOTS).toBeLessThan(144 / 4);
  });
});
