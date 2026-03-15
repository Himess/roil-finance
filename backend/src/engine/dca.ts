import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';

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
function parseFrequency(freq: string | { tag: string }): string {
  if (typeof freq === 'string') return freq;
  return freq.tag ?? 'Unknown';
}

/** Get the interval in milliseconds for a DCA frequency */
function frequencyToMs(freq: string): number {
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
function isDue(schedule: DCASchedulePayload, lastExecution: string | null): boolean {
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
function computeNextExecution(freq: string, lastExecution: string | null, createdAt: string): string | null {
  const base = lastExecution ?? createdAt;
  const baseTs = new Date(base).getTime();
  if (isNaN(baseTs)) return null;
  const interval = frequencyToMs(freq);
  return new Date(baseTs + interval).toISOString();
}

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
        console.log('[dca] No active schedules found');
        return { executed: 0, failed: 0 };
      }

      // Fetch all DCA logs to determine last execution times
      const logs = await ledger.query<DCALogPayload>(TEMPLATES.DCALog, platform);

      for (const schedule of activeSchedules) {
        const { payload } = schedule;

        // Find most recent log for this schedule's user + asset pair
        const relevantLogs = logs
          .filter(
            (l) =>
              l.payload.user === payload.user &&
              l.payload.sourceAsset.symbol === payload.sourceAsset.symbol &&
              l.payload.targetAsset.symbol === payload.targetAsset.symbol,
          )
          .sort((a, b) => new Date(b.payload.timestamp).getTime() - new Date(a.payload.timestamp).getTime());

        const lastExecution = relevantLogs.length > 0 ? relevantLogs[0].payload.timestamp : null;

        if (!isDue(payload, lastExecution)) {
          continue;
        }

        console.log(
          `[dca] Executing DCA: ${payload.sourceAsset.symbol} → ${payload.targetAsset.symbol}, ` +
            `amount=${payload.amountPerBuy}, user=${payload.user}`,
        );

        try {
          // 1. Exercise ExecuteDCA
          const execResult = await ledger.exerciseAs<[string, string]>(
            TEMPLATES.DCASchedule,
            schedule.contractId,
            'ExecuteDCA',
            {},
            platform,
          );
          const [_newScheduleCid, executionCid] = execResult;

          // 2. Execute swap via Cantex
          const amount = Number(payload.amountPerBuy);
          const swap = await cantex.executeSwap(
            payload.sourceAsset.symbol,
            payload.targetAsset.symbol,
            amount,
          );

          // 3. Complete execution on ledger
          await ledger.exerciseAs(
            TEMPLATES.DCAExecution,
            executionCid,
            'CompleteDCAExecution',
            {
              receivedAmount: String(swap.outputAmount),
              completedAt: new Date().toISOString(),
            },
            platform,
          );

          console.log(
            `[dca] Completed: ${swap.inputAmount} ${payload.sourceAsset.symbol} → ` +
              `${swap.outputAmount.toFixed(6)} ${payload.targetAsset.symbol}`,
          );

          executed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[dca] Failed for user=${payload.user}: ${message}`);
          failed++;
        }
      }
    } catch (err) {
      console.error('[dca] Error scanning schedules:', err);
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
      amountPerBuy: Number(payload.amountPerBuy),
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
        amountPerBuy: Number(payload.amountPerBuy),
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

/** Singleton instance */
export const dcaEngine = new DCAEngine();
