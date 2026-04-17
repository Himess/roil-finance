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
import { ledger } from '../ledger.js';
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
 * Check whether a party ID is known to the participant.
 *
 * Canton JSON Ledger API v2 exposes `/v2/parties/:party` — returns 200 with
 * the party details if allocated, 404 otherwise. This function is non-throwing
 * and returns false on any error (network, auth, 404, etc.).
 */
async function isPartyAllocated(partyId: string): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(partyId);
    const result = await ledger.get<{ partyDetails?: unknown } | unknown[]>(
      `/v2/parties/${encoded}`,
      [config.platformParty],
    );
    // v2 returns either a wrapper object or an array with one entry.
    if (Array.isArray(result)) return result.length > 0;
    return !!(result as { partyDetails?: unknown }).partyDetails || !!result;
  } catch {
    return false;
  }
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

    // Skip ledger lookup for mock parties — they're never allocated by design.
    const allocated = mock ? false : await isPartyAllocated(partyId);
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
