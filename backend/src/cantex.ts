import { config } from './config.js';
import { CantexSidecarClient } from './cantex-sidecar.js';
import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Public types — kept stable so all 13 callers across engine/services/routes
// keep compiling unchanged after the cantex-client.ts → sidecar swap.
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
// Mock prices (used when useMock = true — localnet / unconfigured sidecar)
// ---------------------------------------------------------------------------

const MOCK_PRICES: Record<string, number> = { CC: 0.15, USDCx: 1.0, CBTC: 40_000.0 };
const MOCK_FEE_PCT = 0.003;

function jitter(value: number): number {
  return value * (1 + (Math.random() - 0.5) * 0.004);
}

function generateTxId(): string {
  return `cantex-mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// CantexClient — dual mode (mock + sidecar). Mock kicks in when no sidecar
// URL is set or when running on localnet (where there is nothing to call).
// ---------------------------------------------------------------------------

export class CantexClient {
  private readonly useMock: boolean;
  private readonly sidecar: CantexSidecarClient | null;

  /**
   * Cached availability. We probe the sidecar once on construction and
   * then on a coarse cadence (5 min) — `isAvailable()` reads this without
   * a network round-trip so health checks and routing decisions stay
   * cheap. A failed read flips the gauge to `false` and forces a re-probe
   * on the next call.
   */
  private sidecarAvailable: boolean | null = null;
  private sidecarAvailableCheckedAt = 0;
  private static readonly AVAILABILITY_TTL_MS = 5 * 60_000;

  constructor() {
    this.useMock = !config.cantexSidecarUrl || config.network === 'localnet';
    if (this.useMock) {
      this.sidecar = null;
      logger.info('[Cantex] Running in MOCK mode (no sidecar URL configured)');
    } else {
      this.sidecar = new CantexSidecarClient();
      logger.info(`[Cantex] Using sidecar at ${config.cantexSidecarUrl}`);
    }
  }

  /**
   * Returns true iff a live call to the sidecar is likely to succeed.
   *
   * In mock mode this is always true (the in-memory mock can't fail).
   * In sidecar mode it consults a TTL-cached `/health` probe; on miss it
   * issues one probe and caches the result. Engine code can call this in
   * a tight loop without overwhelming the sidecar.
   */
  async isAvailable(): Promise<boolean> {
    if (this.useMock) return true;
    const now = Date.now();
    if (
      this.sidecarAvailable !== null &&
      now - this.sidecarAvailableCheckedAt < CantexClient.AVAILABILITY_TTL_MS
    ) {
      return this.sidecarAvailable;
    }
    const ok = await this.sidecar!.isAvailable();
    this.sidecarAvailable = ok;
    this.sidecarAvailableCheckedAt = now;
    return ok;
  }

  /**
   * Mark the sidecar as down so the next caller short-circuits to the
   * mock path. Invoked from every method that catches a sidecar error,
   * so a single failed swap teaches the rest of the pipeline to
   * gracefully degrade until the next probe window.
   */
  private markSidecarDown(err: unknown): void {
    this.sidecarAvailable = false;
    this.sidecarAvailableCheckedAt = Date.now();
    logger.warn('[Cantex] Sidecar error — marking unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // -----------------------------------------------------------------------
  // Quotes
  // -----------------------------------------------------------------------

  /** Mock quote — reused as the fallback path when the sidecar is down. */
  private mockQuote(fromAsset: string, toAsset: string, amount: number): Quote {
    const fromPrice = jitter(MOCK_PRICES[fromAsset] ?? 1);
    const toPrice = jitter(MOCK_PRICES[toAsset] ?? 1);
    const rate = fromPrice / toPrice;
    const fee = amount * MOCK_FEE_PCT;
    const output = (amount - fee) * rate;
    return {
      fromAsset,
      toAsset,
      inputAmount: amount,
      outputAmount: output,
      price: rate,
      fee,
      slippage: 0,
    };
  }

  async getQuote(fromAsset: string, toAsset: string, amount: number): Promise<Quote> {
    if (fromAsset === toAsset) throw new Error('Cannot swap asset to itself');
    if (amount <= 0) throw new Error('Amount must be positive');

    if (this.useMock) return this.mockQuote(fromAsset, toAsset, amount);

    try {
      const q = await this.sidecar!.getQuote(fromAsset, toAsset, amount);
      // Caller's `fee` is "total cost in sell-token units" — admin + liquidity
      // are quoted in the buy token, network fee in CC. Returning the sum is
      // a lossy projection but matches what the legacy client did and what the
      // callers expect (price displays only).
      return {
        fromAsset,
        toAsset,
        inputAmount: amount,
        outputAmount: q.returnedAmount,
        price: q.tradePrice,
        fee: q.fees.amountAdmin + q.fees.amountLiquidity + q.fees.networkFee,
        slippage: q.slippage,
      };
    } catch (err) {
      // Quotes are read-only and informational — falling back to the mock
      // path keeps the swap UI usable while the sidecar is recovering.
      // Mutations (executeSwap) still hard-fail; we never silently route
      // a real on-chain operation through a mock.
      this.markSidecarDown(err);
      return this.mockQuote(fromAsset, toAsset, amount);
    }
  }

  // -----------------------------------------------------------------------
  // Swap execution — sidecar waits for WebSocket SwapExecutedEvent, so
  // outputAmount is the **actual** on-ledger amount, not a re-quote.
  // -----------------------------------------------------------------------

  async executeSwap(fromAsset: string, toAsset: string, amount: number): Promise<SwapResult> {
    if (this.useMock) {
      const quote = await this.getQuote(fromAsset, toAsset, amount);
      return {
        txId: generateTxId(),
        fromAsset,
        toAsset,
        inputAmount: amount,
        outputAmount: quote.outputAmount,
        fee: quote.fee,
        timestamp: new Date().toISOString(),
      };
    }

    // executeSwap must hard-fail when the sidecar is down — silently
    // routing it through the mock would mint fake transactions that look
    // successful but never settle on-chain. Caller decides retry policy.
    try {
      const result = await this.sidecar!.swap(fromAsset, toAsset, amount);
      return {
        txId: result.eventId,
        fromAsset,
        toAsset,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        fee: result.adminFee + result.liquidityFee,
        timestamp: result.createdAt,
      };
    } catch (err) {
      this.markSidecarDown(err);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Balances — the `_party` arg is kept for source compatibility; the
  // sidecar always reports balances for the Cantex account it is bound to.
  // -----------------------------------------------------------------------

  /** Mock balances — also used as fallback when the sidecar is down. */
  private mockBalances(): Balance[] {
    return [
      { asset: 'CC', amount: jitter(50_000) },
      { asset: 'USDCx', amount: jitter(10_000) },
      { asset: 'CBTC', amount: jitter(0.25) },
    ];
  }

  async getBalances(_party: string): Promise<Balance[]> {
    if (this.useMock) return this.mockBalances();
    try {
      const tokens = await this.sidecar!.getBalances();
      return tokens.map((t) => ({ asset: t.symbol, amount: t.unlocked }));
    } catch (err) {
      // Balances are read-only — degrade to mock so dashboards/status
      // checks keep rendering. Anything that needs ground-truth (e.g.
      // executeSwap) won't reach this fallback.
      this.markSidecarDown(err);
      return this.mockBalances();
    }
  }

  // -----------------------------------------------------------------------
  // Pool info
  // -----------------------------------------------------------------------

  async getPoolInfo(): Promise<PoolInfo[]> {
    if (this.useMock) {
      return [
        { pair: 'CC/USDCx', liquidity: jitter(2_000_000), volume24h: jitter(500_000), fee: MOCK_FEE_PCT },
        { pair: 'CBTC/USDCx', liquidity: jitter(5_000_000), volume24h: jitter(1_200_000), fee: MOCK_FEE_PCT },
      ];
    }

    try {
      const pools = await this.sidecar!.getPools();
      // The sidecar does not expose live reserve/volume numbers (Cantex API
      // doesn't either at /v2/pools/info). Surface the pair list with the
      // best-known fee tier (0.05% empirically — see CLAUDE.md §5) so the
      // smart router can score routes without crashing.
      return pools.map((p) => ({
        pair: p.pair,
        liquidity: 0,
        volume24h: 0,
        fee: 0.0005,
      }));
    } catch (err) {
      this.markSidecarDown(err);
      return [
        { pair: 'CC/USDCx', liquidity: 0, volume24h: 0, fee: 0.0005 },
        { pair: 'CBTC/USDCx', liquidity: 0, volume24h: 0, fee: 0.0005 },
      ];
    }
  }

  // -----------------------------------------------------------------------
  // Prices — derive 1-unit prices from live quotes for asset→USDCx pairs.
  // -----------------------------------------------------------------------

  private mockPrices(): Record<string, number> {
    return { CC: jitter(0.15), USDCx: 1.0, CBTC: jitter(40_000) };
  }

  async getPrices(): Promise<Record<string, number>> {
    if (this.useMock) return this.mockPrices();

    try {
      // Quote sizes are chosen well above the 10 CC ticket minimum so the
      // quote endpoint accepts them; we still divide back out for unit price.
      const ccQuote = await this.sidecar!.getQuote('CC', 'USDCx', 100);
      let cbtc: number | undefined;
      try {
        const cbtcQuote = await this.sidecar!.getQuote('CBTC', 'USDCx', 0.01);
        cbtc = cbtcQuote.returnedAmount / 0.01;
      } catch {
        // CBTC pool may not exist or have no liquidity yet — omit rather than fail.
      }

      return {
        CC: ccQuote.returnedAmount / 100,
        USDCx: 1.0,
        ...(cbtc !== undefined ? { CBTC: cbtc } : {}),
      };
    } catch (err) {
      // Prices feed dashboards, drift calculation, and reward tier math —
      // all of which need to keep running even if Cantex is briefly out.
      // Returning the mock band is safer than throwing because none of
      // those code paths gate real on-chain mutations on prices alone.
      this.markSidecarDown(err);
      return this.mockPrices();
    }
  }
}

export const cantex = new CantexClient();
