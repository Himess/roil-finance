import { config, TEMPLATES } from '../config.js';
import { ledger, type DamlContract } from '../ledger.js';
import { logger } from '../monitoring/logger.js';
import { metrics, METRICS } from '../monitoring/metrics.js';
import { rebalanceEngine, type PortfolioPayload } from './rebalance.js';
import { dcaEngine, type DCASchedulePayload } from './dca.js';
import { compoundEngine } from './compound.js';
import { rewardsEngine } from './rewards.js';
import { featuredApp } from './featured-app.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerEvent =
  | { type: 'portfolio-created'; contractId: string; payload: PortfolioPayload }
  | { type: 'portfolio-updated'; contractId: string; payload: PortfolioPayload }
  | { type: 'dca-schedule-created'; contractId: string; payload: DCASchedulePayload }
  | { type: 'rebalance-request'; contractId: string; payload: Record<string, unknown> }
  | { type: 'compound-config-updated'; contractId: string; payload: Record<string, unknown> };

export interface TriggerManagerConfig {
  /** Poll interval in ms (default 30000 = 30s) */
  pollIntervalMs: number;
  /** Whether to run initial full scan on startup (default true) */
  initialScan: boolean;
  /** Max jitter delay in ms to prevent thundering herd (default 60000 = 60s) */
  maxJitterMs: number;
  /** Enable cron fallback if trigger mode fails (default true) */
  cronFallback: boolean;
  /** Number of consecutive failures before circuit breaker trips (default 5) */
  circuitBreakerThreshold: number;
}

interface TrackedPortfolio {
  contractId: string;
  user: string;
  lastCheckedAt: number;
}

interface TrackedDCASchedule {
  contractId: string;
  user: string;
  sourceAsset: string;
  targetAsset: string;
  lastExecutedAt: number;
}

type TriggerManagerState = 'stopped' | 'starting' | 'running' | 'degraded';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TriggerManagerConfig = {
  pollIntervalMs: 30_000,
  initialScan: true,
  maxJitterMs: 60_000,
  cronFallback: true,
  circuitBreakerThreshold: 5,
};

// ---------------------------------------------------------------------------
// TriggerManager — ledger-event-driven replacement for cron
// ---------------------------------------------------------------------------

/**
 * Replaces blind cron polling with a ledger-event-driven system.
 *
 * Architecture:
 * 1. On startup, performs a full scan of all active contracts to build state
 * 2. Switches to incremental polling of active contracts with offset tracking
 * 3. Routes contract events to appropriate handlers (rebalance, DCA, compound)
 * 4. Maintains circuit breaker — falls back to cron-style polling on failure
 *
 * Benefits over cron:
 * - Reacts to ledger events (new portfolio, drift change) within seconds
 * - Only processes contracts that have actually changed
 * - Jitter prevents thundering herd when many portfolios trigger simultaneously
 * - Circuit breaker degrades gracefully to cron fallback on persistent errors
 */
export class TriggerManager {
  private config: TriggerManagerConfig;
  private state: TriggerManagerState = 'stopped';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastOffset: string = '';

  // Tracked state
  private portfolios = new Map<string, TrackedPortfolio>();
  private dcaSchedules = new Map<string, TrackedDCASchedule>();

  // Circuit breaker
  private consecutiveFailures = 0;
  private lastSuccessfulPoll = 0;

  // Metrics
  private eventCounts = {
    portfolioChecks: 0,
    dcaExecutions: 0,
    rebalanceTriggers: 0,
    compoundTriggers: 0,
    errors: 0,
  };

  // Pending featured-app activity markers that failed and need retry
  private pendingActivityMarkers: Array<{
    user: string;
    activityType: 'Rebalance' | 'DCAExecution' | 'CompoundExecution' | 'RewardDistribution';
    description: string;
    retryCount: number;
    maxRetries: number;
  }> = [];

  constructor(cfg?: Partial<TriggerManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the trigger manager.
   *
   * 1. Performs initial full scan of all active contracts
   * 2. Starts incremental polling loop
   */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      logger.warn('[trigger-manager] Already running, ignoring start()');
      return;
    }

    this.state = 'starting';
    logger.info('[trigger-manager] Starting trigger manager', {
      pollIntervalMs: this.config.pollIntervalMs,
      initialScan: this.config.initialScan,
      cronFallback: this.config.cronFallback,
    });

    // Initial full scan
    if (this.config.initialScan) {
      try {
        await this.fullScan();
        logger.info('[trigger-manager] Initial scan complete', {
          portfolios: this.portfolios.size,
          dcaSchedules: this.dcaSchedules.size,
        });
      } catch (err) {
        logger.error('[trigger-manager] Initial scan failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!this.config.cronFallback) {
          this.state = 'stopped';
          throw err;
        }
        this.state = 'degraded';
        logger.warn('[trigger-manager] Running in degraded mode (cron fallback active)');
      }
    }

    // Start polling loop
    this.pollTimer = setInterval(() => {
      this.poll().catch(err => {
        logger.error('[trigger-manager] Poll error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.pollIntervalMs);

    if (this.state !== 'degraded') {
      this.state = 'running';
    }

    logger.info('[trigger-manager] Started', { state: this.state });
  }

  /**
   * Stop the trigger manager gracefully.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.state = 'stopped';
    logger.info('[trigger-manager] Stopped', {
      eventCounts: this.eventCounts,
    });
  }

  /**
   * Get current state and metrics.
   */
  getStatus(): {
    state: TriggerManagerState;
    lastOffset: string;
    portfolioCount: number;
    dcaScheduleCount: number;
    consecutiveFailures: number;
    eventCounts: {
      portfolioChecks: number;
      dcaExecutions: number;
      rebalanceTriggers: number;
      compoundTriggers: number;
      errors: number;
    };
    pendingRetries: number;
  } {
    return {
      state: this.state,
      lastOffset: this.lastOffset,
      portfolioCount: this.portfolios.size,
      dcaScheduleCount: this.dcaSchedules.size,
      consecutiveFailures: this.consecutiveFailures,
      eventCounts: { ...this.eventCounts },
      pendingRetries: this.pendingActivityMarkers.length,
    };
  }

  // -----------------------------------------------------------------------
  // Initial full scan
  // -----------------------------------------------------------------------

  /**
   * Scan all active contracts on startup to build initial state.
   * This ensures we don't miss any contracts that were created before
   * the trigger manager started.
   */
  private async fullScan(): Promise<void> {
    const platform = config.platformParty;

    // Scan portfolios
    const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);
    for (const p of portfolios) {
      if (p.payload.isActive) {
        this.portfolios.set(p.contractId, {
          contractId: p.contractId,
          user: p.payload.user,
          lastCheckedAt: Date.now(),
        });
      }
    }

    // Scan DCA schedules
    const schedules = await ledger.query<DCASchedulePayload>(TEMPLATES.DCASchedule, platform);
    for (const s of schedules) {
      if (s.payload.isActive) {
        this.dcaSchedules.set(s.contractId, {
          contractId: s.contractId,
          user: s.payload.user,
          sourceAsset: s.payload.sourceAsset.symbol,
          targetAsset: s.payload.targetAsset.symbol,
          lastExecutedAt: 0,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Incremental poll
  // -----------------------------------------------------------------------

  /**
   * Main poll cycle. Queries active contracts and routes events to handlers.
   *
   * Unlike cron which blindly runs on a timer, this:
   * - Only queries contracts that are known to be active
   * - Checks for new/removed contracts each cycle
   * - Applies jitter to stagger handler execution
   */
  private async poll(): Promise<void> {
    const startTime = Date.now();

    try {
      const platform = config.platformParty;

      // Refresh active contract lists
      await this.refreshContractState(platform);

      // Process portfolios (drift check + auto-rebalance)
      await this.processPortfolios(platform);

      // Process DCA schedules
      await this.processDCASchedules(platform);

      // Process pending rebalance requests
      await this.processPendingRebalanceRequests(platform);

      // Retry failed activity markers
      await this.retryPendingActivityMarkers();

      // Success — reset circuit breaker
      this.consecutiveFailures = 0;
      this.lastSuccessfulPoll = Date.now();

      if (this.state === 'degraded') {
        this.state = 'running';
        logger.info('[trigger-manager] Recovered from degraded state');
      }

      const elapsed = Date.now() - startTime;
      logger.debug('[trigger-manager] Poll complete', {
        elapsed: `${elapsed}ms`,
        portfolios: this.portfolios.size,
        dcaSchedules: this.dcaSchedules.size,
      });
    } catch (err) {
      this.consecutiveFailures++;
      this.eventCounts.errors++;

      logger.error('[trigger-manager] Poll failed', {
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures: this.consecutiveFailures,
      });

      // Circuit breaker
      if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        if (this.state !== 'degraded') {
          this.state = 'degraded';
          logger.error(
            '[trigger-manager] Circuit breaker tripped — switching to degraded mode',
            { threshold: this.config.circuitBreakerThreshold },
          );
        }

        // In degraded mode, fall back to cron-style full scan
        if (this.config.cronFallback) {
          await this.cronFallbackCycle();
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Contract state refresh
  // -----------------------------------------------------------------------

  /**
   * Refresh the set of active contracts by querying the ledger.
   * Detects new portfolios, removed portfolios, new DCA schedules, etc.
   */
  private async refreshContractState(platform: string): Promise<void> {
    // Refresh portfolios
    const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);
    const activePortfolioIds = new Set<string>();

    for (const p of portfolios) {
      if (!p.payload.isActive) continue;
      activePortfolioIds.add(p.contractId);

      if (!this.portfolios.has(p.contractId)) {
        // New portfolio detected
        this.portfolios.set(p.contractId, {
          contractId: p.contractId,
          user: p.payload.user,
          lastCheckedAt: 0, // Force immediate check
        });
        logger.info('[trigger-manager] New portfolio detected', {
          contractId: p.contractId,
          user: p.payload.user,
        });
        // Fire event handler for new portfolio
        await this.onNewPortfolio(p);
      }
    }

    // Remove stale portfolio references
    for (const [cid] of this.portfolios) {
      if (!activePortfolioIds.has(cid)) {
        this.portfolios.delete(cid);
      }
    }

    // Refresh DCA schedules
    const schedules = await ledger.query<DCASchedulePayload>(TEMPLATES.DCASchedule, platform);
    const activeScheduleIds = new Set<string>();

    for (const s of schedules) {
      if (!s.payload.isActive) continue;
      activeScheduleIds.add(s.contractId);

      if (!this.dcaSchedules.has(s.contractId)) {
        // New DCA schedule detected
        this.dcaSchedules.set(s.contractId, {
          contractId: s.contractId,
          user: s.payload.user,
          sourceAsset: s.payload.sourceAsset.symbol,
          targetAsset: s.payload.targetAsset.symbol,
          lastExecutedAt: 0,
        });
        logger.info('[trigger-manager] New DCA schedule detected', {
          contractId: s.contractId,
          user: s.payload.user,
          pair: `${s.payload.sourceAsset.symbol}->${s.payload.targetAsset.symbol}`,
        });
        await this.onNewDCASchedule(s);
      }
    }

    // Remove stale schedule references
    for (const [cid] of this.dcaSchedules) {
      if (!activeScheduleIds.has(cid)) {
        this.dcaSchedules.delete(cid);
      }
    }

    // Update metrics gauges
    try {
      metrics.setGauge(METRICS.activePortfolios, this.portfolios.size);
      metrics.setGauge(METRICS.activeDcaSchedules, this.dcaSchedules.size);
    } catch {
      // Metrics may not be initialized
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /**
   * Handle a newly detected portfolio.
   * Immediately checks drift and auto-rebalances if threshold exceeded.
   */
  private async onNewPortfolio(portfolio: DamlContract<PortfolioPayload>): Promise<void> {
    const { payload } = portfolio;

    try {
      const drift = rebalanceEngine.calculateDrift(payload.holdings, payload.targets);
      const threshold = this.extractDriftThreshold(payload.triggerMode);

      if (threshold !== null && drift.maxDrift >= threshold) {
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * this.config.maxJitterMs;
        logger.info('[trigger-manager] New portfolio exceeds drift threshold, scheduling rebalance', {
          contractId: portfolio.contractId,
          drift: drift.maxDrift.toFixed(2),
          threshold,
          jitterMs: Math.round(jitter),
        });

        setTimeout(async () => {
          try {
            await this.handlePortfolioRebalance(portfolio.contractId, payload);
          } catch (err) {
            logger.error('[trigger-manager] Deferred rebalance failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }, jitter);
      }
    } catch (err) {
      logger.error('[trigger-manager] onNewPortfolio handler failed', {
        contractId: portfolio.contractId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Handle a newly detected DCA schedule.
   * Registers for execution tracking.
   */
  private async onNewDCASchedule(schedule: DamlContract<DCASchedulePayload>): Promise<void> {
    logger.info('[trigger-manager] DCA schedule registered for tracking', {
      contractId: schedule.contractId,
      user: schedule.payload.user,
      pair: `${schedule.payload.sourceAsset.symbol}->${schedule.payload.targetAsset.symbol}`,
      frequency: schedule.payload.frequency,
    });
    // Schedule is already tracked in dcaSchedules map — nothing else needed
  }

  // -----------------------------------------------------------------------
  // Portfolio processing
  // -----------------------------------------------------------------------

  /**
   * Process all tracked portfolios: check drift and trigger rebalance if needed.
   */
  private async processPortfolios(platform: string): Promise<void> {
    const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, platform);
    const portfolioMap = new Map(portfolios.map(p => [p.contractId, p]));

    for (const [cid, tracked] of this.portfolios) {
      const portfolio = portfolioMap.get(cid);
      if (!portfolio || !portfolio.payload.isActive) continue;

      try {
        await this.handlePortfolioRebalance(cid, portfolio.payload);
        tracked.lastCheckedAt = Date.now();
        this.eventCounts.portfolioChecks++;
      } catch (err) {
        logger.error('[trigger-manager] Portfolio check failed', {
          contractId: cid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Handle portfolio drift check and auto-rebalance.
   * Called by TriggerManager instead of cron.
   */
  private async handlePortfolioRebalance(
    contractId: string,
    payload: PortfolioPayload,
  ): Promise<void> {
    const { holdings, targets, triggerMode, isActive } = payload;
    if (!isActive) return;

    const threshold = this.extractDriftThreshold(triggerMode);
    if (threshold === null) return; // Manual mode — skip auto-rebalance

    const drift = rebalanceEngine.calculateDrift(holdings, targets);
    if (drift.maxDrift < threshold) return; // Within tolerance

    logger.info('[trigger-manager] Portfolio drift exceeds threshold', {
      contractId,
      drift: drift.maxDrift.toFixed(2),
      threshold,
      user: payload.user,
    });

    // Add jitter
    const jitter = Math.random() * this.config.maxJitterMs;
    await new Promise(resolve => setTimeout(resolve, jitter));

    const result = await rebalanceEngine.executeRebalance(contractId);
    this.eventCounts.rebalanceTriggers++;

    if (result.success) {
      logger.info('[trigger-manager] Rebalance completed', {
        contractId,
        driftBefore: result.driftBefore.toFixed(2),
        driftAfter: result.driftAfter.toFixed(2),
        swapLegs: result.swapLegs.length,
      });

      // Record featured app activity with retry
      this.enqueueActivityMarker(
        payload.user,
        'Rebalance',
        `Trigger rebalance: drift ${result.driftBefore.toFixed(2)}% -> ${result.driftAfter.toFixed(2)}%, ${result.swapLegs.length} swaps`,
      );
    } else {
      logger.warn('[trigger-manager] Rebalance failed', {
        contractId,
        error: result.error,
      });
    }
  }

  // -----------------------------------------------------------------------
  // DCA processing
  // -----------------------------------------------------------------------

  /**
   * Process all tracked DCA schedules: execute those that are due.
   */
  private async processDCASchedules(platform: string): Promise<void> {
    // Delegate to DCA engine which already has sophisticated due-checking logic
    try {
      const result = await dcaEngine.executeDueSchedules();
      if (result.executed > 0) {
        this.eventCounts.dcaExecutions += result.executed;
        logger.info('[trigger-manager] DCA execution cycle complete', {
          executed: result.executed,
          failed: result.failed,
        });

        try {
          metrics.increment(METRICS.dcaExecuted, {}, result.executed);
        } catch {
          // Metrics may not be initialized
        }
      }
    } catch (err) {
      logger.error('[trigger-manager] DCA processing failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Rebalance request processing
  // -----------------------------------------------------------------------

  /**
   * Process any pending rebalance requests that were created externally
   * (e.g., via API endpoint rather than auto-trigger).
   */
  private async processPendingRebalanceRequests(platform: string): Promise<void> {
    try {
      const requests = await ledger.query(TEMPLATES.RebalanceRequest, platform);
      for (const request of requests) {
        const status = (request.payload as Record<string, unknown>).status;
        const statusTag = typeof status === 'string' ? status : (status as any)?.tag;

        if (statusTag === 'Pending') {
          logger.info('[trigger-manager] Processing pending rebalance request', {
            requestCid: request.contractId,
          });

          try {
            await this.processRebalanceRequest(request.contractId, request.payload as Record<string, unknown>);
          } catch (err) {
            logger.error('[trigger-manager] Failed to process rebalance request', {
              requestCid: request.contractId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      logger.error('[trigger-manager] Failed to query rebalance requests', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Process a specific rebalance request by contract ID.
   * Called when a RebalanceRequest event is detected.
   */
  private async processRebalanceRequest(
    requestCid: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const portfolioCid = payload.portfolioId as string | undefined;
    if (!portfolioCid) {
      logger.warn('[trigger-manager] RebalanceRequest missing portfolioId', { requestCid });
      return;
    }

    // The rebalance engine handles the full flow
    const result = await rebalanceEngine.executeRebalance(portfolioCid);
    this.eventCounts.rebalanceTriggers++;

    if (result.success) {
      const user = (payload.user as string) ?? 'unknown';
      this.enqueueActivityMarker(
        user,
        'Rebalance',
        `Request rebalance: drift ${result.driftBefore.toFixed(2)}% -> ${result.driftAfter.toFixed(2)}%`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Featured App activity marker management with retry
  // -----------------------------------------------------------------------

  /**
   * Enqueue an activity marker for recording. If recording fails,
   * it will be retried on the next poll cycle.
   */
  private enqueueActivityMarker(
    user: string,
    activityType: 'Rebalance' | 'DCAExecution' | 'CompoundExecution' | 'RewardDistribution',
    description: string,
  ): void {
    this.pendingActivityMarkers.push({
      user,
      activityType,
      description,
      retryCount: 0,
      maxRetries: 3,
    });
  }

  /**
   * Retry pending activity markers that failed in previous cycles.
   */
  private async retryPendingActivityMarkers(): Promise<void> {
    if (this.pendingActivityMarkers.length === 0) return;

    const remaining: typeof this.pendingActivityMarkers = [];
    let successCount = 0;
    let failCount = 0;

    for (const marker of this.pendingActivityMarkers) {
      try {
        await featuredApp.recordActivity(
          marker.user,
          marker.activityType,
          marker.description,
        );
        successCount++;
      } catch {
        marker.retryCount++;
        if (marker.retryCount < marker.maxRetries) {
          remaining.push(marker);
          failCount++;
        } else {
          logger.warn('[trigger-manager] Activity marker dropped after max retries', {
            user: marker.user,
            type: marker.activityType,
            retries: marker.retryCount,
          });
          failCount++;
        }
      }
    }

    this.pendingActivityMarkers = remaining;

    if (successCount > 0 || failCount > 0) {
      logger.debug('[trigger-manager] Activity marker retry', {
        succeeded: successCount,
        failed: failCount,
        pending: remaining.length,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Cron fallback
  // -----------------------------------------------------------------------

  /**
   * Cron-style fallback cycle. Runs when the circuit breaker trips.
   * Uses the existing engine methods that were originally called by cron.
   */
  private async cronFallbackCycle(): Promise<void> {
    logger.info('[trigger-manager] Running cron fallback cycle');

    try {
      await rebalanceEngine.checkAndAutoRebalance();
    } catch (err) {
      logger.error('[trigger-manager] Cron fallback: rebalance failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await dcaEngine.executeDueSchedules();
    } catch (err) {
      logger.error('[trigger-manager] Cron fallback: DCA failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await compoundEngine.checkAndCompoundAll();
    } catch (err) {
      logger.error('[trigger-manager] Cron fallback: compound failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Extract drift threshold from a Daml TriggerMode variant.
   */
  private extractDriftThreshold(triggerMode: Record<string, unknown>): number | null {
    if (triggerMode.tag === 'DriftThreshold') {
      return Number(triggerMode.value);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Module-level start/stop functions
// ---------------------------------------------------------------------------

let instance: TriggerManager | null = null;

/**
 * Start the global trigger manager.
 * If already running, returns the existing instance.
 */
export async function startTriggerManager(
  cfg?: Partial<TriggerManagerConfig>,
): Promise<TriggerManager> {
  if (instance) {
    logger.warn('[trigger-manager] Already running, returning existing instance');
    return instance;
  }

  instance = new TriggerManager(cfg);
  await instance.start();
  return instance;
}

/**
 * Stop the global trigger manager.
 */
export function stopTriggerManager(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

/**
 * Get the current trigger manager instance (or null if not started).
 */
export function getTriggerManager(): TriggerManager | null {
  return instance;
}
