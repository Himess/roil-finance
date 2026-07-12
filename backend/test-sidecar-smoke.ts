/**
 * Manual smoke test for the sidecar wiring. Not part of the test suite.
 * Run with: npx tsx test-sidecar-smoke.ts
 *
 * Requires:
 *   - sidecar running on 127.0.0.1:6200 (sidecars/cantex/app.py)
 *   - env: CANTEX_SIDECAR_URL, optional CANTEX_SIDECAR_AUTH_TOKEN
 */
import { CantexClient } from './src/cantex.js';

async function main() {
  const c = new CantexClient();

  console.log('[isAvailable]', await c.isAvailable());

  const balances = await c.getBalances('whatever');
  console.log('[balances]');
  for (const b of balances) console.log(`  ${b.asset}: ${b.amount}`);

  const pools = await c.getPoolInfo();
  console.log('[pools]');
  for (const p of pools) console.log(`  ${p.pair} fee=${p.fee}`);

  const quote = await c.getQuote('CC', 'USDCx', 1);
  console.log('[quote 1 CC -> USDCx]', quote);

  const prices = await c.getPrices();
  console.log('[prices]', prices);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
