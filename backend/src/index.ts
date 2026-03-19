import cron from 'node-cron';
import { config } from './config.js';
import { createApp } from './server.js';
import { rebalanceEngine } from './engine/rebalance.js';
import { dcaEngine } from './engine/dca.js';
import { rewardsEngine } from './engine/rewards.js';
import { compoundEngine } from './engine/compound.js';
import { priceOracle } from './services/price-oracle.js';
import { logger } from './monitoring/logger.js';
import { metrics, METRICS } from './monitoring/metrics.js';
import { transactionStream } from './services/transaction-stream.js';
// Performance tracker is loaded eagerly so the in-memory store is ready
// for snapshot recording during auto-rebalance checks.
import './services/performance-tracker.js';

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

  logger.info('Canton Private Rebalancer backend started', {
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

  // Stop all cron jobs
  const tasks = cron.getTasks();
  for (const [, task] of tasks) {
    task.stop();
  }

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
