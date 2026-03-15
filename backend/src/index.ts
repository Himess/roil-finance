import cron from 'node-cron';
import { config } from './config.js';
import { createApp } from './server.js';
import { rebalanceEngine } from './engine/rebalance.js';
import { dcaEngine } from './engine/dca.js';
import { rewardsEngine } from './engine/rewards.js';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const app = createApp();

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------

// DCA execution + auto-rebalance check
cron.schedule(config.dcaCronSchedule, async () => {
  console.log(`[cron] Running DCA + auto-rebalance check at ${new Date().toISOString()}`);

  try {
    // Execute due DCA schedules
    const dcaResult = await dcaEngine.executeDueSchedules();
    console.log(`[cron] DCA: ${dcaResult.executed} executed, ${dcaResult.failed} failed`);
  } catch (err) {
    console.error('[cron] DCA execution error:', err);
  }

  try {
    // Check and auto-rebalance portfolios exceeding drift threshold
    await rebalanceEngine.checkAndAutoRebalance();
  } catch (err) {
    console.error('[cron] Auto-rebalance error:', err);
  }
});

// Monthly reward distribution — runs at 00:05 on the 1st of each month
cron.schedule('5 0 1 * *', async () => {
  console.log(`[cron] Running monthly reward distribution at ${new Date().toISOString()}`);

  try {
    const result = await rewardsEngine.distributeMonthlyRewards();
    console.log(`[cron] Rewards: ${result.distributed} distributed, ${result.failed} failed`);
  } catch (err) {
    console.error('[cron] Reward distribution error:', err);
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(config.port, () => {
  console.log(`
  ============================================
   Canton Private Rebalancer — Backend
  ============================================
   Port:         ${config.port}
   JSON API:     ${config.jsonApiUrl}
   Platform:     ${config.platformParty}
   Cantex API:   ${config.cantexApiUrl}
   DCA Cron:     ${config.dcaCronSchedule}
  ============================================
  `);
});
