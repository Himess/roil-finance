/**
 * xReserve routes — USDC bridging between Ethereum and Canton.
 *
 * Endpoints:
 *   GET  /api/xreserve/info                — chain config (public)
 *   POST /api/xreserve/onboard             — create BridgeUserAgreementRequest
 *   GET  /api/xreserve/onboarding/:party   — check user's agreement status (public — for polling)
 *   POST /api/xreserve/deposits            — start a deposit
 *   POST /api/xreserve/deposits/:id/burn   — report burn tx hash
 *   POST /api/xreserve/deposits/:id/claim  — mint USDCx from attestation
 *   GET  /api/xreserve/deposits            — list deposits
 *   GET  /api/xreserve/deposits/:id        — deposit status
 *   POST /api/xreserve/withdrawals         — start a withdrawal (exercise Burn)
 *   GET  /api/xreserve/withdrawals         — list withdrawals
 *   GET  /api/xreserve/withdrawals/:id     — withdrawal status
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireParty } from '../middleware/auth.js';
import { logger } from '../monitoring/logger.js';
import { ledger } from '../ledger.js';
import {
  xreserveClient,
  BRIDGE_TEMPLATES,
  XRESERVE_CHAINS,
  CANTON_XRESERVE_DOMAIN,
  ETHEREUM_DOMAIN,
  getSourceChain,
  getOperator,
} from '../services/xreserve-client.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const depositSchema = z.object({
  evmAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  amount: z
    .string()
    .regex(/^\d+$/, 'Amount must be a positive integer (USDC wei, 6 decimals)'),
});

const burnSchema = z.object({
  burnTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid tx hash'),
});

const withdrawSchema = z.object({
  destinationEvmAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be positive integer'),
});

// ---------------------------------------------------------------------------
// GET /api/xreserve/info (public)
// ---------------------------------------------------------------------------

router.get('/info', (_req: Request, res: Response) => {
  const chain = XRESERVE_CHAINS[getSourceChain()];
  res.json({
    success: true,
    cantonDomain: CANTON_XRESERVE_DOMAIN,
    ethereumDomain: ETHEREUM_DOMAIN,
    sourceChain: chain,
    operator: getOperator(),
    // Ethereum L1 is the only source today; other chains will be added later
    note: 'xReserve currently supports Ethereum L1 only. Withdrawals also go to Ethereum L1.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/xreserve/onboard — create BridgeUserAgreementRequest
// ---------------------------------------------------------------------------

router.post('/onboard', requireParty(),async (req: Request, res: Response) => {
  const cantonParty = req.partyId!;
  const operator = getOperator();

  try {
    // Check if agreement already exists
    const existing = await ledger
      .query(BRIDGE_TEMPLATES.UserAgreement, cantonParty)
      .catch(() => []);

    if (existing.length > 0) {
      res.json({
        success: true,
        alreadyOnboarded: true,
        agreementCid: (existing[0] as { contractId: string }).contractId,
      });
      return;
    }

    // Create new onboarding request
    const result = await ledger.create(
      BRIDGE_TEMPLATES.UserAgreementRequest,
      {
        user: cantonParty,
        operator,
      },
      [cantonParty],
    );

    logger.info('[xreserve] Onboarding request created', {
      party: cantonParty,
      operator,
    });

    res.json({
      success: true,
      alreadyOnboarded: false,
      requestResult: result,
      message:
        'Onboarding request submitted. The xReserve operator must accept it. Poll /onboarding/:party for status.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[xreserve] Onboarding failed', { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/onboarding/:party', async (req: Request, res: Response) => {
  try {
    const party = String(req.params.party);
    const agreements = await ledger
      .query(BRIDGE_TEMPLATES.UserAgreement, party)
      .catch(() => []);
    const pending = await ledger
      .query(BRIDGE_TEMPLATES.UserAgreementRequest, party)
      .catch(() => []);

    res.json({
      success: true,
      onboarded: agreements.length > 0,
      pendingRequest: pending.length > 0,
      agreementCid:
        agreements.length > 0
          ? (agreements[0] as { contractId: string }).contractId
          : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/xreserve/deposits — start a deposit
// ---------------------------------------------------------------------------

router.post('/deposits', requireParty(),(req: Request, res: Response) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const cantonParty = req.partyId!;
  const deposit = xreserveClient.createDeposit({
    cantonParty,
    evmAddress: parsed.data.evmAddress,
    amount: parsed.data.amount,
  });

  const params = xreserveClient.buildDepositParams(cantonParty);

  res.json({
    success: true,
    deposit,
    transaction: {
      xReserveContract: params.chain.xReserveContract,
      usdcContract: params.chain.usdcContract,
      chainId: params.chain.chainId,
      cantonDomain: params.cantonDomain,
      remoteRecipient: params.remoteRecipient,
      hookData: params.hookData,
      maxFee: '0',
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/xreserve/deposits/:id/burn — record burn tx
// ---------------------------------------------------------------------------

router.post('/deposits/:id/burn', requireParty(),(req: Request, res: Response) => {
  const parsed = burnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const deposit = xreserveClient.getDeposit(String(req.params.id));
  if (!deposit) {
    res.status(404).json({ success: false, error: 'Deposit not found' });
    return;
  }
  if (deposit.cantonParty !== req.partyId) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const updated = xreserveClient.recordBurnTx(
    deposit.id,
    parsed.data.burnTxHash,
  );
  res.json({ success: true, deposit: updated });
});

// ---------------------------------------------------------------------------
// POST /api/xreserve/deposits/:id/claim — exercise Mint to receive USDCx
// ---------------------------------------------------------------------------

router.post(
  '/deposits/:id/claim',
  requireParty(),
  async (req: Request, res: Response) => {
    const deposit = xreserveClient.getDeposit(String(req.params.id));
    if (!deposit) {
      res.status(404).json({ success: false, error: 'Deposit not found' });
      return;
    }
    if (deposit.cantonParty !== req.partyId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    if (deposit.status !== 'attested' || !deposit.attestationContractId) {
      res.status(400).json({
        success: false,
        error: `Deposit not ready for claim (status=${deposit.status})`,
      });
      return;
    }

    try {
      // Find the user's BridgeUserAgreement
      const agreements = await ledger.query(
        BRIDGE_TEMPLATES.UserAgreement,
        deposit.cantonParty,
      );
      if (agreements.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No BridgeUserAgreement — complete onboarding first',
        });
        return;
      }
      const agreementCid = (agreements[0] as { contractId: string }).contractId;

      // Fetch BurnMintFactory from DA utility backend (with local ledger fallback)
      let factoryCid: string = req.body?.factoryCid ?? '';
      let contextContractIds: string[] = req.body?.contextContractIds ?? [];
      if (!factoryCid) {
        const factory = await xreserveClient.fetchMintFactory();
        if (!factory) {
          res.status(503).json({
            success: false,
            error:
              'Cannot fetch BurnMintFactory from Digital Asset utility backend. ' +
              'Mint requires operator coordination. Please use the xReserve UI at ' +
              'https://digital-asset.github.io/xreserve-deposits/ to claim, ' +
              'or contact DA support to authorize factory access for Roil.',
          });
          return;
        }
        factoryCid = factory.factoryCid;
        contextContractIds = factory.contextContractIds;
      }

      const result = await ledger.exercise(
        BRIDGE_TEMPLATES.UserAgreement,
        agreementCid,
        'BridgeUserAgreement_Mint',
        {
          depositAttestationCid: deposit.attestationContractId,
          factoryCid,
          contextContractIds,
        },
        [deposit.cantonParty],
      );

      const txId =
        result?.transaction?.events?.find(
          (e: { CreatedEvent?: { contractId: string } }) => e.CreatedEvent,
        )?.CreatedEvent?.contractId ?? 'unknown';
      xreserveClient.markMinted(deposit.id, txId);

      logger.info('[xreserve] Mint completed', {
        depositId: deposit.id,
        txId,
      });

      res.json({
        success: true,
        deposit: xreserveClient.getDeposit(deposit.id),
        txId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[xreserve] Mint failed', {
        depositId: deposit.id,
        error: msg,
      });
      res.status(500).json({ success: false, error: msg });
    }
  },
);

router.get('/deposits', requireParty(),(req: Request, res: Response) => {
  const deposits = xreserveClient.getDepositsByParty(req.partyId!);
  res.json({ success: true, deposits });
});

router.get('/deposits/:id', requireParty(),(req: Request, res: Response) => {
  const deposit = xreserveClient.getDeposit(String(req.params.id));
  if (!deposit) {
    res.status(404).json({ success: false, error: 'Deposit not found' });
    return;
  }
  if (deposit.cantonParty !== req.partyId) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  res.json({ success: true, deposit });
});

// ---------------------------------------------------------------------------
// POST /api/xreserve/withdrawals — exercise Burn on BridgeUserAgreement
// ---------------------------------------------------------------------------

router.post(
  '/withdrawals',
  requireParty(),
  async (req: Request, res: Response) => {
    const parsed = withdrawSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const cantonParty = req.partyId!;
    const record = xreserveClient.createWithdrawal({
      cantonParty,
      destinationEvmAddress: parsed.data.destinationEvmAddress,
      amount: parsed.data.amount,
    });

    try {
      // Find the user's BridgeUserAgreement
      const agreements = await ledger.query(
        BRIDGE_TEMPLATES.UserAgreement,
        cantonParty,
      );
      if (agreements.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No BridgeUserAgreement — complete onboarding first',
        });
        return;
      }
      const agreementCid = (agreements[0] as { contractId: string }).contractId;

      // Encode EVM address as bytes32 (left-padded with zeros)
      const destBytes32 = `0x000000000000000000000000${parsed.data.destinationEvmAddress.slice(2).toLowerCase()}`;

      // Auto-select user's USDCx holdings to cover the burn amount
      let holdingCids: string[] = req.body?.holdingCids ?? [];
      if (holdingCids.length === 0) {
        holdingCids = await xreserveClient.selectHoldingsForBurn(
          cantonParty,
          parsed.data.amount,
        );
        logger.info('[xreserve] Auto-selected holdings for burn', {
          count: holdingCids.length,
          amount: parsed.data.amount,
        });
      }

      const result = await ledger.exercise(
        BRIDGE_TEMPLATES.UserAgreement,
        agreementCid,
        'BridgeUserAgreement_Burn',
        {
          amount: parsed.data.amount,
          destinationDomain: ETHEREUM_DOMAIN,
          destinationRecipient: destBytes32,
          holdingCids,
          requestId: record.id,
          reference: null,
        },
        [cantonParty],
      );

      const burnCid =
        result?.transaction?.events?.find(
          (e: { CreatedEvent?: { contractId: string } }) => e.CreatedEvent,
        )?.CreatedEvent?.contractId ?? 'unknown';

      xreserveClient.markWithdrawBurned(record.id, burnCid);

      logger.info('[xreserve] Withdrawal burn submitted', {
        withdrawId: record.id,
        burnCid,
      });

      res.json({
        success: true,
        withdrawal: xreserveClient.getWithdrawal(record.id),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[xreserve] Withdrawal failed', {
        withdrawId: record.id,
        error: msg,
      });
      res.status(500).json({ success: false, error: msg });
    }
  },
);

router.get('/withdrawals', requireParty(),(req: Request, res: Response) => {
  const withdrawals = xreserveClient.getWithdrawalsByParty(req.partyId!);
  res.json({ success: true, withdrawals });
});

router.get('/withdrawals/:id', requireParty(),(req: Request, res: Response) => {
  const withdrawal = xreserveClient.getWithdrawal(String(req.params.id));
  if (!withdrawal) {
    res.status(404).json({ success: false, error: 'Withdrawal not found' });
    return;
  }
  if (withdrawal.cantonParty !== req.partyId) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }
  res.json({ success: true, withdrawal });
});

export { router as xreserveRouter };
export default router;
