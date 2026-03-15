/**
 * Canton Rebalancer — Ledger Initialization Script
 * =================================================
 * Run with: npx tsx scripts/init-ledger.ts
 *
 * Connects to the Canton JSON API v2, allocates parties if needed,
 * creates initial PortfolioProposal contracts, sets up RewardTracker
 * contracts, and prints the resulting party IDs and contract IDs.
 *
 * Requires the backend dependencies to be installed (npm ci in backend/).
 */

import { DamlLedger, extractCreatedContractId } from '../backend/src/ledger.js';
import { config, TEMPLATES } from '../backend/src/config.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const JSON_API_URL = process.env.JSON_API_URL || config.jsonApiUrl;

/** Current month identifier for RewardTracker (e.g., "2026-03") */
function currentMonthId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log('=== Canton Rebalancer — Ledger Initialization ===');
  console.log(`  JSON API: ${JSON_API_URL}`);
  console.log('');

  const ledger = new DamlLedger(JSON_API_URL);

  // -----------------------------------------------------------------------
  // 1. Health check
  // -----------------------------------------------------------------------

  console.log('[1/5] Checking ledger health...');
  const healthy = await ledger.health();
  if (!healthy) {
    console.error('ERROR: Ledger API is not reachable at', JSON_API_URL);
    console.error('  Make sure Canton LocalNet is running (./scripts/setup-localnet.sh)');
    process.exit(1);
  }
  console.log('  Ledger is healthy.');

  // -----------------------------------------------------------------------
  // 2. Allocate parties
  // -----------------------------------------------------------------------

  console.log('[2/5] Allocating parties...');

  const parties: Record<string, string> = {};

  async function ensureParty(hint: string, displayName: string): Promise<string> {
    try {
      const result = await ledger.allocateParty(hint, displayName, []);
      parties[hint] = result.party;
      console.log(`  ${displayName}: ${result.party}`);
      return result.party;
    } catch (err: unknown) {
      // Party may already exist — try to extract from error or use hint
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('PARTY_ALREADY_EXISTS') || message.includes('409') || message.includes('already')) {
        // Use the hint as a fallback identifier — in cn-quickstart the party ID
        // follows the pattern hint::fingerprint. We store just the hint for now;
        // the caller can override via env vars.
        console.log(`  ${displayName}: already exists (using hint "${hint}")`);
        parties[hint] = hint;
        return hint;
      }
      throw err;
    }
  }

  const platformParty = await ensureParty('platform', 'Platform');
  const aliceParty = await ensureParty('alice', 'Alice');
  const bobParty = await ensureParty('bob', 'Bob');

  // -----------------------------------------------------------------------
  // 3. Create PortfolioProposal contracts
  // -----------------------------------------------------------------------

  console.log('[3/5] Creating PortfolioProposal contracts...');

  // Check if proposals already exist for Alice
  const existingAliceProposals = await ledger.query(TEMPLATES.PortfolioProposal, platformParty);
  const aliceHasProposal = existingAliceProposals.some(
    (c) => (c.payload as Record<string, unknown>).user === aliceParty,
  );

  const contractIds: Record<string, string> = {};

  if (!aliceHasProposal) {
    const aliceProposalResult = await ledger.create(
      TEMPLATES.PortfolioProposal,
      { platform: platformParty, user: aliceParty },
      [platformParty],
    );
    const aliceProposalCid = extractCreatedContractId(aliceProposalResult);
    contractIds['PortfolioProposal (Alice)'] = aliceProposalCid;
    console.log(`  Alice PortfolioProposal: ${aliceProposalCid}`);
  } else {
    console.log('  Alice PortfolioProposal: already exists — skipping.');
  }

  // Check if proposals already exist for Bob
  const existingBobProposals = await ledger.query(TEMPLATES.PortfolioProposal, platformParty);
  const bobHasProposal = existingBobProposals.some(
    (c) => (c.payload as Record<string, unknown>).user === bobParty,
  );

  if (!bobHasProposal) {
    const bobProposalResult = await ledger.create(
      TEMPLATES.PortfolioProposal,
      { platform: platformParty, user: bobParty },
      [platformParty],
    );
    const bobProposalCid = extractCreatedContractId(bobProposalResult);
    contractIds['PortfolioProposal (Bob)'] = bobProposalCid;
    console.log(`  Bob PortfolioProposal:   ${bobProposalCid}`);
  } else {
    console.log('  Bob PortfolioProposal:   already exists — skipping.');
  }

  // -----------------------------------------------------------------------
  // 4. Create RewardTracker contracts
  // -----------------------------------------------------------------------

  console.log('[4/5] Creating RewardTracker contracts...');

  const monthId = currentMonthId();

  // Check existing reward trackers
  const existingTrackers = await ledger.query(TEMPLATES.RewardTracker, platformParty);

  async function ensureRewardTracker(userParty: string, userName: string): Promise<void> {
    const hasTracker = existingTrackers.some((c) => {
      const p = c.payload as Record<string, unknown>;
      return p.user === userParty && p.monthId === monthId;
    });

    if (!hasTracker) {
      const result = await ledger.create(
        TEMPLATES.RewardTracker,
        {
          platform: platformParty,
          user: userParty,
          monthId,
          txCount: 0,
          tier: 'Bronze',
          consecutiveMonths: 0,
          totalRewardsEarned: '0.0',
        },
        [platformParty],
      );
      const cid = extractCreatedContractId(result);
      contractIds[`RewardTracker (${userName})`] = cid;
      console.log(`  ${userName} RewardTracker (${monthId}): ${cid}`);
    } else {
      console.log(`  ${userName} RewardTracker (${monthId}): already exists — skipping.`);
    }
  }

  await ensureRewardTracker(aliceParty, 'Alice');
  await ensureRewardTracker(bobParty, 'Bob');

  // -----------------------------------------------------------------------
  // 5. Summary
  // -----------------------------------------------------------------------

  console.log('[5/5] Initialization complete!');
  console.log('');
  console.log('  Party IDs:');
  for (const [name, id] of Object.entries(parties)) {
    console.log(`    ${name.padEnd(12)} => ${id}`);
  }
  console.log('');
  console.log('  Contract IDs:');
  if (Object.keys(contractIds).length === 0) {
    console.log('    (all contracts already existed)');
  } else {
    for (const [name, id] of Object.entries(contractIds)) {
      console.log(`    ${name.padEnd(30)} => ${id}`);
    }
  }
  console.log('');
  console.log('  Environment variables for .env:');
  console.log(`    PLATFORM_PARTY=${parties['platform'] || platformParty}`);
  console.log(`    JSON_API_URL=${JSON_API_URL}`);
  console.log(`    JWT_MODE=unsafe`);
  console.log('');
  console.log('  Next: cd backend && npm run dev');
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('Ledger initialization failed:', err);
  process.exit(1);
});
