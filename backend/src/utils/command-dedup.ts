// ---------------------------------------------------------------------------
// Command deduplication cache
//
// Canton's JSON Ledger API v2 deduplicates by `commandId` within the
// participant's dedup window (default 10 minutes). Native dedup only helps
// when the same `commandId` is re-submitted — so application-level retries
// have to reuse the ID deliberately.
//
// This cache maps a logical operation key (e.g. `"exercise:Portfolio:...:user"`)
// to the `commandId` generated on first use. A retry keyed on the same
// logical operation returns the same `commandId`, so Canton natural-dedup
// covers the gap even if a prior call crashed mid-submit.
//
// The cache is bounded (LRU eviction when size exceeds the cap) and entries
// expire after `ttlMs`, which should match or be shorter than Canton's dedup
// window.
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

interface Entry {
  commandId: string;
  expiresAt: number;
}

export interface CommandDedupCacheOptions {
  /** Entry lifetime in ms. Default: 10 minutes (Canton's default dedup window). */
  ttlMs?: number;
  /** Max entries retained. Oldest entry is evicted when full. Default: 10_000. */
  maxSize?: number;
}

export class CommandDedupCache {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(opts: CommandDedupCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
    this.maxSize = opts.maxSize ?? 10_000;
  }

  /**
   * Return a stable commandId for the given logical-op key.
   * First call: generates and stores a fresh UUID-based id.
   * Subsequent calls within the TTL: returns the same id so Canton dedups.
   */
  idFor(key: string): string {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      // Refresh LRU position.
      this.store.delete(key);
      this.store.set(key, existing);
      return existing.commandId;
    }

    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }

    const commandId = `cmd-${now}-${crypto.randomUUID()}`;
    this.store.set(key, { commandId, expiresAt: now + this.ttlMs });
    return commandId;
  }

  /** Forget a key (e.g. after confirming the command was accepted). */
  forget(key: string): void {
    this.store.delete(key);
  }

  /** Opportunistically drop expired entries. Not required for correctness. */
  sweep(now: number = Date.now()): void {
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  /** Current entry count (for tests / metrics). */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Build a canonical key for an exercise operation so the same logical call
 * from two retry attempts collapses into one cache entry.
 */
export function exerciseKey(
  templateId: string,
  contractId: string,
  choice: string,
  actAs: string[],
  choiceArgument: Record<string, unknown>,
): string {
  const argHash = crypto
    .createHash('sha256')
    .update(stableStringify(choiceArgument))
    .digest('hex')
    .slice(0, 16);
  const parties = [...actAs].sort().join(',');
  return `ex:${templateId}:${contractId}:${choice}:${parties}:${argHash}`;
}

/**
 * Build a canonical key for a create operation.
 */
export function createKey(
  templateId: string,
  actAs: string[],
  createArguments: Record<string, unknown>,
): string {
  const argHash = crypto
    .createHash('sha256')
    .update(stableStringify(createArguments))
    .digest('hex')
    .slice(0, 16);
  const parties = [...actAs].sort().join(',');
  return `cr:${templateId}:${parties}:${argHash}`;
}

/** Process-level singleton — most callers should use this. */
export const globalCommandDedupCache = new CommandDedupCache();

// Stable JSON stringify — sorts object keys recursively so that two equivalent
// payloads hash identically regardless of insertion order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
