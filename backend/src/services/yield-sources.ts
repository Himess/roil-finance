import { logger } from '../monitoring/logger.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YieldQuote {
  apy: number;         // APY as decimal (e.g., 0.05 = 5%)
  source: string;      // Human-readable source name
  confidence: 'live' | 'cached' | 'fallback';
  updatedAt: string;   // ISO timestamp of when this quote was fetched
}

export interface YieldSourceProvider {
  readonly name: string;
  getYield(asset: string): Promise<YieldQuote | null>;
}

// ---------------------------------------------------------------------------
// Cache infrastructure
// ---------------------------------------------------------------------------

interface CacheEntry {
  quote: YieldQuote;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Fallback rates — used when all live sources fail
// ---------------------------------------------------------------------------

const FALLBACK_RATES: Record<string, { apy: number; source: string }> = {
  CC:    { apy: 0.05,  source: 'Canton Staking (fallback)' },
  USDCx: { apy: 0.03,  source: 'Alpend Lending (fallback)' },
  CBTC:  { apy: 0.04,  source: 'Alpend Lending (fallback)' },
  ETHx:  { apy: 0.035, source: 'Alpend Lending (fallback)' },
  SOLx:  { apy: 0.06,  source: 'Cantex LP (fallback)' },
  XAUt:  { apy: 0.015, source: 'Cantex LP (fallback)' },
  XAGt:  { apy: 0.012, source: 'Cantex LP (fallback)' },
  USTb:  { apy: 0.045, source: 'Treasury Yield (fallback)' },
  MMF:   { apy: 0.048, source: 'Money Market (fallback)' },
};

// ---------------------------------------------------------------------------
// AlpendYieldSource — lending protocol on Canton Network
// ---------------------------------------------------------------------------

export class AlpendYieldSource implements YieldSourceProvider {
  readonly name = 'Alpend';
  private readonly baseUrl: string;
  private cache = new Map<string, CacheEntry>();

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? (process.env.ALPEND_API_URL || `${config.cantexApiUrl}/alpend`);
  }

  async getYield(asset: string): Promise<YieldQuote | null> {
    // Check cache first
    const cached = this.cache.get(asset);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.quote, confidence: 'cached' };
    }

    try {
      const res = await fetch(`${this.baseUrl}/v1/markets/${asset}/yield`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        supplyApy?: number;
        borrowApy?: number;
        totalSupply?: number;
      };

      if (data.supplyApy == null) return null;

      const quote: YieldQuote = {
        apy: data.supplyApy,
        source: `Alpend Lending (supply APY, TVL: ${data.totalSupply?.toFixed(0) ?? 'unknown'})`,
        confidence: 'live',
        updatedAt: new Date().toISOString(),
      };

      this.cache.set(asset, { quote, fetchedAt: Date.now() });
      return quote;
    } catch (err) {
      logger.debug(`[yield-sources] Alpend query failed for ${asset}: ${String(err)}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// CantexLPYieldSource — liquidity pool fees on Cantex DEX
// ---------------------------------------------------------------------------

export class CantexLPYieldSource implements YieldSourceProvider {
  readonly name = 'Cantex LP';
  private readonly baseUrl: string;
  private cache = new Map<string, CacheEntry>();

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.cantexApiUrl;
  }

  async getYield(asset: string): Promise<YieldQuote | null> {
    // Check cache first
    const cached = this.cache.get(asset);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.quote, confidence: 'cached' };
    }

    try {
      const res = await fetch(`${this.baseUrl}/v1/pools/${asset}-USDCx/stats`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        feeApy?: number;
        volume24h?: number;
        tvl?: number;
      };

      if (data.feeApy == null) return null;

      const quote: YieldQuote = {
        apy: data.feeApy,
        source: `Cantex LP (${asset}-USDCx pool, vol24h: ${data.volume24h?.toFixed(0) ?? 'unknown'})`,
        confidence: 'live',
        updatedAt: new Date().toISOString(),
      };

      this.cache.set(asset, { quote, fetchedAt: Date.now() });
      return quote;
    } catch (err) {
      logger.debug(`[yield-sources] Cantex LP query failed for ${asset}: ${String(err)}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// StakingYieldSource — native staking rewards (CC staking)
// ---------------------------------------------------------------------------

export class StakingYieldSource implements YieldSourceProvider {
  readonly name = 'Canton Staking';
  private readonly scanUrl: string;
  private cache = new Map<string, CacheEntry>();

  constructor(scanUrl?: string) {
    this.scanUrl = scanUrl ?? config.scanUrl;
  }

  async getYield(asset: string): Promise<YieldQuote | null> {
    // Only CC has native staking on Canton
    if (asset !== 'CC') return null;

    // Check cache first
    const cached = this.cache.get(asset);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.quote, confidence: 'cached' };
    }

    try {
      const res = await fetch(`${this.scanUrl}/api/scan/v2/network/stats`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        stakingRewardRate?: number;
        totalStaked?: number;
        validatorCount?: number;
      };

      if (data.stakingRewardRate == null) return null;

      const quote: YieldQuote = {
        apy: data.stakingRewardRate,
        source: `Canton Staking (validators: ${data.validatorCount ?? 'unknown'}, staked: ${data.totalStaked?.toFixed(0) ?? 'unknown'} CC)`,
        confidence: 'live',
        updatedAt: new Date().toISOString(),
      };

      this.cache.set(asset, { quote, fetchedAt: Date.now() });
      return quote;
    } catch (err) {
      logger.debug(`[yield-sources] Staking query failed for ${asset}: ${String(err)}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// YieldAggregator — queries all sources and returns best yield per asset
// ---------------------------------------------------------------------------

export class YieldAggregator {
  private sources: YieldSourceProvider[];
  private aggregateCache = new Map<string, CacheEntry>();

  constructor(sources?: YieldSourceProvider[]) {
    this.sources = sources ?? [
      new AlpendYieldSource(),
      new CantexLPYieldSource(),
      new StakingYieldSource(),
    ];
  }

  /**
   * Get the best available yield for an asset across all sources.
   * Falls back to hardcoded rates if all sources fail.
   */
  async getBestYield(asset: string): Promise<YieldQuote> {
    // Check aggregate cache first
    const cached = this.aggregateCache.get(asset);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.quote, confidence: 'cached' };
    }

    const quotes: YieldQuote[] = [];

    // Query all sources in parallel
    const results = await Promise.allSettled(
      this.sources.map(s => s.getYield(asset)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        quotes.push(result.value);
      }
    }

    if (quotes.length > 0) {
      // Return the highest APY from live sources
      const best = quotes.reduce((a, b) => a.apy > b.apy ? a : b);

      this.aggregateCache.set(asset, { quote: best, fetchedAt: Date.now() });
      logger.debug(`[yield-sources] Best yield for ${asset}: ${(best.apy * 100).toFixed(2)}% from ${best.source}`);
      return best;
    }

    // All sources failed — use fallback rates
    const fallback = FALLBACK_RATES[asset];
    if (fallback) {
      const quote: YieldQuote = {
        apy: fallback.apy,
        source: fallback.source,
        confidence: 'fallback',
        updatedAt: new Date().toISOString(),
      };
      // Cache fallback too (shorter TTL would be better but keeps code simple)
      this.aggregateCache.set(asset, { quote, fetchedAt: Date.now() });
      return quote;
    }

    // Unknown asset — return zero yield
    return {
      apy: 0,
      source: 'none',
      confidence: 'fallback',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get all available yields across all sources for an asset.
   * Useful for displaying yield breakdown to users.
   */
  async getAllYields(asset: string): Promise<YieldQuote[]> {
    const quotes: YieldQuote[] = [];

    const results = await Promise.allSettled(
      this.sources.map(s => s.getYield(asset)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        quotes.push(result.value);
      }
    }

    if (quotes.length === 0) {
      const fallback = FALLBACK_RATES[asset];
      if (fallback) {
        quotes.push({
          apy: fallback.apy,
          source: fallback.source,
          confidence: 'fallback',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return quotes;
  }

  /**
   * Invalidate all cached yields (forces re-fetch on next query).
   */
  invalidateCache(): void {
    this.aggregateCache.clear();
    for (const source of this.sources) {
      if ('cache' in source && source.cache instanceof Map) {
        (source.cache as Map<string, unknown>).clear();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const yieldAggregator = new YieldAggregator();
