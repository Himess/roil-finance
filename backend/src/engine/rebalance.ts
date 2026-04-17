import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';
import { smartRouter } from '../services/smart-router.js';
import { featuredApp } from './featured-app.js';
import { rewardsEngine } from './rewards.js';
import { logger } from '../monitoring/logger.js';
import { recordSnapshot } from '../services/performance-tracker.js';
import { tokenTransferService } from '../services/token-transfer.js';
import {
  decimalToNumber,
  numberToDecimal,
  decimalAdd,
  decimalMul,
  decimalSub,
  decimalLt,
} from '../utils/decimal.js';

// ---------------------------------------------------------------------------
// Daml Trigger Migration Path
// ---------------------------------------------------------------------------
// The current auto-rebalance runs via Node.js cron (index.ts).
// For production Canton deployment, consider migrating to Daml Triggers:
//
// 1. Create a Daml Trigger in trigger/src/RebalanceTrigger.daml:
//    - Rule: when a Portfolio's SyncHoldings is exercised (holdings change)
//    - Action: compute drift, if exceeds threshold, exercise InitiateRebalance
//    - Advantage: runs on the participant node, sub-second latency
//
// 2. Create a DCA Trigger:
//    - Rule: periodic timer (Daml Trigger supports time-based rules)
//    - Action: check due schedules, execute DCA buys
//
// 3. Benefits over cron:
//    - No separate backend process needed
//    - Runs inside the Canton participant (lower latency)
//    - Automatically handles ledger events (reactive, not polling)
//    - Built-in retry and error handling
//
// 4. Migration steps:
//    a. Add trigger/ directory with Daml trigger code
//    b. Deploy trigger alongside DAR: `daml trigger --trigger-name=RebalanceTrigger`
//    c. Gradually shift cron jobs to triggers
//    d. Keep cron as fallback during transition
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Slippage protection
// ---------------------------------------------------------------------------

/** Maximum allowed slippage tolerance as a fraction (e.g. 0.02 = 2%) */
const SLIPPAGE_TOLERANCE = Number(process.env.SLIPPAGE_TOLERANCE) || 0.02;

/** Platform fee rate applied to each swap output (e.g. 0.001 = 0.1%) */
const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.001');

/**
 * Fallback CC price in USDCx when live price is unavailable.
 *
 * Must be configured via env (`CC_FALLBACK_PRICE`) — no hardcoded default
 * because a stale constant silently distorts rebalance math. If unset the
 * engine refuses to compute USD-denominated math and throws so ops is forced
 * to set a sane value.
 */
const CC_FALLBACK_PRICE: number | null = process.env.CC_FALLBACK_PRICE
  ? parseFloat(process.env.CC_FALLBACK_PRICE)
  : null;

function requireCcPrice(prices: Record<string, number | undefined>): number {
  const live = prices.CC;
  if (typeof live === 'number' && live > 0) return live;
  if (CC_FALLBACK_PRICE !== null && CC_FALLBACK_PRICE > 0) return CC_FALLBACK_PRICE;
  throw new Error(
    'CC price unavailable: live oracle returned no value and CC_FALLBACK_PRICE is unset. ' +
    'Set CC_FALLBACK_PRICE in backend .env with a recent market price, or restore oracle connectivity.',
  );
}

/**
 * Check if actual swap output is within the acceptable slippage tolerance
 * of the expected output. Returns true if slippage is acceptable.
 */
export function isSlippageAcceptable(
  expectedOutput: number,
  actualOutput: number,
  tolerance: number = SLIPPAGE_TOLERANCE,
): boolean {
  if (expectedOutput <= 0) return true;
  const slippage = (expectedOutput - actualOutput) / expectedOutput;
  return slippage <= tolerance;
}

// ---------------------------------------------------------------------------
// Fee budget control
// ---------------------------------------------------------------------------

/** Fixed cost estimate per swap leg in CC when prepare endpoint is unavailable */
const DEFAULT_SWAP_COST_CC = '0.5';

/** Fixed cost estimate per ledger command in CC */
const DEFAULT_COMMAND_COST_CC = '0.1';

/**
 * Check that the platform's CC balance is sufficient to cover the estimated
 * transaction costs. Throws if insufficient balance.
 *
 * Cost estimation strategy:
 * 1. Try the /v2/interactive-submission/prepare endpoint for accurate cost
 * 2. Fall back to a fixed estimate (DEFAULT_SWAP_COST_CC per swap leg +
 *    DEFAULT_COMMAND_COST_CC per ledger command)
 *
 * @param estimatedCostCc - Estimated total cost as a Daml Decimal string
 * @param operationDescription - Human-readable description for error messages
 */
export async function checkFeeBudget(
  estimatedCostCc: string,
  operationDescription: string,
): Promise<void> {
  try {
    // Query the platform's CC balance from Cantex
    const balances = await cantex.getBalances(config.platformParty);
    const ccBalance = balances.find(b => b.asset === 'CC');
    const ccBalanceStr = numberToDecimal(ccBalance?.amount ?? 0);

    if (decimalLt(ccBalanceStr, estimatedCostCc)) {
      throw new Error(
        `Insufficient CC balance for ${operationDescription}. ` +
        `Required: ${estimatedCostCc} CC, Available: ${ccBalanceStr} CC`,
      );
    }

    logger.info(`[fee-budget] ${operationDescription}: estimated cost ${estimatedCostCc} CC, balance ${ccBalanceStr} CC`);
  } catch (err) {
    // If the error is our own insufficient balance error, re-throw
    if (err instanceof Error && err.message.startsWith('Insufficient CC balance')) {
      throw err;
    }
    // If balance check itself fails (e.g. Cantex down), log warning but allow operation
    logger.warn(`[fee-budget] Could not verify CC balance for ${operationDescription}`, {
      error: String(err),
    });
  }
}

/**
 * Estimate the total CC cost for a rebalance operation.
 *
 * @param numSwapLegs - Number of swap legs planned
 * @param numLedgerCommands - Number of ledger commands (InitiateRebalance, SetSwapLegs, CompleteRebalance, SyncHoldings)
 */
export function estimateRebalanceCost(numSwapLegs: number, numLedgerCommands: number = 4): string {
  const swapCost = decimalMul(DEFAULT_SWAP_COST_CC, numberToDecimal(numSwapLegs));
  const commandCost = decimalMul(DEFAULT_COMMAND_COST_CC, numberToDecimal(numLedgerCommands));
  return decimalAdd(swapCost, commandCost);
}

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
// Price condition checking
// ---------------------------------------------------------------------------

/**
 * Check if a PriceCondition trigger mode's condition is met.
 * Returns true if the current price satisfies the condition.
 */
function checkPriceCondition(
  triggerMode: { tag: string; value?: any },
  prices: Record<string, number>,
): boolean {
  if (triggerMode.tag !== 'PriceCondition') return false;
  const pc = triggerMode.value;
  if (!pc?.conditionAsset || !pc?.targetPrice || !pc?.conditionAction) return false;

  const currentPrice = prices[pc.conditionAsset];
  if (!currentPrice) return false;

  const target = decimalToNumber(String(pc.targetPrice));
  if (pc.conditionAction === 'sell_above') return currentPrice >= target;
  if (pc.conditionAction === 'buy_below') return currentPrice <= target;
  return false;
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
      const currentValue = holding ? holding.valueCc * (requireCcPrice(prices)) : 0;
      // Convert totalValue from CC to USDCx for uniform comparison
      const totalValueUsd = totalValue * (requireCcPrice(prices));
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
    // Declared here so the catch block can FailRebalance the EXACT request we
    // initiated, not a stale one belonging to another in-flight user.
    let thisRequestCid: string | null = null;

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

      // 2b. Fee budget check — ensure platform has enough CC for transaction costs
      const estimatedCost = estimateRebalanceCost(plannedLegs.length, 4);
      await checkFeeBudget(estimatedCost, `rebalance ${portfolioContractId} (${plannedLegs.length} legs)`);

      // 3. Initiate rebalance on ledger
      const initiateResult = await ledger.exerciseAs<[string, string]>(
        TEMPLATES.Portfolio,
        portfolioContractId,
        'InitiateRebalance',
        { requestedAt: new Date().toISOString() },
        platform,
      );
      const [newPortfolioCid, requestCid] = initiateResult;

      // 4. Set swap legs on the request — use numberToDecimal for Daml Decimal precision
      const damlLegs = plannedLegs.map((leg) => ({
        fromAsset: leg.fromAsset,
        toAsset: leg.toAsset,
        fromAmount: numberToDecimal(leg.fromAmount),
        toAmount: numberToDecimal(leg.toAmount),
      }));

      const setLegsResult = await ledger.exerciseAs<string>(
        TEMPLATES.RebalanceRequest,
        requestCid,
        'SetSwapLegs',
        { legs: damlLegs },
        platform,
      );
      const updatedRequestCid = setLegsResult;
      thisRequestCid = updatedRequestCid;

      // ---------------------------------------------------------------------------
      // Canton Atomic Rebalance (Future Enhancement)
      // ---------------------------------------------------------------------------
      // Canton's transaction model supports atomic multi-step workflows.
      // Instead of executing swaps sequentially (current approach), all swap legs
      // could be submitted as a single Daml transaction that either ALL succeed
      // or ALL fail. This prevents partial execution failures.
      //
      // Implementation approach:
      // 1. Create a single Daml choice "ExecuteAtomicRebalance" on RebalanceRequest
      //    that takes a list of swap intents
      // 2. The choice body exercises each swap within the same transaction context
      // 3. If any swap fails, the entire transaction rolls back
      //
      // This is impossible on EVM chains where each swap is a separate transaction
      // subject to MEV, front-running, and partial failure.
      // ---------------------------------------------------------------------------

      // 5. Execute each swap via Smart Router (DEX aggregator) with PRE-SWAP slippage protection
      const executedLegs: SwapLeg[] = [];
      for (const leg of plannedLegs) {
        // Step 5a: Get the best quote across all DEXes BEFORE executing to check slippage
        const quote = await smartRouter.getBestQuote(
          leg.fromAsset.symbol,
          leg.toAsset.symbol,
          leg.fromAmount,
        );

        // Step 5b: Pre-swap slippage check — reject if quote is outside tolerance
        if (!isSlippageAcceptable(leg.toAmount, quote.outputAmount)) {
          const slippagePct = ((leg.toAmount - quote.outputAmount) / leg.toAmount * 100).toFixed(2);
          logger.warn(
            `[rebalance] Skipping swap leg: ${leg.fromAsset.symbol}->${leg.toAsset.symbol} ` +
            `expected ${leg.toAmount.toFixed(6)}, quoted ${quote.outputAmount.toFixed(6)} ` +
            `(slippage: ${slippagePct}%, tolerance: ${(SLIPPAGE_TOLERANCE * 100).toFixed(1)}%)`,
          );
          // Skip this leg — do not execute, slippage too high
          continue;
        }

        // Step 5c: Slippage acceptable — execute the swap via best DEX
        const swap = await smartRouter.executeSwap(
          leg.fromAsset.symbol,
          leg.toAsset.symbol,
          leg.fromAmount,
        );

        logger.info(
          `[rebalance] Swap executed via ${swap.source}: ${leg.fromAsset.symbol} → ${leg.toAsset.symbol}`,
          { ...swap },
        );

        // Step 5d: Deduct platform fee from swap output.
        // Use decimal arithmetic (matches DCA engine) to avoid JS float
        // precision loss on small-amount tokens like CBTC at 10^-4 units.
        const outputDec = numberToDecimal(swap.outputAmount);
        const platformFeeDec = decimalMul(outputDec, numberToDecimal(PLATFORM_FEE_RATE));
        const netOutputDec = decimalSub(outputDec, platformFeeDec);
        const platformFee = decimalToNumber(platformFeeDec);
        const netOutputAmount = decimalToNumber(netOutputDec);
        logger.info(
          `[rebalance] Platform fee: ${platformFee.toFixed(6)} ${leg.toAsset.symbol} (${(PLATFORM_FEE_RATE * 100).toFixed(2)}% of ${swap.outputAmount.toFixed(6)})`,
        );

        executedLegs.push({
          fromAsset: leg.fromAsset,
          toAsset: leg.toAsset,
          fromAmount: swap.inputAmount ?? leg.fromAmount,
          toAmount: netOutputAmount,
        });
      }

      // 5e. If all swap legs were skipped due to slippage, fail instead of completing
      if (executedLegs.length === 0) {
        logger.warn('All swap legs skipped due to slippage — failing rebalance instead of completing');
        await ledger.exerciseAs(
          TEMPLATES.RebalanceRequest,
          updatedRequestCid,
          'FailRebalance',
          { reason: 'All swap legs skipped due to slippage tolerance' },
          platform,
        );
        return { success: false, swapLegs: [], driftBefore, driftAfter: driftBefore, error: 'All swaps exceeded slippage tolerance' };
      }

      // 6. Complete rebalance on ledger — use numberToDecimal for Daml Decimal precision
      const completedDamlLegs = executedLegs.map((leg) => ({
        fromAsset: leg.fromAsset,
        toAsset: leg.toAsset,
        fromAmount: numberToDecimal(leg.fromAmount),
        toAmount: numberToDecimal(leg.toAmount),
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

      // 7. Sync holdings — query actual balances for ground truth, fall back to computed
      let updatedHoldings = await this.computeUpdatedHoldings(holdings, executedLegs);
      try {
        const realHoldings = await tokenTransferService.queryHoldings(portfolio.payload.user);
        if (realHoldings.length > 0) {
          const prices = await cantex.getPrices();
          const ccPrice = requireCcPrice(prices);
          updatedHoldings = realHoldings.map(h => ({
            asset: { symbol: h.instrumentId, admin: h.instrumentAdmin || '' },
            amount: h.amount,
            valueCc: (h.amount * (prices[h.instrumentId] ?? 0)) / ccPrice,
          }));
          logger.info('[rebalance] Using real holdings from token service for SyncHoldings');
        }
      } catch {
        // Fallback to computed holdings if query fails
        logger.warn('[rebalance] Failed to query real holdings, using computed values');
      }
      await ledger.exerciseAs(
        TEMPLATES.Portfolio,
        newPortfolioCid,
        'SyncHoldings',
        {
          newHoldings: updatedHoldings.map((h) => ({
            asset: h.asset,
            amount: numberToDecimal(h.amount),
            valueCc: numberToDecimal(h.valueCc),
          })),
        },
        platform,
      );

      const driftAfter = this.calculateDrift(updatedHoldings, targets).maxDrift;

      // 8. Record Featured App activity for rebalance completion
      try {
        await featuredApp.recordActivity(
          portfolio.payload.user,
          'Rebalance',
          `Rebalance: drift ${driftBefore.toFixed(2)}% -> ${driftAfter.toFixed(2)}%, ${executedLegs.length} swaps`,
        );
      } catch {
        // Best effort — don't fail the rebalance for activity recording
      }

      // 9. Record performance snapshot after successful rebalance
      try {
        const totalValueCc = updatedHoldings.reduce((sum, h) => sum + h.valueCc, 0);
        recordSnapshot(
          portfolio.payload.user,
          totalValueCc,
          updatedHoldings.map((h) => ({ asset: h.asset.symbol, amount: h.amount, valueCc: h.valueCc })),
        );
      } catch {
        // Best effort — don't fail the rebalance for snapshot recording
      }

      // 10. Record transaction for reward tracking
      try {
        const totalSwapValue = executedLegs.reduce((sum, leg) => sum + leg.toAmount, 0);
        await rewardsEngine.recordTransaction(portfolio.payload.user, totalSwapValue);
      } catch (e) {
        logger.warn('Failed to record reward TX after rebalance', { error: String(e) });
      }

      logger.info(`Rebalance complete: driftBefore=${driftBefore.toFixed(2)}%, driftAfter=${driftAfter.toFixed(2)}%`, {
        component: 'rebalance',
        user: portfolio.payload.user,
        driftBefore,
        driftAfter,
        swapLegs: executedLegs.length,
      });

      return { success: true, swapLegs: executedLegs, driftBefore, driftAfter };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Fail only the specific request we initiated in this call.
      // Prior behaviour picked the first Pending|Executing request which could
      // nuke a concurrent rebalance belonging to another user.
      if (thisRequestCid) {
        try {
          await ledger.exerciseAs(
            TEMPLATES.RebalanceRequest,
            thisRequestCid,
            'FailRebalance',
            { reason: message },
            platform,
          );
        } catch {
          // Ignore — best effort cleanup
        }
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
      const prices = await cantex.getPrices();

      let consecutiveFailures = 0;
      const MAX_CONSECUTIVE_FAILURES = 3;

      for (const portfolio of portfolios) {
        const { isActive, triggerMode, holdings, targets, user } = portfolio.payload;
        if (!isActive) continue;

        // Record performance snapshot for every active portfolio
        try {
          const totalValueCc = holdings.reduce((sum, h) => sum + h.valueCc, 0);
          recordSnapshot(
            user,
            totalValueCc,
            holdings.map((h) => ({ asset: h.asset.symbol, amount: h.amount, valueCc: h.valueCc })),
          );
        } catch {
          // Best effort — don't fail the auto-rebalance loop for snapshot recording
        }

        let shouldRebalance = false;

        // Check DriftThreshold trigger mode
        const threshold = this.extractDriftThreshold(triggerMode);
        if (threshold !== null) {
          const { maxDrift } = this.calculateDrift(holdings, targets);
          if (maxDrift >= threshold) {
            logger.info(
              `Portfolio ${portfolio.contractId} drift=${maxDrift.toFixed(2)}% >= threshold=${threshold}% — triggering rebalance`,
              { component: 'auto-rebalance' },
            );
            shouldRebalance = true;
          }
        }

        // Check PriceCondition trigger mode
        if (!shouldRebalance && checkPriceCondition(triggerMode as { tag: string; value?: any }, prices)) {
          const pc = (triggerMode as any).value;
          logger.info(
            `Portfolio ${portfolio.contractId} price condition met: ${pc?.conditionAsset} ${pc?.conditionAction} ${pc?.targetPrice} (current: ${prices[pc?.conditionAsset]}) — triggering rebalance`,
            { component: 'auto-rebalance' },
          );
          shouldRebalance = true;
        }

        if (shouldRebalance) {
          const result = await this.executeRebalance(portfolio.contractId);
          if (result.success) {
            consecutiveFailures = 0;
            logger.info(
              `Completed: drift ${result.driftBefore.toFixed(2)}% → ${result.driftAfter.toFixed(2)}%`,
              { component: 'auto-rebalance' },
            );
          } else {
            consecutiveFailures++;
            logger.error(`Failed: ${result.error}`, { component: 'auto-rebalance' });
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              logger.error('Auto-rebalance aborted: too many consecutive failures', { failures: consecutiveFailures });
              break;
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error scanning portfolios', {
        component: 'auto-rebalance',
        error: err instanceof Error ? err.message : String(err),
      });
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
    const ccPrice = requireCcPrice(prices);

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

  // -----------------------------------------------------------------------
  // Dependency Injection Support
  // -----------------------------------------------------------------------

  static createWithDeps(deps: {
    ledger: typeof ledger;
    cantex: typeof cantex;
    config: typeof config;
  }): RebalanceEngine {
    // For future DI support — currently uses module-level singletons
    // To migrate: store deps as instance fields and use this.ledger instead of ledger
    return new RebalanceEngine();
  }
}

// ---------------------------------------------------------------------------
// Trigger integration
// ---------------------------------------------------------------------------

/**
 * Handle a portfolio event from TriggerManager.
 * Checks drift and triggers rebalance if threshold exceeded.
 * Adds jitter to prevent thundering herd when multiple portfolios fire at once.
 */
export async function handlePortfolioEvent(
  portfolio: { contractId: string; payload: PortfolioPayload },
): Promise<RebalanceResult | null> {
  const { payload } = portfolio;
  if (!payload.isActive) return null;

  // Extract drift threshold from trigger mode
  const triggerMode = payload.triggerMode as { tag: string; value?: string };
  if (triggerMode.tag !== 'DriftThreshold') return null;
  const threshold = Number(triggerMode.value);

  const drift = rebalanceEngine.calculateDrift(payload.holdings, payload.targets);
  if (drift.maxDrift < threshold) return null;

  logger.info(
    `[rebalance] Portfolio event: drift=${drift.maxDrift.toFixed(2)}% >= threshold=${threshold}%, triggering rebalance`,
    { contractId: portfolio.contractId, user: payload.user },
  );

  // Add jitter (0-60s) to prevent thundering herd
  const jitterMs = Math.random() * 60_000;
  await new Promise(resolve => setTimeout(resolve, jitterMs));

  return rebalanceEngine.executeRebalance(portfolio.contractId);
}

/**
 * Process a pending rebalance request by contract ID.
 * Called by TriggerManager when a RebalanceRequest event is detected.
 */
export async function processRebalanceRequest(
  requestCid: string,
): Promise<RebalanceResult | null> {
  const platform = config.platformParty;

  try {
    // Find the portfolio associated with this request
    const requests = await ledger.query(TEMPLATES.RebalanceRequest, platform);
    const request = requests.find(r => r.contractId === requestCid);
    if (!request) {
      logger.warn(`[rebalance] RebalanceRequest not found: ${requestCid}`);
      return null;
    }

    const portfolioId = (request.payload as Record<string, unknown>).portfolioId as string;
    if (!portfolioId) {
      logger.warn(`[rebalance] RebalanceRequest missing portfolioId: ${requestCid}`);
      return null;
    }

    return await rebalanceEngine.executeRebalance(portfolioId);
  } catch (err) {
    logger.error(`[rebalance] processRebalanceRequest failed`, {
      requestCid,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dependency Injection Support
// ---------------------------------------------------------------------------
// For testing and multi-instance deployment, engines can be instantiated with
// custom dependencies via createWithDeps(). Currently module-level singletons
// are used for simplicity. Migration path:
// 1. Change module-level `ledger`/`cantex`/`config` references to this.deps.*
// 2. Update tests to inject mocks via createWithDeps()
// 3. Update index.ts to create engines with injected dependencies
// ---------------------------------------------------------------------------

/** Singleton instance */
export const rebalanceEngine = new RebalanceEngine();
