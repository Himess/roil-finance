import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';
import { smartRouter } from '../services/smart-router.js';
import { featuredApp } from './featured-app.js';
import { rewardsEngine } from './rewards.js';
import { logger } from '../monitoring/logger.js';
import {
  decimalToNumber,
  numberToDecimal,
  decimalMul,
} from '../utils/decimal.js';
import { checkFeeBudget } from './rebalance.js';

/** Platform fee rate applied to each swap output (e.g. 0.001 = 0.1%) */
const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.001');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DCASchedulePayload {
  platform: string;
  user: string;
  sourceAsset: { symbol: string; admin: string };
  targetAsset: { symbol: string; admin: string };
  amountPerBuy: string; // Daml Decimal comes as string
  frequency: string | { tag: string }; // Daml variant
  totalExecutions: number;
  isActive: boolean;
  createdAt: string;
}

export interface DCALogPayload {
  platform: string;
  user: string;
  sourceAsset: { symbol: string; admin: string };
  targetAsset: { symbol: string; admin: string };
  sourceAmount: string;
  targetAmount: string;
  executionNumber: number;
  timestamp: string;
}

export interface ScheduleStatus {
  scheduleId: string;
  sourceAsset: string;
  targetAsset: string;
  amountPerBuy: number;
  frequency: string;
  totalExecutions: number;
  isActive: boolean;
  nextExecution: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Frequency helpers
// ---------------------------------------------------------------------------

/** Parse a Daml DCAFrequency variant into a human-readable string */
export function parseFrequency(freq: string | { tag: string }): string {
  if (typeof freq === 'string') return freq;
  return freq.tag ?? 'Unknown';
}

/** Get the interval in milliseconds for a DCA frequency */
export function frequencyToMs(freq: string): number {
  switch (freq) {
    case 'Hourly':
      return 60 * 60 * 1000;
    case 'Daily':
      return 24 * 60 * 60 * 1000;
    case 'Weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'Monthly':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000; // fallback to daily
  }
}

/**
 * Determine if a DCA schedule is due for execution.
 *
 * Logic:
 * - Find the most recent DCA log for this user + asset pair
 * - If no log exists, check if enough time passed since creation
 * - If a log exists, check if enough time passed since last execution
 */
export function isDue(schedule: DCASchedulePayload, lastExecution: string | null): boolean {
  const now = Date.now();
  const freq = parseFrequency(schedule.frequency);
  const interval = frequencyToMs(freq);

  if (lastExecution) {
    const lastTs = new Date(lastExecution).getTime();
    return now - lastTs >= interval;
  }

  // No prior execution — check against creation time
  const createdTs = new Date(schedule.createdAt).getTime();
  return now - createdTs >= interval;
}

/**
 * Compute the approximate next execution timestamp based on last execution
 * and frequency.
 */
export function computeNextExecution(freq: string, lastExecution: string | null, createdAt: string): string | null {
  const base = lastExecution ?? createdAt;
  const baseTs = new Date(base).getTime();
  if (isNaN(baseTs)) return null;
  const interval = frequencyToMs(freq);
  return new Date(baseTs + interval).toISOString();
}

// ---------------------------------------------------------------------------
// Last-execution cache (avoids querying ALL DCALog contracts every cycle)
// ---------------------------------------------------------------------------

/**
 * In-memory cache mapping a schedule key (user + source + target) to the
 * timestamp (ms) of the most recent execution. Populated on first query
 * and updated after each successful DCA execution.
 */
const lastExecutionCache = new Map<string, number>();

function scheduleKey(user: string, source: string, target: string): string {
  return `${user}:${source}:${target}`;
}

// ---------------------------------------------------------------------------
// In-memory execution lock
// ---------------------------------------------------------------------------

/**
 * Tracks schedule IDs that are currently being executed, preventing the same
 * schedule from being processed concurrently by overlapping cron ticks or
 * trigger events within the same process.
 *
 * Value is the timestamp (ms) when the lock was acquired. Locks automatically
 * expire after LOCK_TTL_MS to prevent stale locks from permanently blocking
 * a schedule (e.g. if the process crashes mid-execution).
 *
 * NOTE: This only protects against same-process duplicates. For multi-instance
 * deployment (horizontal scaling), use a distributed lock (e.g. Redis SETNX
 * with TTL) keyed by schedule contract ID.
 */
const executingSchedules = new Map<string, number>();

/** Lock TTL: 5 minutes. If a lock is older than this, it is considered stale. */
const LOCK_TTL_MS = 300_000;

// ---------------------------------------------------------------------------
// DCAEngine
// ---------------------------------------------------------------------------

/**
 * Engine for executing Dollar Cost Averaging schedules.
 *
 * Called periodically (by cron) to check all active DCA schedules, determine
 * which are due, and execute swaps via Cantex.
 */
export class DCAEngine {
  // -----------------------------------------------------------------------
  // Cron entry point
  // -----------------------------------------------------------------------

  /**
   * Scan all active DCA schedules and execute any that are due.
   *
   * For each due schedule:
   * 1. Exercise `ExecuteDCA` on the DCASchedule contract (creates DCAExecution)
   * 2. Execute the swap via Cantex
   * 3. Exercise `CompleteDCAExecution` on the DCAExecution contract
   * 4. Record the TX in the reward tracker
   */
  async executeDueSchedules(): Promise<{ executed: number; failed: number }> {
    const platform = config.platformParty;
    let executed = 0;
    let failed = 0;

    try {
      // Fetch all DCA schedules
      const schedules = await ledger.query<DCASchedulePayload>(TEMPLATES.DCASchedule, platform);
      const activeSchedules = schedules.filter((s) => s.payload.isActive);

      if (activeSchedules.length === 0) {
        logger.info('No active schedules found', { component: 'dca' });
        return { executed: 0, failed: 0 };
      }

      // Fetch all DCA logs only if cache is cold (first run)
      if (lastExecutionCache.size === 0) {
        const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);
        for (const log of logs) {
          const key = scheduleKey(
            log.payload.user,
            log.payload.sourceAsset.symbol,
            log.payload.targetAsset.symbol,
          );
          const ts = new Date(log.payload.timestamp).getTime();
          const existing = lastExecutionCache.get(key) ?? 0;
          if (ts > existing) {
            lastExecutionCache.set(key, ts);
          }
        }
      }

      for (const schedule of activeSchedules) {
        const { payload } = schedule;

        // Skip if this schedule is already being executed (concurrent protection with TTL)
        const lockTime = executingSchedules.get(schedule.contractId);
        if (lockTime && Date.now() - lockTime < LOCK_TTL_MS) {
          logger.info(`Skipping schedule ${schedule.contractId} — already executing`, { component: 'dca' });
          continue;
        }

        // Use cache to determine last execution time
        const key = scheduleKey(payload.user, payload.sourceAsset.symbol, payload.targetAsset.symbol);
        const cachedTs = lastExecutionCache.get(key);
        const lastExecution = cachedTs ? new Date(cachedTs).toISOString() : null;

        if (!isDue(payload, lastExecution)) {
          continue;
        }

        logger.info(
          `Executing DCA: ${payload.sourceAsset.symbol} -> ${payload.targetAsset.symbol}, amount=${payload.amountPerBuy}, user=${payload.user}`,
          { component: 'dca' },
        );

        executingSchedules.set(schedule.contractId, Date.now());
        try {
          // 0. Fee budget check — ensure platform has enough CC for this DCA execution
          // Estimate: 1 swap + 2 ledger commands (ExecuteDCA + CompleteDCAExecution)
          const dcaCostEstimate = numberToDecimal(0.5 + 0.2); // 0.5 CC swap + 0.2 CC commands
          await checkFeeBudget(dcaCostEstimate, `DCA ${payload.sourceAsset.symbol}->${payload.targetAsset.symbol} for ${payload.user}`);

          // 1. Exercise ExecuteDCA
          const execResult = await ledger.exerciseAs<[string, string]>(
            TEMPLATES.DCASchedule,
            schedule.contractId,
            'ExecuteDCA',
            {},
            platform,
          );
          const [_newScheduleCid, executionCid] = execResult;

          // 2. Execute swap via Smart Router (DEX aggregator)
          // Keep amountPerBuy as string from Daml, convert only for the swap call
          const amountStr = payload.amountPerBuy;
          const amount = decimalToNumber(amountStr);
          const swap = await smartRouter.executeSwap(
            payload.sourceAsset.symbol,
            payload.targetAsset.symbol,
            amount,
          );

          logger.info(
            `[dca] Swap executed via ${swap.source}: ${payload.sourceAsset.symbol} -> ${payload.targetAsset.symbol}`,
            { ...swap },
          );

          // 2b. Deduct platform fee from swap output — keep as string for Daml
          const outputStr = numberToDecimal(swap.outputAmount);
          const feeRateStr = numberToDecimal(PLATFORM_FEE_RATE);
          const platformFeeStr = decimalMul(outputStr, feeRateStr);
          const platformFee = decimalToNumber(platformFeeStr);
          const netOutputAmount = swap.outputAmount - platformFee;
          const netOutputStr = numberToDecimal(netOutputAmount);
          logger.info(
            `[dca] Platform fee: ${platformFeeStr} ${payload.targetAsset.symbol} (${(PLATFORM_FEE_RATE * 100).toFixed(2)}% of ${outputStr})`,
          );

          // 3. Complete execution on ledger — use numberToDecimal for Daml Decimal precision
          await ledger.exerciseAs(
            TEMPLATES.DCAExecution,
            executionCid,
            'CompleteDCAExecution',
            {
              receivedAmount: netOutputStr,
              completedAt: new Date().toISOString(),
            },
            platform,
          );

          // Update the last-execution cache
          lastExecutionCache.set(key, Date.now());

          logger.info(
            `Completed via ${swap.source}: ${swap.inputAmount} ${payload.sourceAsset.symbol} -> ${netOutputStr} ${payload.targetAsset.symbol} (fee: ${platformFeeStr})`,
            { component: 'dca' },
          );

          // 4. Record Featured App activity for DCA execution
          try {
            await featuredApp.recordActivity(
              payload.user,
              'DCAExecution',
              `DCA: ${swap.inputAmount} ${payload.sourceAsset.symbol} -> ${numberToDecimal(swap.outputAmount)} ${payload.targetAsset.symbol}`,
            );
          } catch {
            // Best effort — don't fail the DCA for activity recording
          }

          // 5. Record transaction for reward tracking
          try {
            await rewardsEngine.recordTransaction(payload.user, amount);
          } catch (e) {
            logger.warn('Failed to record reward TX after DCA', { error: String(e) });
          }

          executed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Failed for user=${payload.user}: ${message}`, { component: 'dca' });
          failed++;
        } finally {
          executingSchedules.delete(schedule.contractId);
        }
      }
    } catch (err) {
      logger.error('Error scanning schedules', {
        component: 'dca',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { executed, failed };
  }

  // -----------------------------------------------------------------------
  // Schedule status query
  // -----------------------------------------------------------------------

  /**
   * Get detailed status for a single DCA schedule, including the computed
   * next execution time.
   */
  async getScheduleStatus(scheduleContractId: string): Promise<ScheduleStatus | null> {
    const platform = config.platformParty;

    const schedules = await ledger.query<DCASchedulePayload>(TEMPLATES.DCASchedule, platform);
    const schedule = schedules.find((s) => s.contractId === scheduleContractId);
    if (!schedule) return null;

    const { payload } = schedule;
    const freq = parseFrequency(payload.frequency);

    // Find last log
    const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);
    const relevantLogs = logs
      .filter(
        (l) =>
          l.payload.user === payload.user &&
          l.payload.sourceAsset.symbol === payload.sourceAsset.symbol &&
          l.payload.targetAsset.symbol === payload.targetAsset.symbol,
      )
      .sort((a, b) => new Date(b.payload.timestamp).getTime() - new Date(a.payload.timestamp).getTime());

    const lastExecution = relevantLogs.length > 0 ? relevantLogs[0].payload.timestamp : null;
    const nextExecution = payload.isActive
      ? computeNextExecution(freq, lastExecution, payload.createdAt)
      : null;

    return {
      scheduleId: schedule.contractId,
      sourceAsset: payload.sourceAsset.symbol,
      targetAsset: payload.targetAsset.symbol,
      amountPerBuy: decimalToNumber(payload.amountPerBuy),
      frequency: freq,
      totalExecutions: payload.totalExecutions,
      isActive: payload.isActive,
      nextExecution,
      createdAt: payload.createdAt,
    };
  }

  // -----------------------------------------------------------------------
  // Query helpers
  // -----------------------------------------------------------------------

  /**
   * List all DCA schedules for a given party.
   */
  async listSchedules(party: string): Promise<ScheduleStatus[]> {
    const platform = config.platformParty;
    const schedules = await ledger.query<DCASchedulePayload>(TEMPLATES.DCASchedule, platform);
    const userSchedules = schedules.filter((s) => s.payload.user === party);

    const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);

    return userSchedules.map((s) => {
      const { payload } = s;
      const freq = parseFrequency(payload.frequency);

      const relevantLogs = logs
        .filter(
          (l) =>
            l.payload.user === payload.user &&
            l.payload.sourceAsset.symbol === payload.sourceAsset.symbol &&
            l.payload.targetAsset.symbol === payload.targetAsset.symbol,
        )
        .sort((a, b) => new Date(b.payload.timestamp).getTime() - new Date(a.payload.timestamp).getTime());

      const lastExecution = relevantLogs.length > 0 ? relevantLogs[0].payload.timestamp : null;
      const nextExecution = payload.isActive
        ? computeNextExecution(freq, lastExecution, payload.createdAt)
        : null;

      return {
        scheduleId: s.contractId,
        sourceAsset: payload.sourceAsset.symbol,
        targetAsset: payload.targetAsset.symbol,
        amountPerBuy: decimalToNumber(payload.amountPerBuy),
        frequency: freq,
        totalExecutions: payload.totalExecutions,
        isActive: payload.isActive,
        nextExecution,
        createdAt: payload.createdAt,
      };
    });
  }

  /**
   * List execution history (DCA logs) for a given party.
   */
  async getExecutionHistory(party: string): Promise<DCALogPayload[]> {
    const platform = config.platformParty;
    const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);
    return logs
      .filter((l) => l.payload.user === party)
      .map((l) => l.payload)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}

// ---------------------------------------------------------------------------
// Trigger integration
// ---------------------------------------------------------------------------

/**
 * Handle a DCA schedule event from TriggerManager.
 * Instead of scanning all schedules, processes a single event-driven schedule.
 *
 * The TriggerManager detects new/changed DCASchedule contracts and routes
 * them here. This avoids the O(n) scan of all schedules on every cron tick.
 */
export async function handleDCAScheduleEvent(
  schedule: { contractId: string; payload: DCASchedulePayload },
): Promise<{ executed: boolean; error?: string }> {
  const { payload } = schedule;
  if (!payload.isActive) return { executed: false };

  const platform = config.platformParty;
  const key = scheduleKey(payload.user, payload.sourceAsset.symbol, payload.targetAsset.symbol);

  // Determine last execution time from cache or ledger
  let lastExecution: string | null = null;
  const cachedTs = lastExecutionCache.get(key);
  if (cachedTs) {
    lastExecution = new Date(cachedTs).toISOString();
  } else {
    // Cold cache — query ledger for this specific schedule's logs
    try {
      const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);
      const relevantLogs = logs
        .filter(
          l =>
            l.payload.user === payload.user &&
            l.payload.sourceAsset.symbol === payload.sourceAsset.symbol &&
            l.payload.targetAsset.symbol === payload.targetAsset.symbol,
        )
        .sort((a, b) => new Date(b.payload.timestamp).getTime() - new Date(a.payload.timestamp).getTime());

      if (relevantLogs.length > 0) {
        const ts = new Date(relevantLogs[0].payload.timestamp).getTime();
        lastExecutionCache.set(key, ts);
        lastExecution = relevantLogs[0].payload.timestamp;
      }
    } catch {
      // Proceed with null (will treat as never executed)
    }
  }

  if (!isDue(payload, lastExecution)) {
    return { executed: false };
  }

  // Concurrent execution guard (same-process only, with TTL)
  const lockTime = executingSchedules.get(schedule.contractId);
  if (lockTime && Date.now() - lockTime < LOCK_TTL_MS) {
    logger.info(`[dca] Skipping event-driven schedule ${schedule.contractId} — already executing`, { component: 'dca-trigger' });
    return { executed: false };
  }

  executingSchedules.set(schedule.contractId, Date.now());

  logger.info(
    `[dca] Event-driven execution: ${payload.sourceAsset.symbol} -> ${payload.targetAsset.symbol}, user=${payload.user}`,
    { component: 'dca-trigger' },
  );

  try {
    // Exercise ExecuteDCA
    const execResult = await ledger.exerciseAs<[string, string]>(
      TEMPLATES.DCASchedule,
      schedule.contractId,
      'ExecuteDCA',
      {},
      platform,
    );
    const [_newScheduleCid, executionCid] = execResult;

    // Execute swap
    const amount = decimalToNumber(payload.amountPerBuy);
    const swap = await smartRouter.executeSwap(
      payload.sourceAsset.symbol,
      payload.targetAsset.symbol,
      amount,
    );

    // Deduct platform fee
    const platformFee = swap.outputAmount * PLATFORM_FEE_RATE;
    const netOutputAmount = swap.outputAmount - platformFee;

    // Complete execution on ledger
    await ledger.exerciseAs(
      TEMPLATES.DCAExecution,
      executionCid,
      'CompleteDCAExecution',
      {
        receivedAmount: numberToDecimal(netOutputAmount),
        completedAt: new Date().toISOString(),
      },
      platform,
    );

    // Update cache with ledger offset tracking
    lastExecutionCache.set(key, Date.now());

    // Record activity and rewards (best effort)
    try {
      await featuredApp.recordActivity(
        payload.user,
        'DCAExecution',
        `DCA: ${swap.inputAmount} ${payload.sourceAsset.symbol} -> ${netOutputAmount.toFixed(6)} ${payload.targetAsset.symbol}`,
      );
    } catch {
      // Best effort
    }

    try {
      await rewardsEngine.recordTransaction(payload.user, amount);
    } catch {
      // Best effort
    }

    return { executed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[dca] Event-driven execution failed: ${message}`, {
      component: 'dca-trigger',
      user: payload.user,
    });
    return { executed: false, error: message };
  } finally {
    executingSchedules.delete(schedule.contractId);
  }
}

/**
 * Get the last execution timestamp for a schedule key (used by TriggerManager).
 */
export function getLastExecutionTimestamp(user: string, source: string, target: string): number | null {
  const key = scheduleKey(user, source, target);
  return lastExecutionCache.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Dependency Injection Support
// ---------------------------------------------------------------------------
// For testing and multi-instance deployment, engines can be instantiated with
// custom dependencies via DCAEngine constructor or a factory function.
// Currently module-level singletons are used for simplicity. Migration path:
// 1. Change module-level `ledger`/`cantex`/`config` references to this.deps.*
// 2. Update tests to inject mocks
// 3. Update index.ts to create engines with injected dependencies
// ---------------------------------------------------------------------------

/** Singleton instance */
export const dcaEngine = new DCAEngine();
