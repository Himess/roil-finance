import { Router, type Request, type Response } from 'express';
import { cantex } from '../cantex.js';
import { priceOracle } from '../services/price-oracle.js';
import { scanClient } from '../services/scan-client.js';
import { smartRouter } from '../services/smart-router.js';
import { templeClient } from '../services/temple-client.js';
import { config, INSTRUMENTS } from '../config.js';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = Router();

/**
 * GET /api/market/instruments
 *
 * Return the per-asset admin party map so the frontend can build correct
 * AssetId payloads without hardcoding `Canton::Admin` placeholder strings.
 *
 * Public — the admin party IDs are already visible on-chain and needed for
 * every user interaction.
 */
marketRouter.get('/instruments', (_req: Request, res: Response) => {
  const instruments = Object.entries(INSTRUMENTS).map(([symbol, info]) => ({
    symbol,
    admin: info.admin,
  }));
  res.json({ success: true, data: { instruments, network: config.network } });
});

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

/**
 * GET /api/market/quote
 *
 * Get a swap quote from Cantex without executing.
 * Query parameters: from, to, amount
 */
marketRouter.get('/quote', async (req, res) => {
  try {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) {
      return res.status(400).json({ success: false, error: 'from, to, amount required' });
    }
    const quote = await cantex.getQuote(String(from), String(to), Number(amount));
    res.json({ success: true, data: quote });
  } catch {
    res.json({ success: true, data: null, note: 'Quote not available' });
  }
});

/**
 * GET /api/market/network
 *
 * Canton Network stats from Scan API.
 */
marketRouter.get('/network', async (_req, res) => {
  try {
    const [rounds, apps] = await Promise.all([
      scanClient.getOpenRounds(),
      scanClient.getFeaturedApps(),
    ]);
    res.json({
      success: true,
      data: {
        openRounds: rounds,
        featuredApps: apps,
        network: config.network,
      },
    });
  } catch {
    res.json({ success: true, data: { openRounds: [], featuredApps: [], network: config.network } });
  }
});

// ---------------------------------------------------------------------------
// Smart Router (DEX Aggregator) endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/market/best-quote?from=CC&to=USDCx&amount=100
 *
 * Get the best quote across all available DEXes (Cantex AMM + Temple CLOB).
 */
marketRouter.get('/best-quote', async (req, res) => {
  try {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) {
      return res.status(400).json({ success: false, error: 'from, to, amount required' });
    }
    const quote = await smartRouter.getBestQuote(String(from), String(to), Number(amount));
    res.json({ success: true, data: quote });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to get best quote' });
  }
});

/**
 * GET /api/market/compare-quotes?from=CC&to=USDCx&amount=100
 *
 * Get quotes from ALL DEXes for side-by-side comparison.
 */
marketRouter.get('/compare-quotes', async (req, res) => {
  try {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) {
      return res.status(400).json({ success: false, error: 'from, to, amount required' });
    }
    const quotes = await smartRouter.getAllQuotes(String(from), String(to), Number(amount));
    res.json({ success: true, data: quotes });
  } catch {
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/market/dexes
 *
 * List available DEXes and their status.
 */
marketRouter.get('/dexes', async (_req, res) => {
  try {
    const dexes = await smartRouter.getAvailableDexes();
    res.json({ success: true, data: dexes });
  } catch {
    res.json({ success: true, data: [] });
  }
});

/**
 * GET /api/market/orderbook?from=CC&to=USDCx
 *
 * Get Temple DEX orderbook depth for a trading pair.
 */
marketRouter.get('/orderbook', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, error: 'from, to required' });
    }
    const orderbook = await templeClient.getOrderbook(String(from), String(to));
    res.json({ success: true, data: orderbook });
  } catch {
    res.json({ success: true, data: null });
  }
});
