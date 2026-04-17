// OpenTelemetry must be imported before any other modules for
// auto-instrumentation to hook into Express and HTTP correctly.
import './tracing.js';

import cron from 'node-cron';
import { config, resolveTemplateIds } from './config.js';
import { createApp } from './server.js';
import { validateAuthConfig } from './middleware/auth.js';
import { rebalanceEngine } from './engine/rebalance.js';
import { dcaEngine } from './engine/dca.js';
import { rewardsEngine } from './engine/rewards.js';
import { compoundEngine } from './engine/compound.js';
import { priceOracle } from './services/price-oracle.js';
import { xreserveClient } from './services/xreserve-client.js';
import { validateAdminParties } from './services/admin-party-validator.js';
import { logger } from './monitoring/logger.js';
import { metrics, METRICS } from './monitoring/metrics.js';
import { transactionStream } from './services/transaction-stream.js';
import { initDb, closeDb } from './db/index.js';
// Performance tracker is loaded eagerly so the in-memory store is ready
// for snapshot recording during auto-rebalance checks.
import './services/performance-tracker.js';

// ---------------------------------------------------------------------------
// Bootstrap — database + template ID resolution
// ---------------------------------------------------------------------------

// Initialize Postgres connection pool and run schema migration.
// No-op if DATABASE_URL is not set (in-memory fallback used instead).
await initDb().catch(err => {
  logger.warn('Database init skipped', { error: String(err) });
});

// Resolve Daml package hash for devnet/testnet/mainnet template IDs.
// On localnet, package-name references work natively — no resolution needed.
await resolveTemplateIds().then(hash => {
  if (hash) {
    logger.info(`Resolved Daml package hash: ${hash}`, { component: 'config' });
  }
}).catch(err => {
  logger.warn('Template ID resolution skipped', { error: String(err) });
});

// ---------------------------------------------------------------------------
// Startup validation — fail fast on misconfiguration
// ---------------------------------------------------------------------------

validateAuthConfig();

// Check that admin parties are actually allocated on the ledger (non-fatal).
// This distinguishes real/mock/missing parties and logs a warning for required
// assets (CC, USDCx) that are unallocated. Fire-and-forget so boot isn't blocked.
validateAdminParties().catch((err) => {
  logger.warn('Admin party validation errored', { error: String(err) });
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const app = createApp();

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// DCA execution + auto-rebalance check
cron.schedule(config.dcaCronSchedule, async () => {
  logger.info('Running DCA + auto-rebalance check', { component: 'cron' });

  try {
    // Execute due DCA schedules
    const dcaResult = await dcaEngine.executeDueSchedules();
    metrics.increment(METRICS.dcaExecuted, {}, dcaResult.executed);
    logger.info(`DCA: ${dcaResult.executed} executed, ${dcaResult.failed} failed`, {
      component: 'cron',
      executed: dcaResult.executed,
      failed: dcaResult.failed,
    });
  } catch (err) {
    logger.error('DCA execution error', {
      component: 'cron',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    // Check and auto-rebalance portfolios exceeding drift threshold
    // (also records performance snapshots for all active portfolios)
    await rebalanceEngine.checkAndAutoRebalance();
  } catch (err) {
    logger.error('Auto-rebalance error', {
      component: 'cron',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Monthly reward distribution — runs at 00:05 on the 1st of each month
cron.schedule('5 0 1 * *', async () => {
  logger.info('Running monthly reward distribution', { component: 'cron' });

  try {
    const result = await rewardsEngine.distributeMonthlyRewards();
    metrics.increment(METRICS.rewardDistributed, {}, result.distributed);
    logger.info(`Rewards: ${result.distributed} distributed, ${result.failed} failed`, {
      component: 'cron',
      distributed: result.distributed,
      failed: result.failed,
    });
  } catch (err) {
    logger.error('Reward distribution error', {
      component: 'cron',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Auto-compound check — runs every hour
cron.schedule('0 * * * *', async () => {
  logger.info('Running auto-compound check', { component: 'cron' });

  try {
    await compoundEngine.checkAndCompoundAll();
  } catch (err) {
    logger.error('Auto-compound error', {
      component: 'cron',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const server = app.listen(config.port, () => {
  // Startup gauges
  metrics.setGauge(METRICS.activePortfolios, 0);
  metrics.setGauge(METRICS.activeDcaSchedules, 0);
  metrics.setGauge(METRICS.circuitBreakerState, 0); // 0 = closed (healthy)

  // Start price oracle polling (every 30 seconds)
  priceOracle.startPolling(30_000);

  // Start transaction stream for real-time contract events
  if (config.network !== 'localnet') {
    transactionStream.start().catch(err => {
      logger.warn('Transaction stream failed to start', { error: String(err) });
    });
  }

  // Start xReserve attestation poller (every 60s) — watches for DepositAttestation contracts
  xreserveClient.startPolling(60_000);

  logger.info('Roil backend started', {
    port: config.port,
    jsonApiUrl: config.jsonApiUrl,
    platformParty: config.platformParty,
    cantexApiUrl: config.cantexApiUrl,
    dcaCron: config.dcaCronSchedule,
    priceOraclePolling: '30s',
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Stop transaction stream
  transactionStream.stop();

  // Stop price oracle polling
  priceOracle.stopPolling();

  // Stop xReserve poller
  xreserveClient.stopPolling();

  // Stop all cron jobs
  const tasks = cron.getTasks();
  for (const [, task] of tasks) {
    task.stop();
  }

  // Close HTTP server, then database pool
  server.close(() => {
    logger.info('HTTP server closed');
    void closeDb().finally(() => {
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
