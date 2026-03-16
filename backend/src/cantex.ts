import { config } from './config.js';
import { CantexError } from './utils/errors.js';
import { CantexRealClient } from './cantex-client.js';
import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Quote {
  fromAsset: string;
  toAsset: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  fee: number;
  slippage: number;
}

export interface SwapResult {
  txId: string;
  fromAsset: string;
  toAsset: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  timestamp: string;
}

export interface Balance {
  asset: string;
  amount: number;
}

export interface PoolInfo {
  pair: string;
  liquidity: number;
  volume24h: number;
  fee: number;
}

// ---------------------------------------------------------------------------
// Mock prices (used when useMock = true)
// ---------------------------------------------------------------------------

const MOCK_PRICES: Record<string, number> = { CC: 0.15, USDCx: 1.0, CBTC: 40_000.0 };
const BASE_FEE_PCT = 0.003;

function jitter(value: number): number {
  return value * (1 + (Math.random() - 0.5) * 0.004);
}

function generateTxId(): string {
  return `cantex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Python Cantex SDK bridge
// ---------------------------------------------------------------------------

// Python bridge removed — replaced with native TypeScript CantexRealClient

// ---------------------------------------------------------------------------
// CantexClient — dual mode (mock + real)
// ---------------------------------------------------------------------------

export class CantexClient {
  private readonly useMock: boolean;
  private readonly realClient: CantexRealClient | null;

  constructor() {
    this.useMock = !config.cantexOperatorKey || config.network === 'localnet';
    if (this.useMock) {
      this.realClient = null;
      logger.info('[Cantex] Running in MOCK mode (no Cantex keys configured)');
    } else {
      this.realClient = new CantexRealClient();
      logger.info(`[Cantex] Connected to ${config.cantexApiUrl} via native TS client`);
    }
  }

  // -----------------------------------------------------------------------
  // Quotes
  // -----------------------------------------------------------------------

  async getQuote(fromAsset: string, toAsset: string, amount: number): Promise<Quote> {
    if (fromAsset === toAsset) throw new Error('Cannot swap asset to itself');
    if (amount <= 0) throw new Error('Amount must be positive');

    if (this.useMock) {
      const fromPrice = jitter(MOCK_PRICES[fromAsset] ?? 1);
      const toPrice = jitter(MOCK_PRICES[toAsset] ?? 1);
      const rate = fromPrice / toPrice;
      const fee = amount * BASE_FEE_PCT;
      const output = (amount - fee) * rate;
      return { fromAsset, toAsset, inputAmount: amount, outputAmount: output, price: rate, fee, slippage: 0 };
    }

    const quote = await this.realClient!.getSwapQuote(
      amount, fromAsset, this.getAdmin(fromAsset),
      toAsset, this.getAdmin(toAsset),
    );

    return {
      fromAsset, toAsset,
      inputAmount: amount,
      outputAmount: quote.returnedAmount,
      price: quote.tradePrice,
      fee: quote.fees.amountAdmin + quote.fees.amountLiquidity + quote.fees.networkFee,
      slippage: quote.slippage,
    };
  }

  // -----------------------------------------------------------------------
  // Swap execution
  // -----------------------------------------------------------------------

  async executeSwap(fromAsset: string, toAsset: string, amount: number): Promise<SwapResult> {
    if (this.useMock) {
      const quote = await this.getQuote(fromAsset, toAsset, amount);
      return {
        txId: generateTxId(),
        fromAsset, toAsset,
        inputAmount: amount,
        outputAmount: quote.outputAmount,
        fee: quote.fee,
        timestamp: new Date().toISOString(),
      };
    }

    const result = await this.realClient!.executeSwap(
      amount, fromAsset, this.getAdmin(fromAsset),
      toAsset, this.getAdmin(toAsset),
    );

    return {
      txId: result.txId,
      fromAsset, toAsset,
      inputAmount: amount,
      outputAmount: result.outputAmount,
      fee: 0, // fee included in output
      timestamp: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Balances
  // -----------------------------------------------------------------------

  async getBalances(_party: string): Promise<Balance[]> {
    if (this.useMock) {
      return [
        { asset: 'CC', amount: jitter(50_000) },
        { asset: 'USDCx', amount: jitter(10_000) },
        { asset: 'CBTC', amount: jitter(0.25) },
      ];
    }

    const info = await this.realClient!.getAccountInfo();
    return info.balances.map(b => ({
      asset: b.instrumentId,
      amount: b.amount,
    }));
  }

  // -----------------------------------------------------------------------
  // Pool info
  // -----------------------------------------------------------------------

  async getPoolInfo(): Promise<PoolInfo[]> {
    if (this.useMock) {
      return [
        { pair: 'CC/USDCx', liquidity: jitter(2_000_000), volume24h: jitter(500_000), fee: BASE_FEE_PCT },
        { pair: 'CBTC/USDCx', liquidity: jitter(5_000_000), volume24h: jitter(1_200_000), fee: BASE_FEE_PCT },
      ];
    }

    const pools = await this.realClient!.getPoolsInfo();
    return pools.map(p => ({
      pair: `${p.tokenA.id}/${p.tokenB.id}`,
      liquidity: p.reserveA + p.reserveB,
      volume24h: 0, // not available from pools endpoint
      fee: BASE_FEE_PCT,
    }));
  }

  // -----------------------------------------------------------------------
  // Prices
  // -----------------------------------------------------------------------

  async getPrices(): Promise<Record<string, number>> {
    if (this.useMock) {
      return { CC: jitter(0.15), USDCx: 1.0, CBTC: jitter(40_000) };
    }

    // Get prices from Cantex quotes: price 1 unit of asset in USDCx
    const ccQuote = await this.getQuote('CC', 'USDCx', 1000);
    const cbtcQuote = await this.getQuote('CBTC', 'USDCx', 0.01);

    return {
      CC: ccQuote.outputAmount / 1000,
      USDCx: 1.0,
      CBTC: cbtcQuote.outputAmount / 0.01,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getAdmin(asset: string): string {
    const instruments: Record<string, string> = {
      CC: process.env.CC_ADMIN_PARTY || '',
      USDCx: process.env.USDCX_ADMIN_PARTY || '',
      CBTC: process.env.CBTC_ADMIN_PARTY || '',
    };
    return instruments[asset] || '';
  }
}

export const cantex = new CantexClient();
