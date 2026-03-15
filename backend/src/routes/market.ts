import { Router, type Request, type Response } from 'express';
import { cantex } from '../cantex.js';
import { priceOracle } from '../services/price-oracle.js';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = Router();

/**
 * GET /api/market/prices
 *
 * Get current prices of all supported assets in USDCx terms.
 * Enhanced with caching, confidence scoring, and 24h change data
 * from the PriceOracle.
 */
marketRouter.get('/prices', async (_req: Request, res: Response) => {
  try {
    const priceData = await priceOracle.getAllPrices();
    res.json({
      success: true,
      data: {
        prices: priceData,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/market/pools
 *
 * Get Cantex liquidity pool information.
 */
marketRouter.get('/pools', async (_req: Request, res: Response) => {
  try {
    const pools = await cantex.getPoolInfo();
    res.json({
      success: true,
      data: {
        pools,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/market/history/:asset
 *
 * Get price history for an asset, suitable for charting.
 * Query parameter `hours` controls the time window (default: 24).
 */
marketRouter.get('/history/:asset', async (req: Request, res: Response) => {
  try {
    const { asset } = req.params as Record<string, string>;
    const hours = Number(req.query.hours) || 24;

    if (hours < 1 || hours > 168) {
      res.status(400).json({
        success: false,
        error: 'hours must be between 1 and 168',
      });
      return;
    }

    const history = await priceOracle.getPriceHistory(asset!, hours);

    res.json({
      success: true,
      data: {
        asset: asset!,
        hours,
        points: history,
        count: history.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/market/convert
 *
 * Convert an amount between two assets using cached prices.
 * Query parameters: from, to, amount
 */
marketRouter.get('/convert', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const amountStr = req.query.amount as string | undefined;

    if (!from || !to || !amountStr) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameters: from, to, amount',
      });
      return;
    }

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({
        success: false,
        error: 'amount must be a positive number',
      });
      return;
    }

    const result = await priceOracle.convert(from, to, amount);

    res.json({
      success: true,
      data: {
        from,
        to,
        inputAmount: amount,
        outputAmount: result,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
