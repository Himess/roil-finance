import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetId {
  symbol: string;
  admin: string;
}

export interface TargetAllocation {
  asset: AssetId;
  targetPct: number;
}

export interface Holding {
  asset: AssetId;
  amount: number;
  valueCc: number;
}

export interface SwapLeg {
  fromAsset: AssetId;
  toAsset: AssetId;
  fromAmount: number;
  toAmount: number;
}

export interface DriftResult {
  maxDrift: number;
  drifts: Map<string, number>;
}

export interface RebalanceResult {
  success: boolean;
  swapLegs: SwapLeg[];
  driftBefore: number;
  driftAfter: number;
  error?: string;
}

export interface PortfolioPayload {
  platform: string;
  user: string;
  targets: TargetAllocation[];
  holdings: Holding[];
  triggerMode: Record<string, unknown>;
  totalRebalances: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// RebalanceEngine
// ---------------------------------------------------------------------------

/**
 * Core rebalancing logic.
 *
 * Given a portfolio's current holdings and target allocations, the engine
 * calculates the drift from target, plans the minimum set of swap legs to
 * bring the portfolio back into alignment, and executes those swaps via
 * Cantex DEX. All state transitions are recorded on the Daml ledger.
 */
export class RebalanceEngine {
  // -----------------------------------------------------------------------
  // Drift calculation
  // -----------------------------------------------------------------------

  /**
   * Calculate drift of each asset from its target allocation.
   *
   * Drift is the absolute difference between current % and target %.
   * maxDrift is the largest single-asset deviation.
   */
  calculateDrift(holdings: Holding[], targets: TargetAllocation[]): DriftResult {
    const totalValue = holdings.reduce((sum, h) => sum + h.valueCc, 0);
    const drifts = new Map<string, number>();
    let maxDrift = 0;

    for (const target of targets) {
      const holding = holdings.find((h) => h.asset.symbol === target.asset.symbol);
      const currentPct = totalValue > 0 && holding ? (holding.valueCc / totalValue) * 100 : 0;
      const drift = Math.abs(currentPct - target.targetPct);
      drifts.set(target.asset.symbol, drift);
      if (drift > maxDrift) {
        maxDrift = drift;
      }
    }

    return { maxDrift, drifts };
  }

  // -----------------------------------------------------------------------
  // Swap leg planning
  // -----------------------------------------------------------------------

  /**
   * Plan the swap legs needed to rebalance a portfolio.
   *
   * Algorithm:
   * 1. Compute current value weight (%) of each asset
   * 2. Compare to targets — partition into overweight (sell) and underweight (buy)
   * 3. Match sell amounts to buy amounts, routing through USDCx when necessary
   *
   * The engine attempts to minimize the number of swap legs.
   * All amounts are denominated in the respective asset units.
   */
  async planSwapLegs(
    holdings: Holding[],
    targets: TargetAllocation[],
  ): Promise<SwapLeg[]> {
    const totalValue = holdings.reduce((sum, h) => sum + h.valueCc, 0);
    if (totalValue <= 0) return [];

    const prices = await cantex.getPrices();

    // Calculate the value delta for each asset (positive = overweight, negative = underweight)
    interface AssetDelta {
      symbol: string;
      admin: string;
      delta: number; // value delta in USDCx
    }

    const deltas: AssetDelta[] = [];

    for (const target of targets) {
      const { symbol } = target.asset;
      const holding = holdings.find((h) => h.asset.symbol === symbol);
      const currentValue = holding ? holding.valueCc * (prices.CC ?? 0.15) : 0;
      // Convert totalValue from CC to USDCx for uniform comparison
      const totalValueUsd = totalValue * (prices.CC ?? 0.15);
      const targetValue = (target.targetPct / 100) * totalValueUsd;
      const delta = currentValue - targetValue;

      deltas.push({ symbol, admin: target.asset.admin, delta });
    }

    // Separate into sells (overweight) and buys (underweight)
    const sells = deltas
      .filter((d) => d.delta > 0.01) // small dust filter
      .sort((a, b) => b.delta - a.delta);

    const buys = deltas
      .filter((d) => d.delta < -0.01)
      .map((d) => ({ ...d, delta: Math.abs(d.delta) }))
      .sort((a, b) => b.delta - a.delta);

    if (sells.length === 0 || buys.length === 0) return [];

    const legs: SwapLeg[] = [];
    let sellIdx = 0;
    let buyIdx = 0;
    let sellRemaining = sells[sellIdx].delta;
    let buyRemaining = buys[buyIdx].delta;

    while (sellIdx < sells.length && buyIdx < buys.length) {
      const tradeValue = Math.min(sellRemaining, buyRemaining);
      if (tradeValue < 0.01) {
        // Skip dust
        sellIdx++;
        buyIdx++;
        if (sellIdx < sells.length) sellRemaining = sells[sellIdx].delta;
        if (buyIdx < buys.length) buyRemaining = buys[buyIdx].delta;
        continue;
      }

      const sell = sells[sellIdx];
      const buy = buys[buyIdx];

      const fromPrice = prices[sell.symbol] ?? 1;
      const toPrice = prices[buy.symbol] ?? 1;
      const fromAmount = tradeValue / fromPrice;
      const toAmount = tradeValue / toPrice;

      legs.push({
        fromAsset: { symbol: sell.symbol, admin: sell.admin },
        toAsset: { symbol: buy.symbol, admin: buy.admin },
        fromAmount,
        toAmount,
      });

      sellRemaining -= tradeValue;
      buyRemaining -= tradeValue;

      if (sellRemaining < 0.01) {
        sellIdx++;
        if (sellIdx < sells.length) sellRemaining = sells[sellIdx].delta;
      }
      if (buyRemaining < 0.01) {
        buyIdx++;
        if (buyIdx < buys.length) buyRemaining = buys[buyIdx].delta;
      }
    }

    return legs;
  }

  // -----------------------------------------------------------------------
  // Full rebalance execution
  // -----------------------------------------------------------------------

  /**
   * Execute a full rebalance for a portfolio.
   *
   * Steps:
   * 1. Fetch the portfolio contract from the ledger
   * 2. Compute swap legs
   * 3. Exercise InitiateRebalance → get RebalanceRequest
   * 4. Exercise SetSwapLegs with planned legs
   * 5. Execute each swap via Cantex
   * 6. Exercise CompleteRebalance with executed legs
   * 7. Sync updated holdings back to Portfolio
   */
  async executeRebalance(portfolioContractId: string): Promise<RebalanceResult> {
    const platform = config.platformParty;

    try {
      // 1. Fetch portfolio
      const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);
      const portfolio = portfolios.find((p) => p.contractId === portfolioContractId);
      if (!portfolio) {
        return { success: false, swapLegs: [], driftBefore: 0, driftAfter: 0, error: 'Portfolio not found' };
      }

      const { holdings, targets } = portfolio.payload;
      const driftBefore = this.calculateDrift(holdings, targets).maxDrift;

      // 2. Plan swap legs
      const plannedLegs = await this.planSwapLegs(holdings, targets);
      if (plannedLegs.length === 0) {
        return { success: true, swapLegs: [], driftBefore, driftAfter: driftBefore, error: 'Already balanced' };
      }

      // 3. Initiate rebalance on ledger
      const initiateResult = await ledger.exerciseAs<[string, string]>(
        TEMPLATES.Portfolio,
        portfolioContractId,
        'InitiateRebalance',
        {},
        platform,
      );
      const [newPortfolioCid, requestCid] = initiateResult;

      // 4. Set swap legs on the request
      const damlLegs = plannedLegs.map((leg) => ({
        fromAsset: leg.fromAsset,
        toAsset: leg.toAsset,
        fromAmount: String(leg.fromAmount),
        toAmount: String(leg.toAmount),
      }));

      const setLegsResult = await ledger.exerciseAs<string>(
        TEMPLATES.RebalanceRequest,
        requestCid,
        'SetSwapLegs',
        { legs: damlLegs },
        platform,
      );
      const updatedRequestCid = setLegsResult;

      // 5. Execute each swap via Cantex
      const executedLegs: SwapLeg[] = [];
      for (const leg of plannedLegs) {
        const swap = await cantex.executeSwap(
          leg.fromAsset.symbol,
          leg.toAsset.symbol,
          leg.fromAmount,
        );
        executedLegs.push({
          fromAsset: leg.fromAsset,
          toAsset: leg.toAsset,
          fromAmount: swap.inputAmount,
          toAmount: swap.outputAmount,
        });
      }

      // 6. Complete rebalance on ledger
      const completedDamlLegs = executedLegs.map((leg) => ({
        fromAsset: leg.fromAsset,
        toAsset: leg.toAsset,
        fromAmount: String(leg.fromAmount),
        toAmount: String(leg.toAmount),
      }));

      await ledger.exerciseAs(
        TEMPLATES.RebalanceRequest,
        updatedRequestCid,
        'CompleteRebalance',
        {
          executedLegs: completedDamlLegs,
          completedAt: new Date().toISOString(),
        },
        platform,
      );

      // 7. Sync holdings (simplified — in production query real balances)
      const updatedHoldings = await this.computeUpdatedHoldings(holdings, executedLegs);
      await ledger.exerciseAs(
        TEMPLATES.Portfolio,
        newPortfolioCid,
        'SyncHoldings',
        {
          newHoldings: updatedHoldings.map((h) => ({
            asset: h.asset,
            amount: String(h.amount),
            valueCc: String(h.valueCc),
          })),
        },
        platform,
      );

      const driftAfter = this.calculateDrift(updatedHoldings, targets).maxDrift;

      return { success: true, swapLegs: executedLegs, driftBefore, driftAfter };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Try to fail the rebalance request on ledger (best effort)
      try {
        const requests = await ledger.query(TEMPLATES.RebalanceRequest, platform);
        const pending = requests.find(
          (r) => (r.payload as Record<string, unknown>).status === 'Pending'
            || (r.payload as Record<string, unknown>).status === 'Executing',
        );
        if (pending) {
          await ledger.exerciseAs(
            TEMPLATES.RebalanceRequest,
            pending.contractId,
            'FailRebalance',
            { reason: message },
            platform,
          );
        }
      } catch {
        // Ignore — best effort cleanup
      }

      return { success: false, swapLegs: [], driftBefore: 0, driftAfter: 0, error: message };
    }
  }

  // -----------------------------------------------------------------------
  // Auto-rebalance (cron)
  // -----------------------------------------------------------------------

  /**
   * Check all active portfolios and auto-rebalance those exceeding their
   * drift threshold. Called periodically by the cron scheduler.
   */
  async checkAndAutoRebalance(): Promise<void> {
    const platform = config.platformParty;

    try {
      const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);

      for (const portfolio of portfolios) {
        const { isActive, triggerMode, holdings, targets } = portfolio.payload;
        if (!isActive) continue;

        // Only auto-rebalance portfolios with DriftThreshold trigger mode
        const threshold = this.extractDriftThreshold(triggerMode);
        if (threshold === null) continue;

        const { maxDrift } = this.calculateDrift(holdings, targets);
        if (maxDrift >= threshold) {
          console.log(
            `[auto-rebalance] Portfolio ${portfolio.contractId} drift=${maxDrift.toFixed(2)}% >= threshold=${threshold}% — triggering rebalance`,
          );
          const result = await this.executeRebalance(portfolio.contractId);
          if (result.success) {
            console.log(
              `[auto-rebalance] Completed: drift ${result.driftBefore.toFixed(2)}% → ${result.driftAfter.toFixed(2)}%`,
            );
          } else {
            console.error(`[auto-rebalance] Failed: ${result.error}`);
          }
        }
      }
    } catch (err) {
      console.error('[auto-rebalance] Error scanning portfolios:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Compute updated holdings after executing swap legs.
   * Adjusts amounts based on what was sold/bought and re-prices in CC terms.
   */
  private async computeUpdatedHoldings(
    currentHoldings: Holding[],
    executedLegs: SwapLeg[],
  ): Promise<Holding[]> {
    const prices = await cantex.getPrices();
    const ccPrice = prices.CC ?? 0.15;

    // Clone holdings into a mutable map
    const holdingMap = new Map<string, Holding>();
    for (const h of currentHoldings) {
      holdingMap.set(h.asset.symbol, { ...h });
    }

    // Apply each leg
    for (const leg of executedLegs) {
      // Decrease from-asset
      const from = holdingMap.get(leg.fromAsset.symbol);
      if (from) {
        from.amount = Math.max(0, from.amount - leg.fromAmount);
      }

      // Increase to-asset (create if not exists)
      let to = holdingMap.get(leg.toAsset.symbol);
      if (!to) {
        to = { asset: leg.toAsset, amount: 0, valueCc: 0 };
        holdingMap.set(leg.toAsset.symbol, to);
      }
      to.amount += leg.toAmount;
    }

    // Re-price all holdings in CC terms
    const result: Holding[] = [];
    for (const holding of holdingMap.values()) {
      const priceUsd = prices[holding.asset.symbol] ?? 0;
      holding.valueCc = (holding.amount * priceUsd) / ccPrice;
      result.push(holding);
    }

    return result;
  }

  /**
   * Extract drift threshold from the Daml TriggerMode variant encoding.
   * Returns null for Manual mode.
   */
  private extractDriftThreshold(triggerMode: Record<string, unknown>): number | null {
    // Daml JSON API encodes variants as { tag: "DriftThreshold", value: "5.0" }
    if (triggerMode.tag === 'DriftThreshold') {
      return Number(triggerMode.value);
    }
    return null;
  }
}

/** Singleton instance */
export const rebalanceEngine = new RebalanceEngine();
