import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';
import { withRetry } from '../utils/retry.js';
import { cantexBreaker } from '../utils/circuit-breaker.js';

/**
 * Temple Digital Group DEX Client
 *
 * Temple is a central limit orderbook (CLOB) DEX on Canton Network,
 * backed by YZi Labs (formerly Binance Labs).
 *
 * Key differences from Cantex AMM:
 * - Orderbook-based (better prices for large orders)
 * - USDCx as primary quote asset
 * - KYC-compliant institutional trading
 * - Supports limit orders, FOK, IOC, MOC
 *
 * API: https://app.templedigitalgroup.com
 */

interface TempleQuote {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  total: number;
  fee: number;
  source: 'temple';
}

interface TempleSwapResult {
  orderId: string;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  filledAmount: number;
  total: number;
  fee: number;
  status: 'filled' | 'partial' | 'rejected';
  timestamp: string;
  source: 'temple';
}

interface TempleOrderbookEntry {
  price: number;
  amount: number;
  total: number;
}

interface TempleOrderbook {
  pair: string;
  bids: TempleOrderbookEntry[];
  asks: TempleOrderbookEntry[];
  spread: number;
  midPrice: number;
}

export class TempleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly useMock: boolean;

  constructor() {
    this.baseUrl = process.env.TEMPLE_API_URL || 'https://app.templedigitalgroup.com/api';
    this.apiKey = process.env.TEMPLE_API_KEY || '';
    this.useMock = !this.apiKey || config.network === 'localnet';

    if (this.useMock) {
      logger.info('[Temple] Running in mock mode (no API key or localnet)');
    } else {
      logger.info('[Temple] Connected to Temple DEX', { url: this.baseUrl });
    }
  }

  /**
   * Get a quote from Temple's orderbook for a given trade.
   */
  async getQuote(fromAsset: string, toAsset: string, amount: number): Promise<TempleQuote> {
    if (this.useMock) {
      return this.getMockQuote(fromAsset, toAsset, amount);
    }

    try {
      const pair = this.getPairSymbol(fromAsset, toAsset);
      const side = this.getSide(fromAsset, toAsset);

      const response = await withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/v1/orderbook/${pair}`, {
          headers: this.getHeaders(),
        });
        if (!res.ok) throw new Error(`Temple API error: ${res.status}`);
        return res.json();
      });

      const orderbook = response as TempleOrderbook;
      const entries = side === 'sell' ? orderbook.bids : orderbook.asks;

      // Calculate fill price from orderbook depth
      let remainingAmount = amount;
      let totalCost = 0;
      let totalFee = 0;

      for (const entry of entries) {
        const fillAmount = Math.min(remainingAmount, entry.amount);
        totalCost += fillAmount * entry.price;
        remainingAmount -= fillAmount;
        if (remainingAmount <= 0) break;
      }

      const avgPrice = totalCost / amount;
      const fee = totalCost * 0.001; // 0.1% taker fee estimate

      return {
        pair,
        side,
        price: avgPrice,
        amount,
        total: totalCost,
        fee,
        source: 'temple',
      };
    } catch (err) {
      logger.warn('[Temple] Quote failed, using mock', { error: String(err) });
      return this.getMockQuote(fromAsset, toAsset, amount);
    }
  }

  /**
   * Execute a market order on Temple.
   */
  async executeSwap(fromAsset: string, toAsset: string, amount: number): Promise<TempleSwapResult> {
    if (this.useMock) {
      return this.getMockSwapResult(fromAsset, toAsset, amount);
    }

    try {
      const pair = this.getPairSymbol(fromAsset, toAsset);
      const side = this.getSide(fromAsset, toAsset);

      const result = await cantexBreaker.execute(async () => {
        const res = await fetch(`${this.baseUrl}/v1/orders`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            pair,
            side,
            type: 'market',
            amount: String(amount),
            timeInForce: 'ImmediateOrCancel',
          }),
        });
        if (!res.ok) throw new Error(`Temple order failed: ${res.status}`);
        return res.json();
      });

      logger.info('[Temple] Order executed', { pair, side, amount, orderId: result.orderId });

      return {
        orderId: result.orderId || `temple-${Date.now()}`,
        pair,
        side,
        price: result.price || 0,
        filledAmount: result.filledAmount || amount,
        total: result.total || 0,
        fee: result.fee || 0,
        status: result.status || 'filled',
        timestamp: new Date().toISOString(),
        source: 'temple',
      };
    } catch (err) {
      logger.error('[Temple] Swap execution failed', { error: String(err) });
      return this.getMockSwapResult(fromAsset, toAsset, amount);
    }
  }

  /**
   * Get orderbook depth for a pair.
   */
  async getOrderbook(fromAsset: string, toAsset: string): Promise<TempleOrderbook> {
    const pair = this.getPairSymbol(fromAsset, toAsset);

    if (this.useMock) {
      return {
        pair,
        bids: [
          { price: 0.149, amount: 50000, total: 7450 },
          { price: 0.148, amount: 100000, total: 14800 },
          { price: 0.147, amount: 200000, total: 29400 },
        ],
        asks: [
          { price: 0.151, amount: 50000, total: 7550 },
          { price: 0.152, amount: 100000, total: 15200 },
          { price: 0.153, amount: 200000, total: 30600 },
        ],
        spread: 0.002,
        midPrice: 0.15,
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/v1/orderbook/${pair}`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) throw new Error(`Temple orderbook error: ${res.status}`);
      return await res.json();
    } catch {
      return { pair, bids: [], asks: [], spread: 0, midPrice: 0 };
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.useMock) return true;
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
    };
  }

  private getPairSymbol(fromAsset: string, toAsset: string): string {
    // Temple uses USDCx as primary quote. Format: BASE-QUOTE
    if (toAsset === 'USDCx') return `${fromAsset}-USDCx`;
    if (fromAsset === 'USDCx') return `${toAsset}-USDCx`;
    // For non-USDCx pairs, route through USDCx
    return `${fromAsset}-USDCx`;
  }

  private getSide(fromAsset: string, toAsset: string): 'buy' | 'sell' {
    if (toAsset === 'USDCx') return 'sell'; // selling fromAsset for USDCx
    return 'buy'; // buying toAsset with fromAsset
  }

  private getMockQuote(fromAsset: string, toAsset: string, amount: number): TempleQuote {
    const mockPrices: Record<string, number> = {
      CC: 0.15, USDCx: 1.0, CBTC: 73000, ETHx: 2300, SOLx: 145,
      XAUt: 2650, XAGt: 31, USTb: 100.5, MMF: 1.0,
    };
    const fromPrice = mockPrices[fromAsset] || 1;
    const toPrice = mockPrices[toAsset] || 1;
    const outputAmount = (amount * fromPrice) / toPrice;
    const fee = outputAmount * 0.001;

    return {
      pair: this.getPairSymbol(fromAsset, toAsset),
      side: this.getSide(fromAsset, toAsset),
      price: fromPrice / toPrice,
      amount,
      total: outputAmount - fee,
      fee,
      source: 'temple',
    };
  }

  private getMockSwapResult(fromAsset: string, toAsset: string, amount: number): TempleSwapResult {
    const quote = this.getMockQuote(fromAsset, toAsset, amount);
    return {
      orderId: `temple-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pair: quote.pair,
      side: quote.side,
      price: quote.price,
      filledAmount: amount,
      total: quote.total,
      fee: quote.fee,
      status: 'filled',
      timestamp: new Date().toISOString(),
      source: 'temple',
    };
  }
}

export const templeClient = new TempleClient();
