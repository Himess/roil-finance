import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';
import { withRetry } from '../utils/retry.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TempleQuote {
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  total: number;
  fee: number;
  source: 'temple';
}

export interface TempleSwapResult {
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

export interface TempleOrderbookEntry {
  price: number;
  amount: number;
  total: number;
}

export interface TempleOrderbook {
  pair: string;
  bids: TempleOrderbookEntry[];
  asks: TempleOrderbookEntry[];
  spread: number;
  midPrice: number;
}

// ---------------------------------------------------------------------------
// Dedicated circuit breaker for Temple (separate from Cantex)
// ---------------------------------------------------------------------------

const templeBreaker = new CircuitBreaker({
  name: 'Temple DEX',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  successThreshold: 2,
});

// ---------------------------------------------------------------------------
// TempleClient
// ---------------------------------------------------------------------------

export class TempleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly useMock: boolean;

  constructor() {
    this.baseUrl = config.templeApiUrl;
    this.apiKey = config.templeApiKey;
    this.useMock = !this.apiKey || config.network === 'localnet';

    if (this.useMock) {
      logger.info('[Temple] Running in mock mode (no API key or localnet)');
    } else {
      logger.info('[Temple] Connected to Temple DEX', { url: this.baseUrl });
    }
  }

  // -----------------------------------------------------------------------
  // Quote
  // -----------------------------------------------------------------------

  /**
   * Get a quote from Temple's orderbook for a given trade.
   *
   * Real mode: GET /v1/orderbook/:pair -> walk the book to compute fill price.
   * Mock mode: returns synthetic quote from hardcoded prices.
   */
  async getQuote(fromAsset: string, toAsset: string, amount: number): Promise<TempleQuote> {
    if (this.useMock) {
      return this.getMockQuote(fromAsset, toAsset, amount);
    }

    const pair = this.getPairSymbol(fromAsset, toAsset);
    const side = this.getSide(fromAsset, toAsset);

    const orderbook = await this.fetchOrderbook(pair);
    const entries = side === 'sell' ? orderbook.bids : orderbook.asks;

    if (entries.length === 0) {
      throw new Error(`Temple: no ${side === 'sell' ? 'bids' : 'asks'} for ${pair}`);
    }

    // Walk the orderbook to compute volume-weighted average fill price
    let remainingAmount = amount;
    let totalCost = 0;

    for (const entry of entries) {
      const fillAmount = Math.min(remainingAmount, entry.amount);
      totalCost += fillAmount * entry.price;
      remainingAmount -= fillAmount;
      if (remainingAmount <= 0) break;
    }

    // If the book doesn't have enough depth, the remaining amount is unfilled
    if (remainingAmount > 0) {
      logger.warn('[Temple] Partial fill — insufficient orderbook depth', {
        pair, amount, unfilled: remainingAmount,
      });
    }

    const filledAmount = amount - remainingAmount;
    const avgPrice = filledAmount > 0 ? totalCost / filledAmount : 0;
    const fee = totalCost * 0.001; // 0.1% taker fee

    return {
      pair,
      side,
      price: avgPrice,
      amount: filledAmount,
      total: totalCost - fee,
      fee,
      source: 'temple',
    };
  }

  // -----------------------------------------------------------------------
  // Swap execution
  // -----------------------------------------------------------------------

  /**
   * Execute a market order on Temple.
   *
   * POST /v1/orders { pair, side, type: "market", amount, timeInForce }
   */
  async executeSwap(fromAsset: string, toAsset: string, amount: number): Promise<TempleSwapResult> {
    if (this.useMock) {
      return this.getMockSwapResult(fromAsset, toAsset, amount);
    }

    const pair = this.getPairSymbol(fromAsset, toAsset);
    const side = this.getSide(fromAsset, toAsset);

    const result: any = await templeBreaker.execute(() =>
      withRetry(async () => {
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
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Temple order failed (${res.status}): ${body}`);
        }
        return res.json();
      }, { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 }),
    );

    logger.info('[Temple] Order executed', { pair, side, amount, orderId: result.orderId });

    return {
      orderId: result.orderId || `temple-${Date.now()}`,
      pair,
      side,
      price: Number(result.price || 0),
      filledAmount: Number(result.filledAmount || amount),
      total: Number(result.total || 0),
      fee: Number(result.fee || 0),
      status: result.status || 'filled',
      timestamp: result.timestamp || new Date().toISOString(),
      source: 'temple',
    };
  }

  // -----------------------------------------------------------------------
  // Orderbook
  // -----------------------------------------------------------------------

  /**
   * Get orderbook depth for a pair.
   *
   * GET /v1/orderbook/:pair
   */
  async getOrderbook(fromAsset: string, toAsset: string): Promise<TempleOrderbook> {
    const pair = this.getPairSymbol(fromAsset, toAsset);

    if (this.useMock) {
      return this.getMockOrderbook(pair);
    }

    try {
      return await this.fetchOrderbook(pair);
    } catch (err) {
      logger.warn('[Temple] Orderbook fetch failed', { pair, error: String(err) });
      return { pair, bids: [], asks: [], spread: 0, midPrice: 0 };
    }
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    if (this.useMock) return true;
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Internal: HTTP helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch orderbook from Temple API with retry and circuit breaker.
   */
  private async fetchOrderbook(pair: string): Promise<TempleOrderbook> {
    return templeBreaker.execute(() =>
      withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/v1/orderbook/${pair}`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Temple API error (${res.status}): ${body}`);
        }
        const raw: any = await res.json();
        return {
          pair: raw.pair || pair,
          bids: Array.isArray(raw.bids) ? raw.bids.map(this.parseOrderbookEntry) : [],
          asks: Array.isArray(raw.asks) ? raw.asks.map(this.parseOrderbookEntry) : [],
          spread: Number(raw.spread || 0),
          midPrice: Number(raw.midPrice || raw.mid_price || 0),
        } as TempleOrderbook;
      }, { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 }),
    );
  }

  private parseOrderbookEntry(entry: any): TempleOrderbookEntry {
    return {
      price: Number(entry.price || 0),
      amount: Number(entry.amount || entry.quantity || 0),
      total: Number(entry.total || 0),
    };
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
    };
  }

  // -----------------------------------------------------------------------
  // Internal: pair/side helpers
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Mock implementations
  // -----------------------------------------------------------------------

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

  private getMockOrderbook(pair: string): TempleOrderbook {
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
}

export const templeClient = new TempleClient();
