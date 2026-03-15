import { spawn } from 'node:child_process';
import { config } from './config.js';
import { withRetry } from './utils/retry.js';
import { cantexBreaker } from './utils/circuit-breaker.js';
import { CantexError } from './utils/errors.js';

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

/**
 * Execute a Cantex SDK command via Python subprocess.
 * The Cantex SDK is Python-only, so we bridge via a thin Python script.
 */
async function callCantexPython(command: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const script = `
import asyncio, json, sys, os
sys.path.insert(0, os.environ.get('CANTEX_SDK_PATH', '.'))

from cantex_sdk import CantexSDK, OperatorKeySigner, IntentTradingKeySigner

async def main():
    op_key = os.environ.get('CANTEX_OPERATOR_KEY', '')
    tr_key = os.environ.get('CANTEX_TRADING_KEY', '')
    base_url = os.environ.get('CANTEX_BASE_URL', '')

    op_signer = OperatorKeySigner(bytes.fromhex(op_key))
    tr_signer = IntentTradingKeySigner(bytes.fromhex(tr_key))

    async with CantexSDK(op_signer, tr_signer, base_url=base_url) as sdk:
        await sdk.authenticate()
        cmd = json.loads(sys.argv[1])
        args = json.loads(sys.argv[2])

        if cmd == 'get_quote':
            result = await sdk.get_swap_quote(
                args['amount'], args['sell_id'], args['sell_admin'],
                args['buy_id'], args['buy_admin']
            )
            print(json.dumps({'price': float(result.price), 'output': float(result.buy_amount),
                             'fee': float(result.fees.total_fee)}))

        elif cmd == 'swap':
            result = await sdk.swap(
                args['amount'], args['sell_id'], args['sell_admin'],
                args['buy_id'], args['buy_admin']
            )
            print(json.dumps({'success': True, 'tx_id': str(result)}))

        elif cmd == 'get_account':
            info = await sdk.get_account_info()
            balances = []
            for b in info.balances:
                balances.append({'asset': b.instrument_id, 'amount': float(b.unlocked_amount)})
            print(json.dumps(balances))

        elif cmd == 'get_pools':
            pools = await sdk.get_pool_info()
            result = []
            for p in pools.pools:
                result.append({'pair': f"{p.instrument_a_id}/{p.instrument_b_id}",
                              'liquidity': float(p.total_liquidity)})
            print(json.dumps(result))

asyncio.run(main())
`;

    const env = {
      ...process.env,
      CANTEX_OPERATOR_KEY: config.cantexOperatorKey,
      CANTEX_TRADING_KEY: config.cantexTradingKey,
      CANTEX_BASE_URL: config.cantexApiUrl,
    };

    const proc = spawn('python3', ['-c', script, command, JSON.stringify(args)], {
      env,
      timeout: 30_000,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new CantexError(`Cantex Python bridge failed (code ${code}): ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new CantexError(`Cantex Python bridge returned invalid JSON: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new CantexError(`Cantex Python bridge spawn failed: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// CantexClient — dual mode (mock + real)
// ---------------------------------------------------------------------------

export class CantexClient {
  private readonly useMock: boolean;

  constructor() {
    // Use mock if no Cantex keys configured or on localnet
    this.useMock = !config.cantexOperatorKey || config.network === 'localnet';
    if (this.useMock) {
      console.log('[Cantex] Running in MOCK mode (no Cantex keys configured)');
    } else {
      console.log(`[Cantex] Connected to ${config.cantexApiUrl}`);
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

    const result = await cantexBreaker.execute(() =>
      withRetry(
        () => callCantexPython('get_quote', {
          amount,
          sell_id: fromAsset,
          sell_admin: this.getAdmin(fromAsset),
          buy_id: toAsset,
          buy_admin: this.getAdmin(toAsset),
        }),
        { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
      ),
    ) as { price: number; output: number; fee: number };

    return {
      fromAsset, toAsset,
      inputAmount: amount,
      outputAmount: result.output,
      price: result.price,
      fee: result.fee,
      slippage: 0,
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

    const result = await cantexBreaker.execute(() =>
      withRetry(
        () => callCantexPython('swap', {
          amount,
          sell_id: fromAsset,
          sell_admin: this.getAdmin(fromAsset),
          buy_id: toAsset,
          buy_admin: this.getAdmin(toAsset),
        }),
        { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000 },
      ),
    ) as { tx_id: string };

    // Re-query to get the exact output amount
    const quote = await this.getQuote(fromAsset, toAsset, amount);

    return {
      txId: result.tx_id,
      fromAsset, toAsset,
      inputAmount: amount,
      outputAmount: quote.outputAmount,
      fee: quote.fee,
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

    return await cantexBreaker.execute(() =>
      withRetry(
        () => callCantexPython('get_account', {}),
        { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
      ),
    ) as Balance[];
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

    return await cantexBreaker.execute(() =>
      withRetry(
        () => callCantexPython('get_pools', {}),
        { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
      ),
    ) as PoolInfo[];
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
