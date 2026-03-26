import { config } from '../config.js';
import { priceOracle, type PriceData } from '../services/price-oracle.js';
import { logger } from '../monitoring/logger.js';
import {
  decimalToNumber,
  numberToDecimal,
  decimalAdd,
  decimalSub,
  decimalMul,
  decimalDiv,
  decimalGt,
  decimalGte,
  decimalLt,
  DECIMAL_ZERO,
} from '../utils/decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreasuryBalance {
  [asset: string]: string; // Daml Decimal string amounts
}

export interface SwapQuote {
  id: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;       // after spread
  oraclePrice: string;    // raw oracle price (fromAsset per toAsset)
  spread: string;         // "0.005"
  spreadAmount: string;   // fee in toAsset terms
  expiresAt: number;      // quote valid for 30 seconds
}

export interface SwapResult {
  success: boolean;
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  spreadFee: string;
  oraclePrice: string;
  timestamp: string;
  treasuryBalanceAfter: TreasuryBalance;
}

export interface SwapHistoryEntry {
  id: string;
  userId: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  spreadFee: string;
  oraclePrice: string;
  timestamp: string;
}

export interface TreasuryHealth {
  totalValueUsd: string;
  balances: TreasuryBalance;
  exposure: Record<string, string>; // asset -> percentage of total
  isPaused: boolean;
  pauseReason?: string;
}

interface OraclePriceSnapshot {
  price: number;
  timestamp: number;
}

interface DailyVolume {
  date: string;       // YYYY-MM-DD
  totalUsd: string;   // Daml Decimal
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUOTE_TTL_MS = 30_000;                    // 30 seconds
const CIRCUIT_BREAKER_WINDOW_MS = 10 * 60_000;  // 10 minutes
const CIRCUIT_BREAKER_THRESHOLD = '0.05';        // 5% price move

// ---------------------------------------------------------------------------
// TreasurySwapEngine
// ---------------------------------------------------------------------------

/**
 * Treasury-based swap engine.
 *
 * The platform acts as market maker with a configurable treasury.
 * Oracle pricing from PriceOracle + a configurable spread (default 0.5%).
 *
 * Features:
 * - In-memory treasury balances (initialised from config)
 * - Oracle-based pricing via PriceOracle service
 * - Spread calculation on every swap
 * - 30-second swap quotes with expiry
 * - Circuit breaker: pauses swaps if oracle price moves >5% in 10 min
 * - Exposure check: blocks swaps that increase any token beyond 50% of treasury
 * - Daily volume tracking per user
 * - Swap history logging
 * - Auto-rebalance if concentration exceeds threshold
 */
export class TreasurySwapEngine {
  private balances: TreasuryBalance;
  private readonly SPREAD_RATE: string;
  private readonly MAX_EXPOSURE_PCT: number;
  private readonly ORACLE_PAUSE_THRESHOLD: string;

  /** Active quotes waiting to be executed */
  private pendingQuotes = new Map<string, SwapQuote>();

  /** Full swap history */
  private swapHistory: SwapHistoryEntry[] = [];

  /** Per-user daily volume: userId -> { date, totalUsd } */
  private dailyVolumes = new Map<string, DailyVolume>();

  /** Recent oracle price snapshots per asset for circuit breaker */
  private oracleSnapshots = new Map<string, OraclePriceSnapshot[]>();

  /** Circuit breaker state */
  private isPaused = false;
  private pauseReason = '';

  /** Counter for generating unique IDs */
  private idCounter = 0;

  constructor() {
    const tc = (config as any).treasury;
    this.balances = {
      CC: tc?.initialBalances?.CC ?? '3000',
      USDCx: tc?.initialBalances?.USDCx ?? '4000',
      CBTC: tc?.initialBalances?.CBTC ?? '0.08',
      ETHx: tc?.initialBalances?.ETHx ?? '0.7',
    };
    this.SPREAD_RATE = tc?.spreadRate ?? '0.005';
    this.MAX_EXPOSURE_PCT = tc?.maxExposurePct ?? 0.5;
    this.ORACLE_PAUSE_THRESHOLD = tc?.oraclePauseThreshold
      ? numberToDecimal(tc.oraclePauseThreshold)
      : CIRCUIT_BREAKER_THRESHOLD;

    logger.info('[treasury] Initialised treasury swap engine', {
      balances: this.balances,
      spreadRate: this.SPREAD_RATE,
    });
  }

  // -----------------------------------------------------------------------
  // Oracle price
  // -----------------------------------------------------------------------

  /**
   * Get oracle price for a trading pair.
   * Returns the price of 1 unit of `from` denominated in `to`.
   * E.g. getOraclePrice('CBTC', 'USDCx') => "42000.0" means 1 CBTC = 42000 USDCx
   */
  async getOraclePrice(from: string, to: string): Promise<string> {
    const fromPrice = await priceOracle.getPrice(from);
    const toPrice = await priceOracle.getPrice(to);

    if (toPrice.priceUsdcx === 0) {
      throw new Error(`Cannot price ${to}: oracle price is zero`);
    }

    // price = fromPriceUsd / toPriceUsd
    const price = fromPrice.priceUsdcx / toPrice.priceUsdcx;

    // Record snapshot for circuit breaker
    this.recordOracleSnapshot(from, fromPrice.priceUsdcx);
    this.recordOracleSnapshot(to, toPrice.priceUsdcx);

    return numberToDecimal(price);
  }

  // -----------------------------------------------------------------------
  // Swap quote
  // -----------------------------------------------------------------------

  /**
   * Get a swap quote. The quote is valid for 30 seconds.
   *
   * Calculates:
   * - Raw output amount based on oracle price
   * - Spread deduction (0.5% default)
   * - Final toAmount after spread
   */
  async getQuote(fromAsset: string, toAsset: string, fromAmount: string): Promise<SwapQuote> {
    if (this.isPaused) {
      throw new Error(`Treasury swaps paused: ${this.pauseReason}`);
    }

    // Validate assets
    this.validateAsset(fromAsset);
    this.validateAsset(toAsset);

    if (fromAsset === toAsset) {
      throw new Error('Cannot swap an asset for itself');
    }

    // Validate fromAmount is positive
    if (decimalLt(fromAmount, DECIMAL_ZERO) || fromAmount === DECIMAL_ZERO) {
      throw new Error('Swap amount must be positive');
    }

    // Get oracle price
    const oraclePrice = await this.getOraclePrice(fromAsset, toAsset);

    // Check circuit breaker after price fetch
    this.checkCircuitBreaker();
    if (this.isPaused) {
      throw new Error(`Treasury swaps paused: ${this.pauseReason}`);
    }

    // Calculate raw output: fromAmount * oraclePrice
    const rawToAmount = decimalMul(fromAmount, oraclePrice);

    // Calculate spread: spreadAmount = rawToAmount * spreadRate
    const spreadAmount = decimalMul(rawToAmount, this.SPREAD_RATE);

    // Final toAmount = rawToAmount - spreadAmount
    const toAmount = decimalSub(rawToAmount, spreadAmount);

    // Check treasury can fulfil
    if (!this.canFulfill(toAsset, toAmount)) {
      throw new Error(
        `Insufficient treasury balance for ${toAsset}. ` +
        `Requested: ${toAmount}, Available: ${this.balances[toAsset] ?? '0'}`,
      );
    }

    // Check exposure limit — would this swap increase concentration beyond limit?
    await this.checkExposureLimit(fromAsset, fromAmount, toAsset, toAmount);

    const quoteId = this.generateId('quote');
    const quote: SwapQuote = {
      id: quoteId,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      oraclePrice,
      spread: this.SPREAD_RATE,
      spreadAmount,
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };

    this.pendingQuotes.set(quoteId, quote);

    // Auto-expire quote after TTL
    setTimeout(() => {
      this.pendingQuotes.delete(quoteId);
    }, QUOTE_TTL_MS + 1000);

    logger.info('[treasury] Quote generated', {
      id: quoteId,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      oraclePrice,
      spreadAmount,
    });

    return quote;
  }

  // -----------------------------------------------------------------------
  // Execute swap
  // -----------------------------------------------------------------------

  /**
   * Execute a swap against the treasury using a previously obtained quote.
   *
   * Validates:
   * - Quote exists and has not expired
   * - Treasury can still fulfil the order
   * - Updates treasury balances atomically
   * - Logs the swap to history
   */
  async executeSwap(quoteId: string, userId: string): Promise<SwapResult> {
    if (this.isPaused) {
      throw new Error(`Treasury swaps paused: ${this.pauseReason}`);
    }

    // Retrieve and validate quote
    const quote = this.pendingQuotes.get(quoteId);
    if (!quote) {
      throw new Error('Quote not found or already used');
    }

    if (Date.now() > quote.expiresAt) {
      this.pendingQuotes.delete(quoteId);
      throw new Error('Quote has expired');
    }

    // Consume the quote (one-time use)
    this.pendingQuotes.delete(quoteId);

    const { fromAsset, toAsset, fromAmount, toAmount, spreadAmount, oraclePrice } = quote;

    // Re-check treasury can fulfil (balances may have changed since quote)
    if (!this.canFulfill(toAsset, toAmount)) {
      throw new Error(
        `Insufficient treasury balance for ${toAsset}. ` +
        `Requested: ${toAmount}, Available: ${this.balances[toAsset] ?? '0'}`,
      );
    }

    // Execute: treasury receives fromAsset, sends toAsset
    this.balances[fromAsset] = decimalAdd(this.balances[fromAsset] ?? DECIMAL_ZERO, fromAmount);
    this.balances[toAsset] = decimalSub(this.balances[toAsset] ?? DECIMAL_ZERO, toAmount);

    const timestamp = new Date().toISOString();

    // Record swap in history
    const historyEntry: SwapHistoryEntry = {
      id: this.generateId('swap'),
      userId,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      spreadFee: spreadAmount,
      oraclePrice,
      timestamp,
    };
    this.swapHistory.push(historyEntry);

    // Update daily volume
    this.recordDailyVolume(userId, fromAsset, fromAmount);

    logger.info('[treasury] Swap executed', {
      userId,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      spreadFee: spreadAmount,
    });

    return {
      success: true,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      spreadFee: spreadAmount,
      oraclePrice,
      timestamp,
      treasuryBalanceAfter: { ...this.balances },
    };
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Check if the treasury has enough balance to fulfil a swap output.
   */
  canFulfill(toAsset: string, toAmount: string): boolean {
    const available = this.balances[toAsset];
    if (!available) return false;
    return decimalGte(available, toAmount);
  }

  /**
   * Get current treasury balances.
   */
  getBalances(): TreasuryBalance {
    return { ...this.balances };
  }

  /**
   * Get treasury health metrics including total USD value and exposure per asset.
   */
  async getHealth(): Promise<TreasuryHealth> {
    let totalValueUsd = DECIMAL_ZERO;
    const exposure: Record<string, string> = {};
    const assetValues: Record<string, string> = {};

    // Calculate USD value of each asset
    for (const [asset, amount] of Object.entries(this.balances)) {
      try {
        const priceData = await priceOracle.getPrice(asset);
        const valueUsd = decimalMul(amount, numberToDecimal(priceData.priceUsdcx));
        assetValues[asset] = valueUsd;
        totalValueUsd = decimalAdd(totalValueUsd, valueUsd);
      } catch {
        // If price unavailable, skip
        assetValues[asset] = DECIMAL_ZERO;
      }
    }

    // Calculate exposure percentages
    const totalNum = decimalToNumber(totalValueUsd);
    for (const [asset, valueUsd] of Object.entries(assetValues)) {
      if (totalNum > 0) {
        const pct = (decimalToNumber(valueUsd) / totalNum) * 100;
        exposure[asset] = numberToDecimal(pct, 2);
      } else {
        exposure[asset] = '0.00';
      }
    }

    return {
      totalValueUsd,
      balances: { ...this.balances },
      exposure,
      isPaused: this.isPaused,
      pauseReason: this.isPaused ? this.pauseReason : undefined,
    };
  }

  /**
   * Get swap history, optionally filtered by userId.
   */
  getSwapHistory(userId?: string, limit = 50): SwapHistoryEntry[] {
    let history = this.swapHistory;
    if (userId) {
      history = history.filter(h => h.userId === userId);
    }
    // Return most recent first, limited
    return history.slice(-limit).reverse();
  }

  /**
   * Get the daily swap volume used by a user (in USD terms).
   */
  getUserDailyVolume(userId: string): string {
    const today = this.todayUTC();
    const entry = this.dailyVolumes.get(userId);
    if (!entry || entry.date !== today) return DECIMAL_ZERO;
    return entry.totalUsd;
  }

  /**
   * Get all available trading pairs with current prices.
   */
  async getPairs(): Promise<Array<{
    from: string;
    to: string;
    price: string;
    spread: string;
    treasuryAvailable: string;
  }>> {
    const assets = Object.keys(this.balances);
    const pairs: Array<{
      from: string;
      to: string;
      price: string;
      spread: string;
      treasuryAvailable: string;
    }> = [];

    for (const from of assets) {
      for (const to of assets) {
        if (from === to) continue;
        try {
          const price = await this.getOraclePrice(from, to);
          pairs.push({
            from,
            to,
            price,
            spread: this.SPREAD_RATE,
            treasuryAvailable: this.balances[to] ?? DECIMAL_ZERO,
          });
        } catch {
          // Skip pair if pricing fails
        }
      }
    }

    return pairs;
  }

  // -----------------------------------------------------------------------
  // Auto-rebalance treasury
  // -----------------------------------------------------------------------

  /**
   * Auto-rebalance the treasury if any single token exceeds the exposure
   * threshold. Sells overweight assets for underweight ones at oracle prices
   * (no spread applied to internal rebalancing).
   */
  async autoRebalanceTreasury(): Promise<void> {
    const health = await this.getHealth();
    const totalUsd = decimalToNumber(health.totalValueUsd);
    if (totalUsd <= 0) return;

    const assets = Object.keys(this.balances);
    const targetPct = 1 / assets.length; // Equal weight target for treasury

    const overweight: Array<{ asset: string; excessUsd: number }> = [];
    const underweight: Array<{ asset: string; deficitUsd: number }> = [];

    for (const asset of assets) {
      const exposurePct = decimalToNumber(health.exposure[asset] ?? '0') / 100;
      const delta = exposurePct - targetPct;

      if (delta > 0.05) {
        // More than 5% overweight
        overweight.push({ asset, excessUsd: delta * totalUsd });
      } else if (delta < -0.05) {
        underweight.push({ asset, deficitUsd: Math.abs(delta) * totalUsd });
      }
    }

    if (overweight.length === 0 || underweight.length === 0) return;

    logger.info('[treasury] Auto-rebalancing treasury', {
      overweight: overweight.map(o => `${o.asset}: +${o.excessUsd.toFixed(2)} USD`),
      underweight: underweight.map(u => `${u.asset}: -${u.deficitUsd.toFixed(2)} USD`),
    });

    // Simple rebalance: sell from overweight, buy underweight
    for (const sell of overweight) {
      for (const buy of underweight) {
        if (buy.deficitUsd <= 0) continue;

        const tradeUsd = Math.min(sell.excessUsd, buy.deficitUsd);
        if (tradeUsd < 1) continue; // Skip dust

        try {
          const price = await this.getOraclePrice(sell.asset, buy.asset);
          const sellPrice = await priceOracle.getPrice(sell.asset);
          const sellAmount = numberToDecimal(tradeUsd / sellPrice.priceUsdcx);
          const buyAmount = decimalMul(sellAmount, price);

          // Check treasury has enough
          if (!this.canFulfill(sell.asset, sellAmount)) continue;

          // Internal transfer (no spread on treasury rebalance)
          this.balances[sell.asset] = decimalSub(this.balances[sell.asset], sellAmount);
          this.balances[buy.asset] = decimalAdd(this.balances[buy.asset] ?? DECIMAL_ZERO, buyAmount);

          sell.excessUsd -= tradeUsd;
          buy.deficitUsd -= tradeUsd;

          logger.info('[treasury] Internal rebalance leg', {
            sell: `${sellAmount} ${sell.asset}`,
            buy: `${buyAmount} ${buy.asset}`,
          });
        } catch (err) {
          logger.warn('[treasury] Rebalance leg failed', {
            from: sell.asset,
            to: buy.asset,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Circuit breaker
  // -----------------------------------------------------------------------

  /**
   * Manually pause treasury swaps.
   */
  pause(reason: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
    logger.warn('[treasury] Swaps paused', { reason });
  }

  /**
   * Resume treasury swaps after a pause.
   */
  resume(): void {
    this.isPaused = false;
    this.pauseReason = '';
    logger.info('[treasury] Swaps resumed');
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private validateAsset(asset: string): void {
    // Treasury only handles assets it has balances for
    const knownAssets = Object.keys(this.balances);
    if (!knownAssets.includes(asset)) {
      throw new Error(
        `Unsupported asset: ${asset}. Supported: ${knownAssets.join(', ')}`,
      );
    }
  }

  /**
   * Check if receiving fromAmount of fromAsset would push its exposure
   * beyond the maximum threshold.
   */
  private async checkExposureLimit(
    fromAsset: string,
    fromAmount: string,
    _toAsset: string,
    _toAmount: string,
  ): Promise<void> {
    try {
      const health = await this.getHealth();
      const totalUsd = decimalToNumber(health.totalValueUsd);
      if (totalUsd <= 0) return;

      // Calculate what the fromAsset value would be after the swap
      const fromPrice = await priceOracle.getPrice(fromAsset);
      const additionalUsd = decimalToNumber(fromAmount) * fromPrice.priceUsdcx;
      const currentExposurePct = decimalToNumber(health.exposure[fromAsset] ?? '0') / 100;
      const newValue = currentExposurePct * totalUsd + additionalUsd;
      const newExposure = newValue / (totalUsd + additionalUsd);

      if (newExposure > this.MAX_EXPOSURE_PCT) {
        throw new Error(
          `Swap would increase ${fromAsset} exposure to ${(newExposure * 100).toFixed(1)}%, ` +
          `exceeding ${(this.MAX_EXPOSURE_PCT * 100).toFixed(0)}% limit`,
        );
      }
    } catch (err) {
      // If it's our own exposure error, re-throw
      if (err instanceof Error && err.message.includes('exposure to')) {
        throw err;
      }
      // Otherwise log and allow (don't block on price fetch failure)
      logger.warn('[treasury] Could not verify exposure limit', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Record an oracle price snapshot for circuit breaker monitoring.
   */
  private recordOracleSnapshot(asset: string, price: number): void {
    const now = Date.now();
    let snapshots = this.oracleSnapshots.get(asset);
    if (!snapshots) {
      snapshots = [];
      this.oracleSnapshots.set(asset, snapshots);
    }

    snapshots.push({ price, timestamp: now });

    // Prune old snapshots (keep last 10 minutes)
    const cutoff = now - CIRCUIT_BREAKER_WINDOW_MS;
    const idx = snapshots.findIndex(s => s.timestamp >= cutoff);
    if (idx > 0) {
      snapshots.splice(0, idx);
    }
  }

  /**
   * Check if any asset price has moved more than the threshold within
   * the circuit breaker window. If so, pause swaps.
   */
  private checkCircuitBreaker(): void {
    const threshold = decimalToNumber(this.ORACLE_PAUSE_THRESHOLD);
    const now = Date.now();
    const cutoff = now - CIRCUIT_BREAKER_WINDOW_MS;

    for (const [asset, snapshots] of this.oracleSnapshots.entries()) {
      if (snapshots.length < 2) continue;

      const recent = snapshots.filter(s => s.timestamp >= cutoff);
      if (recent.length < 2) continue;

      const oldest = recent[0];
      const newest = recent[recent.length - 1];

      if (oldest.price === 0) continue;

      const change = Math.abs(newest.price - oldest.price) / oldest.price;
      if (change > threshold) {
        this.pause(
          `${asset} price moved ${(change * 100).toFixed(2)}% in ${CIRCUIT_BREAKER_WINDOW_MS / 60_000} minutes ` +
          `(threshold: ${(threshold * 100).toFixed(1)}%)`,
        );
        return;
      }
    }
  }

  /**
   * Record daily swap volume for a user in USD terms.
   */
  private async recordDailyVolume(userId: string, fromAsset: string, fromAmount: string): Promise<void> {
    const today = this.todayUTC();
    let entry = this.dailyVolumes.get(userId);

    // Reset if new day
    if (!entry || entry.date !== today) {
      entry = { date: today, totalUsd: DECIMAL_ZERO };
      this.dailyVolumes.set(userId, entry);
    }

    try {
      const price = await priceOracle.getPrice(fromAsset);
      const valueUsd = decimalMul(fromAmount, numberToDecimal(price.priceUsdcx));
      entry.totalUsd = decimalAdd(entry.totalUsd, valueUsd);
    } catch {
      // Best effort — if price unavailable, don't block the swap
    }
  }

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private generateId(prefix: string): string {
    this.idCounter++;
    return `${prefix}-${Date.now()}-${this.idCounter}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const treasurySwapEngine = new TreasurySwapEngine();
