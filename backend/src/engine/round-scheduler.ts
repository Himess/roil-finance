/**
 * Round-aware scheduler helpers.
 *
 * Canton MainNet currently uses ~10-minute rounds (144 per day). The reward
 * pool (~$18,400 per round) is split across featured apps in proportion to
 * the envelope-traffic they contributed in that round (CIP-0104).
 *
 * If all Roil DCA executions clump into one round we either:
 *   (a) burn the $1.50/tx cap (CIP-0098), or
 *   (b) leave 143 other rounds with zero Roil traffic, missing reward windows.
 *
 * By assigning each schedule a deterministic slot in 0..143 (FNV-1a hash of
 * the contract ID) and only running it when the wall-clock slot matches, we
 * spread executions uniformly across the day. Result: more rounds with
 * non-zero Roil traffic, no cap-binding.
 *
 * The slot is derived from wall-clock (UTC minutes / 10) rather than the
 * actual Canton round number because:
 *   1. Round number is only available via wallet/scan APIs we may not always
 *      reach from the backend.
 *   2. Round duration is stable (10 min) on MainNet; drift between wall-clock
 *      and actual round number is bounded to a few seconds.
 *   3. CIP-0104 rewards are envelope-based — the exact round boundary doesn't
 *      change whether we're in the "right" attribution window.
 */

/**
 * Wall-clock derived round slot 0..143 for the current time.
 *
 * 10-minute slots, slot 0 starts at 00:00 UTC.
 */
export function currentRoundSlot(now: number = Date.now()): number {
  const minutesUTC = Math.floor(now / 60_000);
  return Math.floor(minutesUTC / 10) % 144;
}

/**
 * Deterministic round-slot assignment for a contract ID.
 *
 * Uses FNV-1a 32-bit hash → modulo 144. Same contract ID always maps to the
 * same slot, so a schedule's execution time of day is stable across restarts.
 */
export function slotForContractId(contractId: string): number {
  let h = 2166136261; // FNV offset basis (32-bit)
  for (let i = 0; i < contractId.length; i++) {
    h ^= contractId.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime
  }
  // Math.imul returns a signed 32-bit int; force unsigned then mod.
  return (h >>> 0) % 144;
}

/**
 * Returns true if the given contract's assigned slot matches the current
 * wall-clock slot. The default `nowSlot` reads the wall clock.
 */
export function isInSlot(contractId: string, nowSlot: number = currentRoundSlot()): boolean {
  return slotForContractId(contractId) === nowSlot;
}

/**
 * Catch-up window in slots: if a schedule has been due for longer than this,
 * we run it even when its slot doesn't match, so a missed slot (poll
 * downtime, container restart, etc.) doesn't delay execution by another full
 * day. 4 slots = ~40 minutes grace, well below daily DCA cadence.
 */
export const CATCHUP_WINDOW_SLOTS = 4;

/**
 * Compute how many slots have passed since the given timestamp. Used to
 * decide whether a schedule is "overdue enough" to bypass the slot filter.
 */
export function slotsSince(ts: number, now: number = Date.now()): number {
  return Math.floor((now - ts) / (10 * 60_000));
}
