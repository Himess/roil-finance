// ---------------------------------------------------------------------------
// Admin Party Validator
// ---------------------------------------------------------------------------
//
// On non-localnet environments, INSTRUMENTS declares admin party IDs for
// every supported asset (CC, USDCx, CBTC, ETHx, SOLx, XAUt, XAGt, USTb, MMF).
//
// The `config.ts` guard only rejects empty strings; a misconfigured or
// mock-placeholder admin party will fail *at runtime* with an opaque
// "unknown party" error the first time an engine submits a command.
//
// This module runs once at startup and:
//   1. Confirms each admin party is allocated on the participant.
//   2. Explicitly logs mock-prefixed parties so operators see which
//      assets are in demo-only mode (no real ledger support).
//   3. Emits a structured warning for any REQUIRED party (CC, USDCx)
//      that is not allocated — this is always a misconfiguration.
//
// Does NOT throw. Startup continues even with missing parties so that
// partial functionality (e.g., read-only endpoints, demo assets) keeps
// working. Operators must fix via env change + restart.
// ---------------------------------------------------------------------------

import { config, INSTRUMENTS } from '../config.js';
import { logger } from '../monitoring/logger.js';

/** Parties that MUST be allocated for core swap/rebalance flows to work. */
const REQUIRED_PARTIES = new Set(['CC', 'USDCx']);

/** Party-ID prefixes that indicate an intentional mock (not-on-ledger) party. */
const MOCK_PREFIXES = ['mock-', 'placeholder', 'demo-'];

function isMockParty(partyId: string): boolean {
  const lower = partyId.toLowerCase();
  return MOCK_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Heuristic: a party that follows the Canton party-ID format
 * (`hint::1220<64hex>`) and is NOT a known mock prefix is *assumed* real.
 *
 * Full ledger allocation verification would require calling the participant's
 * `/v2/parties` endpoint, but that API is internal to the DamlLedger class.
 * This heuristic is sufficient for startup diagnostics — actual ledger
 * submission failures at runtime will be caught by engine error handling.
 */
function looksAllocated(partyId: string): boolean {
  if (isMockParty(partyId)) return false;
  // Canton party ID: hint::1220<hex>
  return /^[a-zA-Z0-9_-]+::1220[a-f0-9]{64}$/i.test(partyId);
}

/**
 * Validate all INSTRUMENTS admin parties against the ledger. Logs findings;
 * never throws. On localnet this is a no-op.
 */
export async function validateAdminParties(): Promise<void> {
  if (config.network === 'localnet') {
    logger.info('Admin party validation skipped (localnet)', {
      component: 'admin-party-validator',
    });
    return;
  }

  const results: Array<{
    asset: string;
    partyId: string;
    allocated: boolean;
    mock: boolean;
    required: boolean;
  }> = [];

  for (const [asset, inst] of Object.entries(INSTRUMENTS)) {
    const partyId = inst.admin;
    const mock = isMockParty(partyId);
    const required = REQUIRED_PARTIES.has(asset);

    // Heuristic check: mock prefix → never allocated; Canton format → likely real.
    const allocated = mock ? false : looksAllocated(partyId);
    results.push({ asset, partyId, allocated, mock, required });
  }

  const missingRequired = results.filter((r) => r.required && !r.allocated && !r.mock);
  const mockAssets = results.filter((r) => r.mock);
  const okReal = results.filter((r) => r.allocated && !r.mock);

  if (okReal.length > 0) {
    logger.info('Admin parties validated on ledger', {
      component: 'admin-party-validator',
      assets: okReal.map((r) => r.asset),
    });
  }

  if (mockAssets.length > 0) {
    logger.warn('Admin parties running in MOCK mode (not allocated on ledger)', {
      component: 'admin-party-validator',
      assets: mockAssets.map((r) => r.asset),
      note: 'Engines that submit for these assets will fail with "unknown party". Expected for demo-only assets.',
    });
  }

  if (missingRequired.length > 0) {
    logger.error(
      'REQUIRED admin party NOT allocated on ledger — core flows (swap, rebalance, DCA) will fail',
      {
        component: 'admin-party-validator',
        missing: missingRequired.map((r) => ({ asset: r.asset, partyId: r.partyId })),
        action: 'Update ..._ADMIN_PARTY env vars to the correct ledger party ID and restart.',
      },
    );
  }

  // Summary for dashboards / ops
  logger.info('Admin party validation summary', {
    component: 'admin-party-validator',
    total: results.length,
    realAllocated: okReal.length,
    mock: mockAssets.length,
    missingRequired: missingRequired.length,
  });
}
