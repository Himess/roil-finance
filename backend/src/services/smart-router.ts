import { cantex } from '../cantex.js';
import { templeClient } from './temple-client.js';
import { logger } from '../monitoring/logger.js';
import { config } from '../config.js';

/**
 * Smart Order Router — Canton DEX Aggregator
 *
 * Compares prices across multiple DEXes on Canton Network:
 * 1. Cantex (AMM) — CaviarNine
 * 2. Temple (Orderbook CLOB) — Temple Digital Group
 *
 * Selects the best price for each trade, similar to 1inch on Ethereum.
 */

export interface RouteQuote {
  source: 'cantex' | 'temple';
  fromAsset: string;
  toAsset: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  fee: number;
  priceImpact: number;
  savings: number; // how much better than the worse quote
  reason: string; // human-readable selection reason
}

export interface RoutedSwapResult {
  source: 'cantex' | 'temple';
  txId: string;
  fromAsset: string;
  toAsset: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  timestamp: string;
}

export class SmartRouter {
  /**
   * Get quotes from ALL available DEXes and return the best one.
   */
  async getBestQuote(fromAsset: string, toAsset: string, amount: number): Promise<RouteQuote> {
    const [cantexQuote, templeQuote] = await Promise.allSettled([
      this.getCantexQuote(fromAsset, toAsset, amount),
      this.getTempleQuote(fromAsset, toAsset, amount),
    ]);

    const quotes: RouteQuote[] = [];

    if (cantexQuote.status === 'fulfilled' && cantexQuote.value) {
      quotes.push(cantexQuote.value);
    }
    if (templeQuote.status === 'fulfilled' && templeQuote.value) {
      quotes.push(templeQuote.value);
    }

    if (quotes.length === 0) {
      throw new Error('No DEX quotes available');
    }

    // Sort by output amount (highest = best price)
    quotes.sort((a, b) => b.outputAmount - a.outputAmount);

    const best = quotes[0];
    const worst = quotes[quotes.length - 1];
    best.savings = quotes.length > 1 ? best.outputAmount - worst.outputAmount : 0;

    // Build a human-readable selection reason
    if (quotes.length === 1) {
      best.reason = `${best.source === 'cantex' ? 'Cantex' : 'Temple'} selected: only available DEX`;
    } else {
      const pctBetter = worst.outputAmount > 0
        ? ((best.outputAmount - worst.outputAmount) / worst.outputAmount * 100).toFixed(2)
        : '0.00';
      const otherSource = best.source === 'cantex' ? 'Temple' : 'Cantex';
      best.reason = `${best.source === 'cantex' ? 'Cantex' : 'Temple'} selected: better price by ${pctBetter}% vs ${otherSource}`;
    }

    logger.info('[SmartRouter] Best quote selected', {
      source: best.source,
      reason: best.reason,
      pair: `${fromAsset}->${toAsset}`,
      amount,
      output: best.outputAmount.toFixed(4),
      savings: best.savings.toFixed(4),
      quotesCompared: quotes.length,
    });

    return best;
  }

  /**
   * Execute swap on the best DEX.
   */
  async executeSwap(fromAsset: string, toAsset: string, amount: number): Promise<RoutedSwapResult> {
    // Get best quote first
    const bestQuote = await this.getBestQuote(fromAsset, toAsset, amount);

    logger.info('[SmartRouter] Executing swap', {
      source: bestQuote.source,
      pair: `${fromAsset}→${toAsset}`,
      amount,
      expectedOutput: bestQuote.outputAmount.toFixed(4),
    });

    if (bestQuote.source === 'temple') {
      const result = await templeClient.executeSwap(fromAsset, toAsset, amount);
      return {
        source: 'temple',
        txId: result.orderId,
        fromAsset,
        toAsset,
        inputAmount: amount,
        outputAmount: result.total,
        fee: result.fee,
        timestamp: result.timestamp,
      };
    }

    // Default: Cantex
    const result = await cantex.executeSwap(fromAsset, toAsset, amount);
    return {
      source: 'cantex',
      txId: result.txId,
      fromAsset,
      toAsset,
      inputAmount: amount,
      outputAmount: result.outputAmount,
      fee: result.fee,
      timestamp: result.timestamp,
    };
  }

  /**
   * Get quotes from ALL DEXes for comparison display.
   */
  async getAllQuotes(fromAsset: string, toAsset: string, amount: number): Promise<RouteQuote[]> {
    const [cantexQuote, templeQuote] = await Promise.allSettled([
      this.getCantexQuote(fromAsset, toAsset, amount),
      this.getTempleQuote(fromAsset, toAsset, amount),
    ]);

    const quotes: RouteQuote[] = [];
    if (cantexQuote.status === 'fulfilled' && cantexQuote.value) quotes.push(cantexQuote.value);
    if (templeQuote.status === 'fulfilled' && templeQuote.value) quotes.push(templeQuote.value);

    // Sort best first
    quotes.sort((a, b) => b.outputAmount - a.outputAmount);

    // Calculate savings for each
    if (quotes.length > 1) {
      const best = quotes[0].outputAmount;
      quotes.forEach(q => { q.savings = best - q.outputAmount; });
    }

    return quotes;
  }

  /**
   * Check which DEXes are available.
   */
  async getAvailableDexes(): Promise<{ name: string; available: boolean; type: string }[]> {
    const [cantexOk, templeOk] = await Promise.allSettled([
      cantex.isAvailable?.() ?? Promise.resolve(true),
      templeClient.isAvailable(),
    ]);

    return [
      { name: 'Cantex', available: cantexOk.status === 'fulfilled' && cantexOk.value === true, type: 'AMM' },
      { name: 'Temple', available: templeOk.status === 'fulfilled' && templeOk.value === true, type: 'Orderbook' },
    ];
  }

  // -----------------------------------------------------------------------
  // Private: per-DEX quote adapters
  // -----------------------------------------------------------------------

  private async getCantexQuote(fromAsset: string, toAsset: string, amount: number): Promise<RouteQuote | null> {
    try {
      const quote = await cantex.getQuote(fromAsset, toAsset, amount);
      return {
        source: 'cantex',
        fromAsset,
        toAsset,
        inputAmount: amount,
        outputAmount: quote.outputAmount,
        price: quote.price,
        fee: quote.fee,
        priceImpact: quote.slippage || 0,
        savings: 0,
        reason: '',
      };
    } catch (err) {
      logger.warn('[SmartRouter] Cantex quote failed', { error: String(err) });
      return null;
    }
  }

  private async getTempleQuote(fromAsset: string, toAsset: string, amount: number): Promise<RouteQuote | null> {
    try {
      const quote = await templeClient.getQuote(fromAsset, toAsset, amount);
      return {
        source: 'temple',
        fromAsset,
        toAsset,
        inputAmount: amount,
        outputAmount: quote.total,
        price: quote.price,
        fee: quote.fee,
        priceImpact: 0,
        savings: 0,
        reason: '',
      };
    } catch (err) {
      logger.warn('[SmartRouter] Temple quote failed', { error: String(err) });
      return null;
    }
  }
}

export const smartRouter = new SmartRouter();
