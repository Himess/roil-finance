/**
 * HTTP client for the Roil Cantex sidecar (`sidecars/cantex/app.py`).
 *
 * The sidecar wraps the official Python `cantex_sdk` so we get correct
 * challenge-response auth, secp256k1 intent signing, and WebSocket-based
 * swap confirmation without re-implementing them in TypeScript.
 *
 * All endpoints are symbol-based (`CC`, `USDCx`, `CBTC`, …); the sidecar
 * resolves symbols to Daml `InstrumentId`s internally.
 */
import { config } from './config.js';
import { withRetry } from './utils/retry.js';
import { cantexBreaker } from './utils/circuit-breaker.js';
import { CantexError } from './utils/errors.js';
import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Sidecar response shapes (mirror sidecars/cantex/app.py models)
// ---------------------------------------------------------------------------

interface HealthResp {
  ok: boolean;
  base_url: string;
  party_address: string;
  instruments: string[];
}

interface TokenBalanceResp {
  symbol: string;
  unlocked: string;
  locked: string;
}

interface BalanceResp {
  party_address: string;
  tokens: TokenBalanceResp[];
}

interface PoolDescriptorResp {
  contract_id: string;
  pair: string;
  token_a_symbol: string;
  token_b_symbol: string;
}

interface PoolsResp {
  pools: PoolDescriptorResp[];
}

interface QuoteResp {
  sell: string;
  buy: string;
  sell_amount: string;
  returned_amount: string;
  returned_symbol: string;
  trade_price: string;
  slippage: string;
  fee_percentage: string;
  admin_fee: string;
  liquidity_fee: string;
  network_fee_cc: string;
  estimated_seconds: string;
  pools_used: number;
}

interface SwapResp {
  event_id: string;
  market: string;
  input_amount: string;
  input_symbol: string;
  output_amount: string;
  output_symbol: string;
  admin_fee_amount: string;
  liquidity_fee_amount: string;
  price: string;
  created_at: string;
}

interface TransferResp {
  transfer_id: string | null;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public shape — matches what cantex.ts exposes to the rest of the backend
// ---------------------------------------------------------------------------

export interface SidecarSwapQuote {
  tradePrice: number;
  slippage: number;
  returnedAmount: number;
  fees: {
    feePercentage: number;
    amountAdmin: number;
    amountLiquidity: number;
    networkFee: number;
  };
  estimatedTimeSeconds: number;
}

export interface SidecarSwapResult {
  eventId: string;
  market: string;
  inputAmount: number;
  outputAmount: number;
  adminFee: number;
  liquidityFee: number;
  price: number;
  createdAt: string;
}

export interface SidecarBalance {
  symbol: string;
  unlocked: number;
  locked: number;
}

export interface SidecarPool {
  contractId: string;
  pair: string;
  tokenA: string;
  tokenB: string;
}

export interface SidecarTransferResult {
  transferId: string | null;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CantexSidecarClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor() {
    this.baseUrl = config.cantexSidecarUrl.replace(/\/$/, '');
    this.authToken = config.cantexSidecarAuthToken;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return cantexBreaker.execute(() =>
      withRetry(
        async () => {
          // Swaps can take 60+ seconds (WebSocket confirmation). The
          // per-request timeout has to be generous enough to cover the
          // worst case, but tight on read-only endpoints. The sidecar
          // itself enforces a 120 s timeout for /swap.
          // Swaps and transfers can take 60+ seconds on the slow path
          // (WebSocket confirmation for swaps; mediator round-trip for
          // transfers). The per-request timeout has to cover that.
          const isSlow = path === '/swap' || path === '/transfer';
          const headers: Record<string, string> = {};
          if (body) headers['Content-Type'] = 'application/json';
          if (this.authToken) headers['X-Sidecar-Auth'] = this.authToken;

          const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(isSlow ? 150_000 : 15_000),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new CantexError(
              `sidecar ${method} ${path}: ${res.status} ${text.slice(0, 200)}`,
            );
          }
          return (await res.json()) as T;
        },
        // Only retry idempotent reads. /swap and /transfer must never be
        // retried — the sidecar may have already submitted the on-chain
        // intent or transaction, so a retry could double-spend.
        path === '/swap' || path === '/transfer'
          ? { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 }
          : { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
      ),
    );
  }

  async health(): Promise<HealthResp> {
    return this.request<HealthResp>('GET', '/health');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const h = await this.health();
      return h.ok;
    } catch (err) {
      logger.warn('[Cantex/sidecar] health check failed', { error: String(err) });
      return false;
    }
  }

  async getBalances(): Promise<SidecarBalance[]> {
    const resp = await this.request<BalanceResp>('GET', '/balance');
    return resp.tokens.map((t) => ({
      symbol: t.symbol,
      unlocked: Number(t.unlocked),
      locked: Number(t.locked),
    }));
  }

  async getPools(): Promise<SidecarPool[]> {
    const resp = await this.request<PoolsResp>('GET', '/pools');
    return resp.pools.map((p) => ({
      contractId: p.contract_id,
      pair: p.pair,
      tokenA: p.token_a_symbol,
      tokenB: p.token_b_symbol,
    }));
  }

  async getQuote(
    sell: string,
    buy: string,
    amount: number,
  ): Promise<SidecarSwapQuote> {
    const resp = await this.request<QuoteResp>('POST', '/quote', {
      sell,
      buy,
      amount: String(amount),
    });
    return {
      tradePrice: Number(resp.trade_price),
      slippage: Number(resp.slippage),
      returnedAmount: Number(resp.returned_amount),
      fees: {
        feePercentage: Number(resp.fee_percentage),
        amountAdmin: Number(resp.admin_fee),
        amountLiquidity: Number(resp.liquidity_fee),
        networkFee: Number(resp.network_fee_cc),
      },
      estimatedTimeSeconds: Number(resp.estimated_seconds),
    };
  }

  async swap(
    sell: string,
    buy: string,
    amount: number,
    opts: { maxNetworkFee?: number; timeoutSeconds?: number } = {},
  ): Promise<SidecarSwapResult> {
    const resp = await this.request<SwapResp>('POST', '/swap', {
      sell,
      buy,
      amount: String(amount),
      max_network_fee:
        opts.maxNetworkFee !== undefined ? String(opts.maxNetworkFee) : null,
      timeout_seconds: opts.timeoutSeconds ?? 120,
    });
    return {
      eventId: resp.event_id,
      market: resp.market,
      inputAmount: Number(resp.input_amount),
      outputAmount: Number(resp.output_amount),
      adminFee: Number(resp.admin_fee_amount),
      liquidityFee: Number(resp.liquidity_fee_amount),
      price: Number(resp.price),
      createdAt: resp.created_at,
    };
  }

  /**
   * Move tokens *out* of the Cantex account to another Daml party (typically
   * back to the Roil validator wallet to rebalance liquidity).
   *
   * The sidecar signs with the operator key — no intent key needed. The
   * call does NOT auto-retry on failure (transfers may already have been
   * submitted on-ledger), so callers needing retry must do so themselves
   * with an idempotency key on the receiver side.
   */
  async transfer(args: {
    symbol: string;
    amount: number;
    receiver: string;
    memo?: string;
  }): Promise<SidecarTransferResult> {
    const resp = await this.request<TransferResp>('POST', '/transfer', {
      symbol: args.symbol,
      amount: String(args.amount),
      receiver: args.receiver,
      memo: args.memo ?? '',
    });
    return { transferId: resp.transfer_id, raw: resp.raw };
  }
}
