/**
 * CCTP routes — deposit/withdraw USDC via Circle's Cross-Chain Transfer Protocol.
 *
 * Flow:
 *  POST /api/cctp/deposit      — initiate deposit (returns contract addresses + deposit ID)
 *  POST /api/cctp/deposit/:id/burn — frontend reports burn tx hash
 *  GET  /api/cctp/deposit/:id  — check deposit status
 *  GET  /api/cctp/deposits     — list user's deposits
 *  POST /api/cctp/withdraw     — initiate withdrawal (backend burns on Canton)
 *  GET  /api/cctp/withdraw/:id — check withdrawal status
 *  GET  /api/cctp/chains       — list supported chains + addresses
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { cctpClient, type CCTPChain, CCTP_DOMAINS } from '../services/cctp-client.js';
import { requireParty } from '../middleware/auth.js';
import { logger } from '../monitoring/logger.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const SUPPORTED_CHAINS = Object.keys(CCTP_DOMAINS) as CCTPChain[];

const depositSchema = z.object({
  evmAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  sourceChain: z.enum(SUPPORTED_CHAINS as [CCTPChain, ...CCTPChain[]]),
  amount: z.string().regex(/^\d+$/, 'Amount must be positive integer (USDC wei, 6 decimals)'),
});

const burnTxSchema = z.object({
  burnTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid tx hash'),
});

const withdrawSchema = z.object({
  evmAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  destinationChain: z.enum(SUPPORTED_CHAINS as [CCTPChain, ...CCTPChain[]]),
  amount: z.string().regex(/^\d+$/, 'Amount must be positive integer'),
});

// ---------------------------------------------------------------------------
// GET /api/cctp/chains — supported chains and addresses
// ---------------------------------------------------------------------------

router.get('/chains', (_req: Request, res: Response) => {
  const chains = SUPPORTED_CHAINS.map(chain => ({
    id: chain,
    ...cctpClient.getChainAddresses(chain),
  }));

  res.json({
    success: true,
    cantonDomain: cctpClient.getCantonDomain(),
    chains,
  });
});

// ---------------------------------------------------------------------------
// POST /api/cctp/deposit — initiate deposit (EVM → Canton)
// ---------------------------------------------------------------------------

router.post('/deposit', requireParty, (req: Request, res: Response) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const cantonParty = req.partyId!;
  const { evmAddress, sourceChain, amount } = parsed.data;

  const deposit = cctpClient.createDeposit({
    cantonParty,
    evmAddress,
    sourceChain,
    amount,
  });

  const addresses = cctpClient.getChainAddresses(sourceChain);

  res.json({
    success: true,
    deposit,
    // Instructions for frontend to build the burn tx
    transaction: {
      tokenMessenger: addresses.tokenMessenger,
      usdc: addresses.usdc,
      destinationDomain: cctpClient.getCantonDomain(),
      // mintRecipient = Canton party (encoded as bytes32)
      mintRecipient: encodeCantonPartyAsBytes32(cantonParty),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/cctp/deposit/:id/burn — record burn tx hash
// ---------------------------------------------------------------------------

router.post('/deposit/:id/burn', requireParty, (req: Request, res: Response) => {
  const parsed = burnTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const deposit = cctpClient.getDeposit(String(req.params.id));
  if (!deposit) {
    res.status(404).json({ success: false, error: 'Deposit not found' });
    return;
  }

  // Only the depositor can submit burn tx
  if (deposit.cantonParty !== req.partyId) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return;
  }

  const updated = cctpClient.recordBurnTx(deposit.id, parsed.data.burnTxHash);
  res.json({ success: true, deposit: updated });
});

// ---------------------------------------------------------------------------
// GET /api/cctp/deposit/:id — check deposit status
// ---------------------------------------------------------------------------

router.get('/deposit/:id', requireParty, (req: Request, res: Response) => {
  const deposit = cctpClient.getDeposit(String(req.params.id));
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
// GET /api/cctp/deposits — list deposits for authenticated party
// ---------------------------------------------------------------------------

router.get('/deposits', requireParty, (req: Request, res: Response) => {
  const deposits = cctpClient.getDepositsByParty(req.partyId!);
  res.json({ success: true, deposits });
});

// ---------------------------------------------------------------------------
// POST /api/cctp/withdraw — initiate withdrawal (Canton → EVM)
// ---------------------------------------------------------------------------

router.post('/withdraw', requireParty, (req: Request, res: Response) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const cantonParty = req.partyId!;
  const { evmAddress, destinationChain, amount } = parsed.data;

  // TODO: Actually burn USDCx on Canton via Splice token standard
  // For now, just create the withdrawal record
  const withdrawal = cctpClient.createWithdrawal({
    cantonParty,
    evmAddress,
    destinationChain,
    amount,
  });

  logger.info('[cctp] Withdrawal initiated', {
    id: withdrawal.id,
    party: cantonParty,
    chain: destinationChain,
    amount,
  });

  res.json({ success: true, withdrawal });
});

// ---------------------------------------------------------------------------
// GET /api/cctp/withdraw/:id — withdrawal status
// ---------------------------------------------------------------------------

router.get('/withdraw/:id', requireParty, (req: Request, res: Response) => {
  const withdrawal = cctpClient.getWithdrawal(String(req.params.id));
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a Canton party ID as bytes32 for CCTP's mintRecipient field.
 *
 * CCTP expects a 32-byte recipient address. For EVM chains this is the
 * address padded with zeros. For Canton, we use a hash of the party ID.
 *
 * The Canton-side MessageTransmitter contract resolves this back to the
 * actual party during mint.
 */
function encodeCantonPartyAsBytes32(partyId: string): string {
  // Use Node's crypto to hash (party IDs can be arbitrarily long)
  const hash = require('node:crypto').createHash('sha256').update(partyId).digest('hex');
  return `0x${hash}`;
}

export { router as cctpRouter };
export default router;
