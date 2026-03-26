import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireParty } from '../middleware/auth.js';
import { whitelistManager } from '../services/whitelist.js';
import {
  treasurySwapEngine,
  type SwapQuote,
} from '../engine/treasury.js';
import { priceOracle } from '../services/price-oracle.js';
import { logger } from '../monitoring/logger.js';
import {
  decimalToNumber,
  numberToDecimal,
  decimalMul,
  DECIMAL_ZERO,
} from '../utils/decimal.js';

// ---------------------------------------------------------------------------
// Middleware: whitelist check
// ---------------------------------------------------------------------------

/**
 * Middleware that verifies the caller is whitelisted before allowing access
 * to swap endpoints. Extracts partyId from the authenticated request.
 */
function requireWhitelist(req: Request, res: Response, next: () => void): void {
  const partyId = req.partyId || req.body?.partyId;
  if (!partyId) {
    res.status(400).json({ success: false, error: 'partyId is required' });
    return;
  }

  if (!whitelistManager.isWhitelisted(partyId)) {
    res.status(403).json({
      success: false,
      error: 'Not whitelisted. Join the whitelist first at POST /api/whitelist/join',
    });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const SwapQuoteSchema = z.object({
  partyId: z.string().min(1),
  fromAsset: z.string().min(1).max(10),
  toAsset: z.string().min(1).max(10),
  fromAmount: z.string().min(1).regex(
    /^\d+(\.\d+)?$/,
    'fromAmount must be a valid positive decimal string',
  ),
});

const SwapExecuteSchema = z.object({
  partyId: z.string().min(1),
  quoteId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const swapRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/swap/quote — Get a swap quote
// ---------------------------------------------------------------------------

swapRouter.post('/quote', requireWhitelist, async (req: Request, res: Response) => {
  try {
    const parsed = SwapQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }

    const { partyId, fromAsset, toAsset, fromAmount } = parsed.data;

    // Calculate USD value for limit checks
    let amountUsd = DECIMAL_ZERO;
    try {
      const price = await priceOracle.getPrice(fromAsset);
      amountUsd = decimalMul(fromAmount, numberToDecimal(price.priceUsdcx));
    } catch {
      // If price unavailable, use the raw amount as estimate
      amountUsd = fromAmount;
    }

    // Check whitelist limits (daily + per-trade)
    const check = whitelistManager.canSwap(partyId, amountUsd);
    if (!check.allowed) {
      return res.status(429).json({
        success: false,
        error: check.reason,
        remaining: check.remaining,
      });
    }

    // Get quote from treasury engine
    const quote = await treasurySwapEngine.getQuote(fromAsset, toAsset, fromAmount);

    res.json({
      success: true,
      data: {
        quoteId: quote.id,
        fromAsset: quote.fromAsset,
        toAsset: quote.toAsset,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
        oraclePrice: quote.oraclePrice,
        spread: quote.spread,
        spreadAmount: quote.spreadAmount,
        expiresAt: quote.expiresAt,
        expiresIn: Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000)),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[swap] Quote failed', { error: message });
    res.status(400).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/swap/execute — Execute a swap using a quote
// ---------------------------------------------------------------------------

swapRouter.post('/execute', requireWhitelist, async (req: Request, res: Response) => {
  try {
    const parsed = SwapExecuteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }

    const { partyId, quoteId } = parsed.data;

    // Execute swap
    const result = await treasurySwapEngine.executeSwap(quoteId, partyId);

    if (result.success) {
      // Record usage for daily limits
      let amountUsd = DECIMAL_ZERO;
      try {
        const price = await priceOracle.getPrice(result.fromAsset);
        amountUsd = decimalMul(result.fromAmount, numberToDecimal(price.priceUsdcx));
      } catch {
        amountUsd = result.fromAmount;
      }
      whitelistManager.recordSwap(partyId, amountUsd);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[swap] Execute failed', { error: message });

    // Distinguish user errors from server errors
    const isUserError = [
      'Quote not found',
      'Quote has expired',
      'Insufficient treasury',
      'paused',
    ].some(s => message.includes(s));

    res.status(isUserError ? 400 : 500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/swap/history — User's swap history
// ---------------------------------------------------------------------------

swapRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const partyId = req.query.partyId as string || req.partyId;
    if (!partyId) {
      return res.status(400).json({ success: false, error: 'partyId is required' });
    }

    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const history = treasurySwapEngine.getSwapHistory(partyId, limit);

    res.json({
      success: true,
      data: history,
      meta: { count: history.length, limit },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/swap/limits — User's daily limits and remaining
// ---------------------------------------------------------------------------

swapRouter.get('/limits', async (req: Request, res: Response) => {
  try {
    const partyId = req.query.partyId as string || req.partyId;
    if (!partyId) {
      return res.status(400).json({ success: false, error: 'partyId is required' });
    }

    const entry = whitelistManager.getUserInfo(partyId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'User not found in whitelist',
      });
    }

    const tc = (await import('../config.js')).config as any;
    const dailyLimit = tc.treasury?.dailyLimitUsd ?? '50.0';
    const maxTrade = tc.treasury?.maxTradeUsd ?? '25.0';

    const dailyVolume = treasurySwapEngine.getUserDailyVolume(partyId);

    res.json({
      success: true,
      data: {
        partyId,
        dailyLimit,
        dailyUsed: entry.dailySwapUsed,
        dailyRemaining: (() => {
          const used = decimalToNumber(entry.dailySwapUsed);
          const limit = decimalToNumber(dailyLimit);
          return numberToDecimal(Math.max(0, limit - used));
        })(),
        maxTradeSize: maxTrade,
        treasuryVolume: dailyVolume,
        lastSwapDate: entry.lastSwapDate || null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/swap/pairs — Available trading pairs with current prices
// ---------------------------------------------------------------------------

swapRouter.get('/pairs', async (_req: Request, res: Response) => {
  try {
    const pairs = await treasurySwapEngine.getPairs();

    res.json({
      success: true,
      data: pairs,
      meta: { count: pairs.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/swap/health — Treasury health (admin diagnostic)
// ---------------------------------------------------------------------------

swapRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await treasurySwapEngine.getHealth();
    res.json({ success: true, data: health });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
