import { config, TEMPLATES } from '../config.js';
import { ledger, extractCreatedContractId, type DamlContract } from '../ledger.js';
import { logger } from '../monitoring/logger.js';
import { metrics } from '../monitoring/metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityType = 'Rebalance' | 'DCAExecution' | 'CompoundExecution' | 'RewardDistribution';

export interface FeaturedAppConfigPayload {
  platform: string;
  appName: string;
  isRegistered: boolean;
  featuredAppRightCid: string | null;
  totalActivities: number;
}

export interface ActivityRecordPayload {
  platform: string;
  user: string;
  activityType: string | { tag: string };
  description: string;
  timestamp: string;
}

export interface ActivitySummary {
  totalActivities: number;
  isRegistered: boolean;
  appName: string;
  featuredAppRightCid: string | null;
  recentActivities: ActivityRecordPayload[];
}

// ---------------------------------------------------------------------------
// FeaturedAppEngine
// ---------------------------------------------------------------------------

/**
 * Engine for recording platform activity for Canton Featured App Rewards.
 *
 * The Canton Network rewards app builders with Canton Coin (CC) based on
 * the transaction volume their app generates. This engine manages the
 * FeaturedAppConfig contract and records activity markers.
 *
 * On the real Canton Network, RecordActivity would exercise
 * FeaturedAppRight_CreateActivityMarker from splice-api-featured-app-v1,
 * which automatically converts activity markers into AppRewardCoupons.
 */
// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const FEATURED_APP_METRICS = {
  activityRecordSuccess: 'featured_app_activity_success_total',
  activityRecordFailed: 'featured_app_activity_failed_total',
  activityMarkerRetried: 'featured_app_activity_retried_total',
  activityMarkerDropped: 'featured_app_activity_dropped_total',
  gsfMarkerSuccess: 'featured_app_gsf_marker_success_total',
  gsfMarkerFailed: 'featured_app_gsf_marker_failed_total',
} as const;

// ---------------------------------------------------------------------------
// Pending marker type
// ---------------------------------------------------------------------------

interface PendingMarker {
  user: string;
  activityType: ActivityType;
  description: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// FeaturedAppEngine
// ---------------------------------------------------------------------------

export class FeaturedAppEngine {
  private configCid: string | null = null;
  private pendingMarkers: PendingMarker[] = [];
  private retryTimerId: ReturnType<typeof setInterval> | null = null;

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the Featured App engine.
   *
   * Queries the ledger for an existing FeaturedAppConfig contract.
   * If none exists, creates one with default settings.
   */
  async initialize(): Promise<void> {
    const platform = config.platformParty;

    try {
      // Query for existing FeaturedAppConfig
      const configs = await ledger.query<FeaturedAppConfigPayload>(
        TEMPLATES.FeaturedAppConfig,
        platform,
      );

      if (configs.length > 0) {
        this.configCid = configs[0].contractId;
        const payload = configs[0].payload;
        logger.info(
          `[featured-app] Found existing config: appName=${payload.appName}, ` +
            `registered=${payload.isRegistered}, totalActivities=${payload.totalActivities}`,
        );
      } else {
        // Create a new FeaturedAppConfig
        const result = await ledger.create(
          TEMPLATES.FeaturedAppConfig,
          {
            platform,
            appName: 'Roil',
            isRegistered: false,
            featuredAppRightCid: null,
            totalActivities: 0,
          },
          [platform],
        );

        this.configCid = extractCreatedContractId(result);
        logger.info(`[featured-app] Created new config: ${this.configCid}`);
        logger.info('[featured-app] Config created with isRegistered=false — register at https://sync.global/featured-app-request/ to earn CC rewards');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to initialize: ${message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Activity recording
  // -----------------------------------------------------------------------

  /**
   * Record a platform activity for Featured App Rewards.
   *
   * Exercises RecordActivity on the FeaturedAppConfig contract, which:
   * 1. Increments the totalActivities counter
   * 2. Creates an ActivityRecord visible to the user
   * 3. (On real network) Would create an AppRewardCoupon via
   *    FeaturedAppRight_CreateActivityMarker
   */
  async recordActivity(
    user: string,
    activityType: ActivityType,
    description: string,
  ): Promise<void> {
    const platform = config.platformParty;

    // Ensure we have a config CID
    if (!this.configCid) {
      await this.initialize();
    }

    if (!this.configCid) {
      logger.error('[featured-app] No config contract available, queueing for retry');
      this.enqueuePendingMarker(user, activityType, description);
      metrics.increment(FEATURED_APP_METRICS.activityRecordFailed);
      return;
    }

    try {
      const result = await ledger.exercise(
        TEMPLATES.FeaturedAppConfig,
        this.configCid,
        'RecordActivity',
        {
          user,
          activityId: `${activityType}-${user}-${Date.now()}`,
          activityType,
          description,
          timestamp: new Date().toISOString(),
        },
        [platform],
      );

      // Extract the new config CID from the exercise result
      // RecordActivity returns (ContractId FeaturedAppConfig, ContractId ActivityRecord)
      const events = result.transaction?.events ?? [];
      for (const event of events) {
        if (event.CreatedEvent && event.CreatedEvent.templateId.includes('FeaturedAppConfig')) {
          this.configCid = event.CreatedEvent.contractId;
          break;
        }
      }

      metrics.increment(FEATURED_APP_METRICS.activityRecordSuccess);
      logger.info(
        `[featured-app] Recorded activity: type=${activityType}, user=${user}, desc="${description}"`,
      );

      // Attempt to create real GSF activity marker
      await this.createActivityMarkerIfRegistered(description);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to record activity: ${message}`);
      metrics.increment(FEATURED_APP_METRICS.activityRecordFailed);

      // Config contract may have been consumed — re-initialize on next call
      this.configCid = null;

      // Queue for retry
      this.enqueuePendingMarker(user, activityType, description);
    }
  }

  // -----------------------------------------------------------------------
  // Retry logic for pending activity markers
  // -----------------------------------------------------------------------

  /**
   * Enqueue a failed activity marker for retry on next cycle.
   */
  private enqueuePendingMarker(
    user: string,
    activityType: ActivityType,
    description: string,
  ): void {
    this.pendingMarkers.push({
      user,
      activityType,
      description,
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
    });

    // Cap pending markers to prevent unbounded growth
    if (this.pendingMarkers.length > 100) {
      const dropped = this.pendingMarkers.splice(0, this.pendingMarkers.length - 100);
      metrics.increment(FEATURED_APP_METRICS.activityMarkerDropped, {}, dropped.length);
      logger.warn(`[featured-app] Dropped ${dropped.length} oldest pending markers (cap exceeded)`);
    }
  }

  /**
   * Process pending activity markers — retry failed recordings.
   * Called periodically by the retry timer or by TriggerManager.
   */
  async retryPendingMarkers(): Promise<{ succeeded: number; failed: number; dropped: number }> {
    if (this.pendingMarkers.length === 0) {
      return { succeeded: 0, failed: 0, dropped: 0 };
    }

    const remaining: PendingMarker[] = [];
    let succeeded = 0;
    let failed = 0;
    let dropped = 0;

    for (const marker of this.pendingMarkers) {
      try {
        // Re-initialize config if needed
        if (!this.configCid) {
          await this.initialize();
        }
        if (!this.configCid) {
          marker.retryCount++;
          if (marker.retryCount < marker.maxRetries) {
            remaining.push(marker);
            failed++;
          } else {
            dropped++;
            metrics.increment(FEATURED_APP_METRICS.activityMarkerDropped);
            logger.warn('[featured-app] Pending marker dropped after max retries', {
              user: marker.user,
              type: marker.activityType,
              retries: marker.retryCount,
            });
          }
          continue;
        }

        const platform = config.platformParty;
        const result = await ledger.exercise(
          TEMPLATES.FeaturedAppConfig,
          this.configCid,
          'RecordActivity',
          {
            user: marker.user,
            activityId: `${marker.activityType}-${marker.user}-${Date.now()}`,
            activityType: marker.activityType,
            description: `[retry] ${marker.description}`,
            timestamp: new Date().toISOString(),
          },
          [platform],
        );

        // Update config CID
        const events = result.transaction?.events ?? [];
        for (const event of events) {
          if (event.CreatedEvent && event.CreatedEvent.templateId.includes('FeaturedAppConfig')) {
            this.configCid = event.CreatedEvent.contractId;
            break;
          }
        }

        succeeded++;
        metrics.increment(FEATURED_APP_METRICS.activityMarkerRetried);
      } catch {
        marker.retryCount++;
        if (marker.retryCount < marker.maxRetries) {
          remaining.push(marker);
          failed++;
        } else {
          dropped++;
          metrics.increment(FEATURED_APP_METRICS.activityMarkerDropped);
          logger.warn('[featured-app] Pending marker dropped after max retries', {
            user: marker.user,
            type: marker.activityType,
          });
        }
        // Config may be stale
        this.configCid = null;
      }
    }

    this.pendingMarkers = remaining;

    if (succeeded > 0 || dropped > 0) {
      logger.info('[featured-app] Retry cycle complete', { succeeded, failed, dropped, pending: remaining.length });
    }

    return { succeeded, failed, dropped };
  }

  /**
   * Start the automatic retry timer (runs every 2 minutes).
   */
  startRetryTimer(): void {
    if (this.retryTimerId) return;
    this.retryTimerId = setInterval(() => {
      this.retryPendingMarkers().catch(err => {
        logger.error('[featured-app] Retry timer error', { error: String(err) });
      });
    }, 2 * 60 * 1000);
    logger.info('[featured-app] Retry timer started (interval: 2min)');
  }

  /**
   * Stop the automatic retry timer.
   */
  stopRetryTimer(): void {
    if (this.retryTimerId) {
      clearInterval(this.retryTimerId);
      this.retryTimerId = null;
    }
  }

  /**
   * Get the count of pending activity markers awaiting retry.
   */
  getPendingMarkerCount(): number {
    return this.pendingMarkers.length;
  }

  // -----------------------------------------------------------------------
  // GSF Activity Marker
  // -----------------------------------------------------------------------

  /**
   * On the real Canton Network, this would exercise FeaturedAppRight_CreateActivityMarker
   * from splice-api-featured-app-v1. For now, we record in our own contracts and
   * prepare the call structure for when the GSF registration is complete.
   */
  async createActivityMarkerIfRegistered(
    activityDescription: string,
  ): Promise<void> {
    if (config.network === 'localnet') return;

    // Check if we have a FeaturedAppRight CID from GSF registration
    const featuredAppRightCid = process.env.FEATURED_APP_RIGHT_CID;
    if (!featuredAppRightCid) {
      logger.debug('No FeaturedAppRight CID — skipping activity marker creation');
      return;
    }

    try {
      // Exercise FeaturedAppRight_CreateActivityMarker on the real network
      await ledger.exercise(
        '#splice-api-featured-app-v1:Splice.Api.FeaturedAppV1:FeaturedAppRight',
        featuredAppRightCid,
        'FeaturedAppRight_CreateActivityMarker',
        {
          provider: config.platformParty,
          activityMarkerDescription: activityDescription,
        },
        [config.platformParty],
      );
      metrics.increment(FEATURED_APP_METRICS.gsfMarkerSuccess);
      logger.info('Featured App activity marker created on GSF', { description: activityDescription });
    } catch (err) {
      metrics.increment(FEATURED_APP_METRICS.gsfMarkerFailed);
      logger.warn('Failed to create GSF activity marker', { error: String(err) });
    }
  }

  // -----------------------------------------------------------------------
  // Convenience: record activity for specific engine operations
  // -----------------------------------------------------------------------

  /**
   * Record activity after a successful rebalance completion.
   */
  async recordRebalanceCompletion(
    user: string,
    driftBefore: number,
    driftAfter: number,
    swapCount: number,
  ): Promise<void> {
    await this.recordActivity(
      user,
      'Rebalance',
      `Rebalance: drift ${driftBefore.toFixed(2)}% -> ${driftAfter.toFixed(2)}%, ${swapCount} swaps`,
    );
  }

  /**
   * Record activity after a successful DCA execution.
   */
  async recordDCAExecution(
    user: string,
    sourceAmount: number,
    sourceAsset: string,
    targetAmount: number,
    targetAsset: string,
  ): Promise<void> {
    await this.recordActivity(
      user,
      'DCAExecution',
      `DCA: ${sourceAmount} ${sourceAsset} -> ${targetAmount.toFixed(6)} ${targetAsset}`,
    );
  }

  /**
   * Record activity after a successful compound execution.
   */
  async recordCompoundExecution(
    user: string,
    totalYieldUsdcx: number,
    strategy: string,
    yieldSourceSummary: string,
  ): Promise<void> {
    await this.recordActivity(
      user,
      'CompoundExecution',
      `Auto-compound: ${totalYieldUsdcx.toFixed(2)} USDCx yield reinvested via ${strategy} (sources: ${yieldSourceSummary})`,
    );
  }

  /**
   * Record activity after a successful reward distribution.
   */
  async recordRewardDistribution(
    user: string,
    rewardAmount: number,
    tier: string,
    monthId: string,
  ): Promise<void> {
    await this.recordActivity(
      user,
      'RewardDistribution',
      `Reward: ${rewardAmount.toFixed(2)} CC distributed (tier=${tier}, month=${monthId})`,
    );
  }

  // -----------------------------------------------------------------------
  // Query helpers
  // -----------------------------------------------------------------------

  /**
   * Get activity summary including config status and recent activities.
   */
  async getActivitySummary(): Promise<ActivitySummary | null> {
    const platform = config.platformParty;

    try {
      // Fetch config
      const configs = await ledger.query<FeaturedAppConfigPayload>(
        TEMPLATES.FeaturedAppConfig,
        platform,
      );

      if (configs.length === 0) {
        return null;
      }

      const configPayload = configs[0].payload;

      // Fetch recent activity records
      const activities = await ledger.query<ActivityRecordPayload>(
        TEMPLATES.ActivityRecord,
        platform,
      );

      // Sort by timestamp descending, take latest 50
      const sorted = activities
        .map((a) => a.payload)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 50);

      return {
        totalActivities: configPayload.totalActivities,
        isRegistered: configPayload.isRegistered,
        appName: configPayload.appName,
        featuredAppRightCid: configPayload.featuredAppRightCid,
        recentActivities: sorted,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to get summary: ${message}`);
      return null;
    }
  }

  /**
   * Get activity records for a specific user.
   */
  async getUserActivities(user: string): Promise<ActivityRecordPayload[]> {
    const platform = config.platformParty;

    try {
      const activities = await ledger.query<ActivityRecordPayload>(
        TEMPLATES.ActivityRecord,
        platform,
      );

      return activities
        .filter((a) => a.payload.user === user)
        .map((a) => a.payload)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to get user activities: ${message}`);
      return [];
    }
  }

  /**
   * Update the registration status of the Featured App.
   * Called after registering with the Global Synchronizer Foundation.
   */
  async updateRegistration(
    isRegistered: boolean,
    featuredAppRightCid: string | null,
  ): Promise<void> {
    const platform = config.platformParty;

    if (!this.configCid) {
      await this.initialize();
    }

    if (!this.configCid) {
      logger.error('[featured-app] No config contract available');
      return;
    }

    try {
      const result = await ledger.exercise(
        TEMPLATES.FeaturedAppConfig,
        this.configCid,
        'UpdateRegistration',
        {
          newIsRegistered: isRegistered,
          newFeaturedAppRightCid: featuredAppRightCid,
        },
        [platform],
      );

      this.configCid = extractCreatedContractId(result);
      logger.info(
        `[featured-app] Updated registration: registered=${isRegistered}, rightCid=${featuredAppRightCid}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to update registration: ${message}`);
      this.configCid = null;
    }
  }
}

/** Singleton instance */
export const featuredApp = new FeaturedAppEngine();
