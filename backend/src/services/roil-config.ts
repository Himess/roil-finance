/**
 * Roil platform config lookup.
 *
 * The Daml `Governance:RoilConfig` template holds mutable, on-ledger caps
 * (e.g. `maxPortfolioCC`) that the backend needs at every choice that
 * touches them — most importantly `Portfolio.SyncHoldings`, which fails if
 * the new holdings exceed the cap.
 *
 * We cache the contract ID rather than the payload because the choice
 * `fetch`-es the contract on-ledger anyway, so a stale payload doesn't
 * matter — a stale ContractId would, but RoilConfig is archived only when
 * the cap is updated, at which point the resulting fetch failure tells us
 * to re-resolve. The cache TTL gives us a free recovery without a restart.
 */

import { config, TEMPLATES } from '../config.js';
import { ledger } from '../ledger.js';
import { logger } from '../monitoring/logger.js';

interface RoilConfigPayload {
  platform: string;
  maxPortfolioCC: string; // Daml Decimal arrives as string
  updatedAt: string;
}

interface CachedConfig {
  contractId: string;
  maxPortfolioCC: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
let cache: CachedConfig | null = null;

/**
 * Get the active RoilConfig contract ID for the platform party.
 *
 * Throws if no RoilConfig exists (the deployment script must create one
 * before the backend is allowed to write to portfolios).
 */
export async function getRoilConfigCid(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.contractId;
  }

  const platform = config.platformParty;
  const all = await ledger.query<RoilConfigPayload>(TEMPLATES.RoilConfig, platform);
  const mine = all.filter((c) => c.payload.platform === platform);
  if (mine.length === 0) {
    throw new Error(
      `No RoilConfig contract for platform ${platform}. ` +
        `Run the deployment script to create one before starting the backend.`,
    );
  }
  // If multiple exist (e.g. governance audit window) prefer the most-recently
  // updated one, then the lexicographically newest contractId as a tiebreaker.
  mine.sort((a, b) => {
    const ta = Date.parse(a.payload.updatedAt);
    const tb = Date.parse(b.payload.updatedAt);
    if (tb !== ta) return tb - ta;
    return b.contractId.localeCompare(a.contractId);
  });
  const active = mine[0]!;

  cache = {
    contractId: active.contractId,
    maxPortfolioCC: Number(active.payload.maxPortfolioCC),
    fetchedAt: now,
  };
  logger.info('[roil-config] Resolved RoilConfig', {
    contractId: cache.contractId,
    maxPortfolioCC: cache.maxPortfolioCC,
  });
  return cache.contractId;
}

/**
 * Get the cached cap value. Returns null if the cache is cold; callers
 * should call `getRoilConfigCid()` first to populate it.
 */
export function getCachedMaxPortfolioCC(): number | null {
  return cache?.maxPortfolioCC ?? null;
}

/**
 * Invalidate the cache. Call after exercising `UpdateMaxPortfolioCC` so
 * subsequent reads hit the new contract instead of the archived one.
 */
export function invalidateRoilConfigCache(): void {
  cache = null;
}
