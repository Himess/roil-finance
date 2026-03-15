import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { tokenTransferService } from '../services/token-transfer.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const SwapSchema = z.object({
  user: z.string().min(1),
  sellAsset: z.string().min(1),
  sellAmount: z.number().positive(),
  buyAsset: z.string().min(1),
  expectedBuyAmount: z.number().nonnegative(),
});

const TransferSchema = z.object({
  sender: z.string().min(1),
  receiver: z.string().min(1),
  instrumentId: z.string().min(1),
  amount: z.number().positive(),
  memo: z.string().optional().default(''),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const transfersRouter = Router();

/**
 * GET /api/transfers/:party/holdings
 *
 * Get CIP-0056 token holdings for a party.
 * In network mode, queries real Holdings from the Canton ledger.
 * In internal mode, queries Cantex balances.
 */
transfersRouter.get('/:party/holdings', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const holdings = await tokenTransferService.queryHoldings(party!);

    res.json({
      success: true,
      data: {
        party,
        holdings,
        totalAssets: holdings.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/transfers/swap
 *
 * Initiate and execute a token swap via Cantex.
 * Creates a SwapRequest on the Daml ledger, executes the swap,
 * and records the result as a SwapLog.
 */
transfersRouter.post('/swap', async (req: Request, res: Response) => {
  try {
    const parsed = SwapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const { user, sellAsset, sellAmount, buyAsset, expectedBuyAmount } = parsed.data;

    if (sellAsset === buyAsset) {
      res.status(400).json({ success: false, error: 'Sell and buy assets must be different' });
      return;
    }

    const result = await tokenTransferService.executeSwap(
      user,
      sellAsset,
      sellAmount,
      buyAsset,
      expectedBuyAmount,
    );

    if (result.success) {
      res.status(201).json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, error: result.error, data: result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/transfers/send
 *
 * Initiate a direct token transfer between two parties.
 * In network mode, creates a CIP-0056 TransferInstruction + our TransferRequest.
 * In internal mode, creates only our TransferRequest.
 */
transfersRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const parsed = TransferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const { sender, receiver, instrumentId, amount, memo } = parsed.data;

    if (sender === receiver) {
      res.status(400).json({ success: false, error: 'Sender and receiver must be different' });
      return;
    }

    const contractId = await tokenTransferService.initiateTransfer(
      sender,
      receiver,
      instrumentId,
      amount,
      memo,
    );

    res.status(201).json({
      success: true,
      data: {
        contractId,
        sender,
        receiver,
        instrumentId,
        amount,
        memo,
        status: 'Pending',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/transfers/:party/history
 *
 * Get combined transfer and swap history for a party.
 * Returns TransferLog and SwapLog entries sorted by timestamp (newest first).
 */
transfersRouter.get('/:party/history', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const history = await tokenTransferService.getTransferHistory(party!);

    res.json({
      success: true,
      data: {
        party,
        entries: history,
        totalEntries: history.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/transfers/:party/pending
 *
 * Get pending transfers and swaps for a party.
 */
transfersRouter.get('/:party/pending', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;

    const [pendingTransfers, pendingSwaps] = await Promise.all([
      tokenTransferService.getPendingTransfers(party!),
      tokenTransferService.getPendingSwaps(party!),
    ]);

    res.json({
      success: true,
      data: {
        party,
        transfers: pendingTransfers.map((c) => ({
          contractId: c.contractId,
          ...c.payload,
        })),
        swaps: pendingSwaps.map((c) => ({
          contractId: c.contractId,
          ...c.payload,
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
