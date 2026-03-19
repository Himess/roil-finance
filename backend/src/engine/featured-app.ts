import { config, TEMPLATES } from '../config.js';
import { ledger, extractCreatedContractId, type DamlContract } from '../ledger.js';
import { logger } from '../monitoring/logger.js';

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
export class FeaturedAppEngine {
  private configCid: string | null = null;

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
      logger.error('[featured-app] No config contract available, skipping activity recording');
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

      logger.info(
        `[featured-app] Recorded activity: type=${activityType}, user=${user}, desc="${description}"`,
      );

      // Attempt to create real GSF activity marker
      await this.createActivityMarkerIfRegistered(description);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[featured-app] Failed to record activity: ${message}`);

      // Config contract may have been consumed — re-initialize on next call
      this.configCid = null;
    }
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
      logger.info('Featured App activity marker created on GSF', { description: activityDescription });
    } catch (err) {
      logger.warn('Failed to create GSF activity marker', { error: String(err) });
    }
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
