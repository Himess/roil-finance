import { cantex } from '../cantex.js';
import { INSTRUMENTS, FALLBACK_PRICES } from '../config.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceData {
  asset: string;
  priceUsdcx: number;    // price in USDCx (=USD)
  change24h: number;      // 24h change percentage
  volume24h: number;
  source: 'cantex' | 'cached' | 'fallback';
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
}

interface CacheEntry {
  data: PriceData;
  expiresAt: number;
}

interface HistoryPoint {
  price: number;
  timestamp: string;
}

const SUPPORTED_ASSETS = Object.keys(INSTRUMENTS);

// ---------------------------------------------------------------------------
// PriceOracle
// ---------------------------------------------------------------------------

/**
 * Enhanced price oracle with caching, fallback, confidence scoring,
 * and in-memory price history for charting.
 *
 * Architecture:
 * 1. Hot path: return cached value if within TTL
 * 2. Warm path: fetch from Cantex, update cache + history
 * 3. Cold path: return last known price (marked 'cached', confidence 'medium')
 * 4. Fallback: return hardcoded price (marked 'fallback', confidence 'low')
 */
export class PriceOracle {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL: number;
  // Price history is intentionally in-memory for performance.
  // Data survives as long as the process runs; lost on restart.
  // For production, consider TimescaleDB or InfluxDB integration.
  // Uses a circular buffer per asset for O(1) insertion without splice/shift.
  private historyBuffers = new Map<string, { data: HistoryPoint[]; writeIdx: number; size: number }>();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  /** Maximum history points to retain per asset (48h at 30s intervals = 5760) */
  private readonly MAX_HISTORY_POINTS = 5760;

  constructor(cacheTtlMs: number = 30_000) {
    this.CACHE_TTL = cacheTtlMs;
  }

  // -----------------------------------------------------------------------
  // Single asset price
  // -----------------------------------------------------------------------

  /**
   * Get current price for an asset with caching and fallback chain.
   */
  async getPrice(asset: string): Promise<PriceData> {
    // 1. Check cache (hot path)
    const cached = this.cache.get(asset);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    // 2. Try Cantex
    try {
      const prices = await cantex.getPrices();
      const priceUsdcx = prices[asset];

      if (priceUsdcx !== undefined) {
        const change24h = this.compute24hChange(asset, priceUsdcx);
        const volume24h = await this.estimateVolume(asset);

        const data: PriceData = {
          asset,
          priceUsdcx,
          change24h,
          volume24h,
          source: 'cantex',
          timestamp: new Date().toISOString(),
          confidence: 'high',
        };

        this.updateCache(asset, data);
        this.recordHistory(asset, priceUsdcx);

        return data;
      }
    } catch {
      // Cantex unavailable — fall through to fallback chain
    }

    // 3. Fallback to last known price from cache (even if expired)
    if (cached) {
      const staleData: PriceData = {
        ...cached.data,
        source: 'cached',
        confidence: 'medium',
        timestamp: new Date().toISOString(),
      };
      return staleData;
    }

    // 4. Ultimate fallback to hardcoded prices
    const fallbackPrice = FALLBACK_PRICES[asset] ?? 1.0;
    const data: PriceData = {
      asset,
      priceUsdcx: fallbackPrice,
      change24h: 0,
      volume24h: 0,
      source: 'fallback',
      timestamp: new Date().toISOString(),
      confidence: 'low',
    };

    return data;
  }

  // -----------------------------------------------------------------------
  // All prices
  // -----------------------------------------------------------------------

  /**
   * Get prices for all supported assets at once.
   */
  async getAllPrices(): Promise<Record<string, PriceData>> {
    const result: Record<string, PriceData> = {};

    // Try batch fetch from Cantex first
    try {
      const prices = await cantex.getPrices();

      for (const asset of SUPPORTED_ASSETS) {
        const priceUsdcx = prices[asset];
        if (priceUsdcx !== undefined) {
          const change24h = this.compute24hChange(asset, priceUsdcx);
          const volume24h = await this.estimateVolume(asset);

          const data: PriceData = {
            asset,
            priceUsdcx,
            change24h,
            volume24h,
            source: 'cantex',
            timestamp: new Date().toISOString(),
            confidence: 'high',
          };

          this.updateCache(asset, data);
          this.recordHistory(asset, priceUsdcx);
          result[asset] = data;
        }
      }

      // If we got all assets, return immediately
      if (Object.keys(result).length === SUPPORTED_ASSETS.length) {
        return result;
      }
    } catch {
      // Cantex unavailable — fall through
    }

    // Fill in any missing assets from cache/fallback
    for (const asset of SUPPORTED_ASSETS) {
      if (!result[asset]) {
        result[asset] = await this.getPrice(asset);
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Price history (for charts)
  // -----------------------------------------------------------------------

  /**
   * Get historical price data for an asset.
   *
   * Returns price points collected during polling, filtered to the
   * requested time window. In production this would query a time-series DB.
   */
  async getPriceHistory(asset: string, hours: number): Promise<HistoryPoint[]> {
    const history = this.readHistory(asset);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    return history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
  }

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  /**
   * Start background price polling.
   *
   * Fetches prices from Cantex at the given interval and updates the
   * cache and history. This ensures the cache stays warm and history
   * is populated for chart endpoints.
   */
  startPolling(intervalMs: number = 30_000): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    logger.info(`[price-oracle] Starting price polling (interval=${intervalMs}ms)`);

    // Initial fetch — catch unhandled rejections to prevent process crash
    this.pollOnce().catch((err) => {
      logger.error(`[price-oracle] Initial polling failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.pollingInterval = setInterval(() => {
      this.pollOnce().catch((err) => {
        logger.error(`[price-oracle] Polling cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
  }

  /**
   * Stop background price polling.
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info('[price-oracle] Stopped price polling');
    }
  }

  // -----------------------------------------------------------------------
  // Conversion
  // -----------------------------------------------------------------------

  /**
   * Convert an amount from one asset to another using cached prices.
   */
  async convert(fromAsset: string, toAsset: string, amount: number): Promise<number> {
    if (fromAsset === toAsset) return amount;

    const fromPrice = await this.getPrice(fromAsset);
    const toPrice = await this.getPrice(toAsset);

    if (toPrice.priceUsdcx === 0) {
      throw new Error(`Cannot convert: ${toAsset} price is zero`);
    }

    // Convert: amount * (fromPrice / toPrice)
    return (amount * fromPrice.priceUsdcx) / toPrice.priceUsdcx;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private updateCache(asset: string, data: PriceData): void {
    this.cache.set(asset, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL,
    });
  }

  private recordHistory(asset: string, price: number): void {
    let buf = this.historyBuffers.get(asset);
    if (!buf) {
      buf = { data: new Array<HistoryPoint>(this.MAX_HISTORY_POINTS), writeIdx: 0, size: 0 };
      this.historyBuffers.set(asset, buf);
    }

    buf.data[buf.writeIdx] = { price, timestamp: new Date().toISOString() };
    buf.writeIdx = (buf.writeIdx + 1) % this.MAX_HISTORY_POINTS;
    if (buf.size < this.MAX_HISTORY_POINTS) buf.size++;
  }

  /**
   * Read the circular buffer in chronological order (oldest first).
   */
  private readHistory(asset: string): HistoryPoint[] {
    const buf = this.historyBuffers.get(asset);
    if (!buf || buf.size === 0) return [];

    const result: HistoryPoint[] = [];
    // If buffer is not full, entries start at index 0
    const startIdx = buf.size < this.MAX_HISTORY_POINTS ? 0 : buf.writeIdx;
    for (let i = 0; i < buf.size; i++) {
      result.push(buf.data[(startIdx + i) % this.MAX_HISTORY_POINTS]);
    }
    return result;
  }

  /**
   * Compute the 24h price change percentage from history.
   */
  private compute24hChange(asset: string, currentPrice: number): number {
    const history = this.readHistory(asset);
    if (history.length === 0) return 0;

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

    // Find the oldest point within 24h
    const oldPoint = history.find((p) => new Date(p.timestamp).getTime() >= cutoff24h);

    if (!oldPoint || oldPoint.price === 0) return 0;

    return ((currentPrice - oldPoint.price) / oldPoint.price) * 100;
  }

  /**
   * Estimate 24h trading volume for an asset.
   *
   * Uses Cantex pool info when available. In a production system this would
   * be sourced from a dedicated analytics API.
   */
  private async estimateVolume(asset: string): Promise<number> {
    try {
      const pools = await cantex.getPoolInfo();
      let totalVolume = 0;

      for (const pool of pools) {
        if (pool.pair.includes(asset)) {
          // Use reported volume, or estimate ~5% of pool liquidity if unavailable
          const volume = pool.volume24h || pool.liquidity * 0.05;
          totalVolume += volume;
        }
      }

      return totalVolume;
    } catch {
      return 0;
    }
  }

  /**
   * Execute a single polling cycle — fetch all prices and update cache/history.
   */
  private async pollOnce(): Promise<void> {
    try {
      const prices = await cantex.getPrices();

      for (const asset of SUPPORTED_ASSETS) {
        const priceUsdcx = prices[asset];
        if (priceUsdcx !== undefined) {
          const change24h = this.compute24hChange(asset, priceUsdcx);
          const volume24h = await this.estimateVolume(asset);

          const data: PriceData = {
            asset,
            priceUsdcx,
            change24h,
            volume24h,
            source: 'cantex',
            timestamp: new Date().toISOString(),
            confidence: 'high',
          };

          this.updateCache(asset, data);
          this.recordHistory(asset, priceUsdcx);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[price-oracle] Polling error: ${message}`);
    }
  }
}

/** Singleton instance */
export const priceOracle = new PriceOracle();
