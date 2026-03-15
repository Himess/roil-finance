import { Router, type Request, type Response } from 'express';
import { cantex } from '../cantex.js';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = Router();

/**
 * GET /api/market/prices
 *
 * Get current prices of all supported assets in USDCx terms.
 */
marketRouter.get('/prices', async (_req: Request, res: Response) => {
  try {
    const prices = await cantex.getPrices();
    res.json({
      success: true,
      data: {
        prices,
        timestamp: new Date().toISOString(),
        source: 'cantex',
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
