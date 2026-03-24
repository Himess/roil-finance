import * as path from 'node:path';
import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';
import { featuredApp } from './featured-app.js';
import { priceOracle } from '../services/price-oracle.js';
import { logger } from '../monitoring/logger.js';
import * as db from '../db/index.js';
import type { PortfolioPayload } from './rebalance.js';
import { yieldAggregator } from '../services/yield-sources.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompoundConfig {
  enabled: boolean;
  minCompoundAmount: number;  // minimum yield to trigger compound (in USDCx)
  frequency: 'hourly' | 'daily' | 'weekly';
  reinvestStrategy: 'portfolio-targets' | 'same-asset' | 'usdc-only';
}

export interface YieldSource {
  type: 'staking' | 'lending' | 'lp-fees';
  asset: string;
  amount: number;
  apy: number;
  provider: string;  // e.g., "Canton Staking", "Alpend", "Cantex LP"
}

export interface CompoundResult {
  timestamp: string;
  yieldSources: YieldSource[];
  totalYieldUsdcx: number;
  reinvestments: Array<{ asset: string; amount: number }>;
  txIds: string[];
}

// ---------------------------------------------------------------------------
// Constants — fallback APY rates (used only when YieldAggregator fails)
// ---------------------------------------------------------------------------
// Live rates are now fetched via YieldAggregator from:
//   - AlpendYieldSource (lending protocol on Canton)
//   - CantexLPYieldSource (DEX LP fees)
//   - StakingYieldSource (CC staking via Canton Scan)
// Fallback rates below are used only if ALL live sources fail.
// ---------------------------------------------------------------------------

/** CC native staking APY ~5% (fallback) */
const CC_STAKING_APY = 0.05;

/** Alpend lending APY ~3% (fallback) */
const ALPEND_LENDING_APY = 0.03;

/** Cantex LP fee APY ~8% (fallback) */
const CANTEX_LP_APY = 0.08;

/** Hours per frequency period */
const FREQUENCY_HOURS: Record<CompoundConfig['frequency'], number> = {
  hourly: 1,
  daily: 24,
  weekly: 168,
};

// ---------------------------------------------------------------------------
// File-based persistence
// File-based persistence serves as a fallback cache.
// Primary persistence is via CompoundConfig Daml template on the ledger.
// See saveConfigToLedger() and loadConfigsFromLedger() below.
// ---------------------------------------------------------------------------

const STATE_FILE_PATH = process.env.COMPOUND_STATE_PATH
  || (process.platform === 'win32' ? path.join(process.env.TEMP || 'C:\\Temp', 'roil-finance-compound-state.json') : '/tmp/roil-finance-compound-state.json');

interface PersistedState {
  configs: Array<[string, CompoundConfig]>;
  history: Array<[string, CompoundResult[]]>;
}

let saveQueued = false;
let saveLock = false;

/** Save compound configs and history to a JSON file. */
async function saveState(): Promise<void> {
  if (saveLock) { saveQueued = true; return; }
  saveLock = true;
  try {
    const state: PersistedState = {
      configs: Array.from(compoundConfigs.entries()),
      history: Array.from(compoundHistory.entries()),
    };
    await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to save state: ${message}`, { component: 'compound' });
  } finally {
    saveLock = false;
    if (saveQueued) { saveQueued = false; void saveState(); }
  }
}

/** Load compound configs and history from a JSON file. */
async function loadState(): Promise<void> {
  try {
    if (!existsSync(STATE_FILE_PATH)) return;
    const raw = await readFile(STATE_FILE_PATH, 'utf-8');
    const state: PersistedState = JSON.parse(raw);

    if (Array.isArray(state.configs)) {
      for (const [party, cfg] of state.configs) {
        compoundConfigs.set(party, cfg);
      }
    }
    if (Array.isArray(state.history)) {
      for (const [party, results] of state.history) {
        compoundHistory.set(party, results);
      }
    }

    logger.info(`Loaded state: ${compoundConfigs.size} configs, ${compoundHistory.size} history entries`, { component: 'compound' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load state: ${message}`, { component: 'compound' });
  }
}

// ---------------------------------------------------------------------------
// Ledger-based persistence (Daml CompoundConfig template)
// ---------------------------------------------------------------------------

async function saveConfigToLedger(party: string, cfg: CompoundConfig): Promise<void> {
  try {
    // Check if a config already exists on ledger
    const existing = await ledger.query(TEMPLATES.CompoundConfig, config.platformParty);
    const userConfig = existing.find((c: any) => c.payload?.user === party);

    if (userConfig) {
      // Update existing config
      await ledger.exerciseAs(
        TEMPLATES.CompoundConfig,
        userConfig.contractId,
        'UpdateCompoundConfig',
        {
          newStrategy: cfg.reinvestStrategy,
          newThreshold: String(cfg.minCompoundAmount),
          newEnabled: cfg.enabled,
        },
        party,
      );
    } else {
      // Create new config on ledger
      await ledger.createAs(
        TEMPLATES.CompoundConfig,
        {
          platform: config.platformParty,
          user: party,
          strategy: cfg.reinvestStrategy,
          minYieldThreshold: String(cfg.minCompoundAmount),
          isEnabled: cfg.enabled,
          lastCompoundAt: '',
          totalCompounded: '0.0',
        },
        config.platformParty,
      );
    }
    logger.info('Compound config synced to ledger', { party, strategy: cfg.reinvestStrategy });
  } catch (err) {
    logger.warn('Failed to sync compound config to ledger, using file fallback', { error: String(err) });
  }
}

async function loadConfigsFromLedger(): Promise<void> {
  try {
    const configs = await ledger.query(TEMPLATES.CompoundConfig, config.platformParty);
    for (const c of configs) {
      const payload = c.payload as any;
      if (payload?.user && payload?.strategy) {
        compoundConfigs.set(payload.user, {
          enabled: payload.isEnabled ?? true,
          minCompoundAmount: parseFloat(payload.minYieldThreshold) || 1.0,
          frequency: 'daily',
          reinvestStrategy: payload.strategy,
        });
      }
    }
    logger.info(`Loaded ${configs.length} compound configs from ledger`, { component: 'compound' });
  } catch (err) {
    logger.warn('Failed to load compound configs from ledger, using file fallback', { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Per-party compound configurations */
const compoundConfigs = new Map<string, CompoundConfig>();

/** Per-party compound history */
const compoundHistory = new Map<string, CompoundResult[]>();

/** Per-party last compound timestamp */
export const lastCompoundTime = new Map<string, number>();

// Load persisted state on module initialization.
// Order: file → database → ledger. Each layer fills gaps left by the previous.
void loadState().then(async () => {
  // Hydrate from Postgres if available
  if (db.isDbAvailable()) {
    try {
      const dbConfigs = await db.getAllCompoundConfigs();
      for (const row of dbConfigs) {
        if (!compoundConfigs.has(row.party)) {
          compoundConfigs.set(row.party, {
            enabled: row.enabled,
            minCompoundAmount: row.min_amount,
            frequency: row.frequency as CompoundConfig['frequency'],
            reinvestStrategy: row.reinvest_strategy as CompoundConfig['reinvestStrategy'],
          });
        }
      }
      logger.info(`Loaded ${dbConfigs.length} compound configs from database`, { component: 'compound' });
    } catch {
      // DB unavailable — continue with file state
    }
  }
  // Finally try ledger
  await loadConfigsFromLedger();
});

/** Reset all in-memory state (for testing only). */
export function _resetCompoundState(): void {
  compoundConfigs.clear();
  compoundHistory.clear();
  lastCompoundTime.clear();
}

// ---------------------------------------------------------------------------
// CompoundEngine
// ---------------------------------------------------------------------------

/**
 * Auto-compound engine for Roil.
 *
 * Detects yield from three sources:
 * 1. **CC Staking** — native staking rewards (~5% APY)
 * 2. **Alpend Lending** — lending yields on USDCx/CBTC (~3% APY)
 * 3. **Cantex LP Fees** — liquidity provision fees (~8% APY)
 *
 * Automatically reinvests accumulated yield according to one of three
 * strategies: portfolio-targets, same-asset, or usdc-only.
 */
export class CompoundEngine {
  // -----------------------------------------------------------------------
  // Yield detection
  // -----------------------------------------------------------------------

  /**
   * Detect available yields for a party.
   *
   * Uses YieldAggregator to query real yield sources (Alpend, Cantex LP,
   * Canton Staking) with automatic fallback to hardcoded rates if all
   * live sources fail. Yields are cached for 5 minutes by the aggregator.
   *
   * For each holding:
   * 1. Query YieldAggregator for live APY on that asset
   * 2. Determine yield type (staking for CC, lending for stables, LP for DEX pairs)
   * 3. Compute accrued yield based on time since last compound
   */
  async detectYields(party: string): Promise<YieldSource[]> {
    const yields: YieldSource[] = [];

    try {
      // Get the party's current holdings from Cantex
      const balances = await cantex.getBalances(party);
      const prices = await cantex.getPrices();

      // Determine time since last compound (or default to 24h for first detection)
      const lastTime = lastCompoundTime.get(party);
      const hoursSinceLastCompound = lastTime
        ? (Date.now() - lastTime) / (1000 * 60 * 60)
        : 24;

      for (const balance of balances) {
        const { asset, amount } = balance;
        const priceUsdcx = prices[asset] ?? 0;
        const valueUsdcx = amount * priceUsdcx;

        if (valueUsdcx <= 0) continue;

        // Query real yield from YieldAggregator (with 5-min cache)
        const yieldQuote = await yieldAggregator.getBestYield(asset);

        if (yieldQuote.apy <= 0) continue;

        // Determine yield type based on source
        let yieldType: YieldSource['type'] = 'lending';
        if (yieldQuote.source.toLowerCase().includes('staking')) {
          yieldType = 'staking';
        } else if (yieldQuote.source.toLowerCase().includes('lp') || yieldQuote.source.toLowerCase().includes('pool')) {
          yieldType = 'lp-fees';
        }

        // Compute accrued yield for the period
        const accruedYield = this.computeAccruedYield(
          valueUsdcx,
          yieldQuote.apy,
          hoursSinceLastCompound,
        );

        if (accruedYield > 0) {
          yields.push({
            type: yieldType,
            asset,
            amount: accruedYield / priceUsdcx, // Convert back to asset units
            apy: yieldQuote.apy * 100,
            provider: `${yieldQuote.source} [${yieldQuote.confidence}]`,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Error detecting yields for ${party}: ${message}`, { component: 'compound' });
    }

    return yields;
  }

  // -----------------------------------------------------------------------
  // Execute compound
  // -----------------------------------------------------------------------

  /**
   * Execute auto-compound for a party.
   *
   * Steps:
   * 1. Detect all available yields
   * 2. Check if total yield meets the minimum compound threshold
   * 3. Collect/claim yields (mock: yield is already computed)
   * 4. Reinvest according to the configured strategy
   * 5. Execute swaps via Cantex
   * 6. Record on ledger
   * 7. Record Featured App activity
   *
   * Returns null if yield is below minimum or compounding is not enabled.
   */
  async executeCompound(
    party: string,
    compoundConfig: CompoundConfig,
  ): Promise<CompoundResult | null> {
    if (!compoundConfig.enabled) {
      return null;
    }

    // 1. Detect yields
    const yieldSources = await this.detectYields(party);
    if (yieldSources.length === 0) {
      return null;
    }

    // 2. Calculate total yield in USDCx
    const prices = await cantex.getPrices();
    let totalYieldUsdcx = 0;
    for (const ys of yieldSources) {
      const priceUsdcx = prices[ys.asset] ?? 0;
      totalYieldUsdcx += ys.amount * priceUsdcx;
    }

    // 3. Check minimum threshold
    if (totalYieldUsdcx < compoundConfig.minCompoundAmount) {
      return null;
    }

    // 4. Plan reinvestments based on strategy
    const reinvestments = await this.planReinvestments(
      party,
      totalYieldUsdcx,
      compoundConfig.reinvestStrategy,
      yieldSources,
    );

    // 5. Execute swaps via Cantex
    const txIds: string[] = [];
    for (const reinvestment of reinvestments) {
      if (reinvestment.asset === 'USDCx') {
        // No swap needed — yield is already in USDCx terms
        txIds.push(crypto.randomUUID());
        continue;
      }

      try {
        const swap = await cantex.executeSwap('USDCx', reinvestment.asset, reinvestment.amount);
        txIds.push(swap.txId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Swap failed for ${reinvestment.asset}: ${message}`, { component: 'compound' });
        // Continue with remaining reinvestments
        txIds.push(`failed-${crypto.randomUUID()}`);
      }
    }

    // 6. Update last compound time
    lastCompoundTime.set(party, Date.now());

    // 7. Build result
    const result: CompoundResult = {
      timestamp: new Date().toISOString(),
      yieldSources,
      totalYieldUsdcx,
      reinvestments,
      txIds,
    };

    // 8. Store in history
    const history = compoundHistory.get(party) ?? [];
    history.push(result);
    // Keep last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    compoundHistory.set(party, history);

    // 8b. Persist state to disk
    await saveState();

    // 8c. Record compound on ledger with yield source details
    const yieldSourceSummary = yieldSources
      .map(ys => `${ys.asset}: ${ys.apy.toFixed(2)}% via ${ys.provider}`)
      .join('; ');
    try {
      const existing = await ledger.query(TEMPLATES.CompoundConfig, config.platformParty);
      const userConfig = existing.find((c: any) => c.payload?.user === party);
      if (userConfig) {
        await ledger.exerciseAs(
          TEMPLATES.CompoundConfig,
          userConfig.contractId,
          'RecordCompound',
          {
            compoundedAmount: String(totalYieldUsdcx),
            compoundedAt: new Date().toISOString(),
            yieldSources: yieldSourceSummary,
          },
          config.platformParty,
        );
      }
    } catch (err) {
      logger.warn('Failed to record compound on ledger', { error: String(err) });
    }

    // 9. Record Featured App activity with yield source details
    try {
      await featuredApp.recordActivity(
        party,
        'CompoundExecution',
        `Auto-compound: ${totalYieldUsdcx.toFixed(2)} USDCx yield reinvested via ${compoundConfig.reinvestStrategy} strategy (sources: ${yieldSourceSummary})`,
      );
    } catch {
      // Best effort — don't fail the compound for activity recording
    }

    logger.info(
      `Executed for ${party}: ${yieldSources.length} sources, ${totalYieldUsdcx.toFixed(2)} USDCx total, ${reinvestments.length} reinvestments, strategy=${compoundConfig.reinvestStrategy}`,
      { component: 'compound', yieldSources: yieldSourceSummary },
    );

    return result;
  }

  // -----------------------------------------------------------------------
  // Check and compound all
  // -----------------------------------------------------------------------

  /**
   * Check and execute auto-compound for all parties with active configurations.
   *
   * Called periodically by the cron scheduler. For each party:
   * 1. Check if compound frequency period has elapsed
   * 2. If due, execute compound
   */
  async checkAndCompoundAll(): Promise<void> {
    const now = Date.now();

    for (const [party, cfg] of compoundConfigs.entries()) {
      if (!cfg.enabled) continue;

      const lastTime = lastCompoundTime.get(party) ?? 0;
      const intervalMs = FREQUENCY_HOURS[cfg.frequency] * 60 * 60 * 1000;

      if (now - lastTime < intervalMs) {
        continue; // Not due yet
      }

      try {
        const result = await this.executeCompound(party, cfg);
        if (result) {
          logger.info(
            `Auto-compound for ${party}: ${result.totalYieldUsdcx.toFixed(2)} USDCx`,
            { component: 'compound' },
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Auto-compound failed for ${party}: ${message}`, { component: 'compound' });
      }
    }
  }

  // -----------------------------------------------------------------------
  // History
  // -----------------------------------------------------------------------

  /**
   * Get compound execution history for a party.
   */
  async getCompoundHistory(party: string): Promise<CompoundResult[]> {
    return compoundHistory.get(party) ?? [];
  }

  // -----------------------------------------------------------------------
  // Yield summary
  // -----------------------------------------------------------------------

  /**
   * Get current yield summary for a party.
   *
   * Returns all active yield sources, total daily yield in USDCx,
   * weighted average APY across all sources, and next scheduled
   * compound time.
   */
  async getYieldSummary(party: string): Promise<{
    sources: YieldSource[];
    totalDailyYield: number;
    totalApyWeighted: number;
    nextCompoundAt: string | null;
  }> {
    const sources = await this.detectYields(party);
    const prices = await cantex.getPrices();

    // Calculate total daily yield in USDCx
    // Each source's amount is the yield accrued since last compound.
    // We normalize to daily by using the hours since last compound.
    const lastTime = lastCompoundTime.get(party);
    const hoursSinceCompound = lastTime
      ? (Date.now() - lastTime) / (1000 * 60 * 60)
      : 24;

    let totalAccruedUsdcx = 0;
    let totalValueWeightedApy = 0;
    let totalValue = 0;

    for (const source of sources) {
      const priceUsdcx = prices[source.asset] ?? 0;
      const yieldUsdcx = source.amount * priceUsdcx;
      totalAccruedUsdcx += yieldUsdcx;

      // For weighted APY: weight by the underlying principal value
      const apyDecimal = source.apy / 100;
      const hourlyYieldRate = apyDecimal / (365 * 24);
      const principalUsdcx = hoursSinceCompound > 0
        ? yieldUsdcx / (hourlyYieldRate * hoursSinceCompound)
        : 0;
      totalValueWeightedApy += principalUsdcx * apyDecimal;
      totalValue += principalUsdcx;
    }

    // Normalize accrued yield to daily
    const totalDailyYield = hoursSinceCompound > 0
      ? (totalAccruedUsdcx / hoursSinceCompound) * 24
      : 0;

    // Weighted APY
    const totalApyWeighted = totalValue > 0
      ? (totalValueWeightedApy / totalValue) * 100
      : 0;

    // Next compound time
    let nextCompoundAt: string | null = null;
    const cfg = compoundConfigs.get(party);
    if (cfg?.enabled) {
      const lastCompound = lastCompoundTime.get(party) ?? Date.now();
      const intervalMs = FREQUENCY_HOURS[cfg.frequency] * 60 * 60 * 1000;
      nextCompoundAt = new Date(lastCompound + intervalMs).toISOString();
    }

    return {
      sources,
      totalDailyYield,
      totalApyWeighted,
      nextCompoundAt,
    };
  }

  // -----------------------------------------------------------------------
  // Configuration management
  // -----------------------------------------------------------------------

  /**
   * Get compound configuration for a party.
   * Checks in-memory cache first, then database, then returns defaults.
   */
  getConfig(party: string): CompoundConfig {
    return compoundConfigs.get(party) ?? {
      enabled: false,
      minCompoundAmount: 1.0,
      frequency: 'daily',
      reinvestStrategy: 'portfolio-targets',
    };
  }

  /**
   * Get compound configuration for a party, checking the database if
   * the in-memory cache does not have it.
   */
  async getConfigAsync(party: string): Promise<CompoundConfig> {
    // Check in-memory first
    const cached = compoundConfigs.get(party);
    if (cached) return cached;

    // Try database
    if (db.isDbAvailable()) {
      const row = await db.getCompoundConfig(party);
      if (row) {
        const cfg: CompoundConfig = {
          enabled: row.enabled,
          minCompoundAmount: row.min_amount,
          frequency: row.frequency as CompoundConfig['frequency'],
          reinvestStrategy: row.reinvest_strategy as CompoundConfig['reinvestStrategy'],
        };
        // Hydrate in-memory cache
        compoundConfigs.set(party, cfg);
        return cfg;
      }
    }

    return {
      enabled: false,
      minCompoundAmount: 1.0,
      frequency: 'daily',
      reinvestStrategy: 'portfolio-targets',
    };
  }

  /**
   * Update compound configuration for a party.
   * Persists to Postgres (if available), file, and ledger.
   */
  setConfig(party: string, cfg: CompoundConfig): void {
    compoundConfigs.set(party, cfg);
    void saveState();
    void saveConfigToLedger(party, cfg);

    // Persist to Postgres if available
    if (db.isDbAvailable()) {
      void db.upsertCompoundConfig(
        party,
        cfg.enabled,
        cfg.minCompoundAmount,
        cfg.frequency,
        cfg.reinvestStrategy,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Compute accrued yield for a given principal, APY, and time period.
   *
   * Uses simple interest for short periods (< 1 year):
   *   yield = principal * (APY / (365 * 24)) * hours
   */
  private computeAccruedYield(
    principalUsdcx: number,
    apy: number,
    hours: number,
  ): number {
    if (principalUsdcx <= 0 || apy <= 0 || hours <= 0) return 0;
    const hourlyRate = apy / (365 * 24);
    return principalUsdcx * hourlyRate * hours;
  }

  /**
   * Plan reinvestments based on the configured strategy.
   *
   * Strategies:
   * - **portfolio-targets**: Distribute yield to match portfolio target allocations.
   *   This keeps the portfolio balanced as yield is reinvested.
   *
   * - **same-asset**: Reinvest each yield source back into the same asset.
   *   This maximizes compound growth of each individual position.
   *
   * - **usdc-only**: Convert all yield to USDCx.
   *   This is the conservative option — yield is taken as stablecoins.
   */
  private async planReinvestments(
    party: string,
    totalYieldUsdcx: number,
    strategy: CompoundConfig['reinvestStrategy'],
    detectedYields?: YieldSource[],
  ): Promise<Array<{ asset: string; amount: number }>> {
    switch (strategy) {
      case 'portfolio-targets':
        return this.planPortfolioTargetsReinvestment(party, totalYieldUsdcx);

      case 'same-asset':
        return this.planSameAssetReinvestment(party, totalYieldUsdcx, detectedYields);

      case 'usdc-only':
        return [{ asset: 'USDCx', amount: totalYieldUsdcx }];
    }
  }

  /**
   * Plan reinvestment according to portfolio target allocations.
   *
   * Queries the party's active portfolio targets and distributes yield
   * proportionally. If no portfolio exists, falls back to equal split
   * across all held assets.
   */
  private async planPortfolioTargetsReinvestment(
    party: string,
    totalYieldUsdcx: number,
  ): Promise<Array<{ asset: string; amount: number }>> {
    try {
      const platform = config.platformParty;
      const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);
      const portfolio = portfolios.find((p) => p.payload.user === party && p.payload.isActive);

      if (portfolio) {
        const reinvestments: Array<{ asset: string; amount: number }> = [];

        for (const target of portfolio.payload.targets) {
          const allocation = target.targetPct / 100;
          const amount = totalYieldUsdcx * allocation;

          if (amount > 0.01) { // Skip dust
            reinvestments.push({
              asset: target.asset.symbol,
              amount,
            });
          }
        }

        if (reinvestments.length > 0) {
          return reinvestments;
        }
      }
    } catch {
      // Ledger unavailable — fall through to default
    }

    // Fallback: equal split across CC, USDCx, CBTC
    const split = totalYieldUsdcx / 3;
    return [
      { asset: 'CC', amount: split },
      { asset: 'USDCx', amount: split },
      { asset: 'CBTC', amount: split },
    ];
  }

  /**
   * Plan reinvestment back into the same yielding assets.
   *
   * Each yield source's contribution is reinvested proportionally
   * into the asset that generated it.
   */
  private async planSameAssetReinvestment(
    party: string,
    totalYieldUsdcx: number,
    detectedYields?: YieldSource[],
  ): Promise<Array<{ asset: string; amount: number }>> {
    const yields = detectedYields ?? await this.detectYields(party);
    const prices = await cantex.getPrices();

    // Calculate each source's USDCx contribution
    let totalContribution = 0;
    const contributions: Array<{ asset: string; usdcxValue: number }> = [];

    for (const ys of yields) {
      const priceUsdcx = prices[ys.asset] ?? 0;
      const usdcxValue = ys.amount * priceUsdcx;
      totalContribution += usdcxValue;
      contributions.push({ asset: ys.asset, usdcxValue });
    }

    if (totalContribution === 0) {
      return [{ asset: 'USDCx', amount: totalYieldUsdcx }];
    }

    // Deduplicate by asset and distribute proportionally
    const assetMap = new Map<string, number>();
    for (const c of contributions) {
      const proportion = c.usdcxValue / totalContribution;
      const amount = totalYieldUsdcx * proportion;
      assetMap.set(c.asset, (assetMap.get(c.asset) ?? 0) + amount);
    }

    const reinvestments: Array<{ asset: string; amount: number }> = [];
    for (const [asset, amount] of assetMap.entries()) {
      if (amount > 0.01) { // Skip dust
        reinvestments.push({ asset, amount });
      }
    }

    return reinvestments.length > 0
      ? reinvestments
      : [{ asset: 'USDCx', amount: totalYieldUsdcx }];
  }
}

// ---------------------------------------------------------------------------
// Dependency Injection Support
// ---------------------------------------------------------------------------
// For testing and multi-instance deployment, engines can be instantiated with
// custom dependencies via CompoundEngine constructor or a factory function.
// Currently module-level singletons are used for simplicity. Migration path:
// 1. Change module-level `ledger`/`cantex`/`config` references to this.deps.*
// 2. Update tests to inject mocks
// 3. Update index.ts to create engines with injected dependencies
// ---------------------------------------------------------------------------

/** Singleton instance */
export const compoundEngine = new CompoundEngine();
