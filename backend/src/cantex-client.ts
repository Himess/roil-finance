/**
 * Cantex DEX TypeScript Client
 *
 * Native TypeScript implementation of the Cantex REST API.
 * Replaces the Python subprocess bridge with direct HTTP calls.
 *
 * Auth: Ed25519 challenge-response → Bearer token
 * Swaps: secp256k1 intent signing → atomic on-chain settlement
 *
 * API: https://api.cantex.io (mainnet) / https://api.testnet.cantex.io (testnet)
 * Docs: https://docs.cantex.io
 */

import * as crypto from 'node:crypto';
import { config } from './config.js';
import { withRetry } from './utils/retry.js';
import { cantexBreaker } from './utils/circuit-breaker.js';
import { CantexError } from './utils/errors.js';
import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CantexConfig {
  baseUrl: string;
  operatorKey: string;   // Ed25519 private key hex
  tradingKey: string;    // secp256k1 private key hex
}

export interface TokenBalance {
  instrumentId: string;
  instrumentAdmin: string;
  amount: number;
  locked: number;
}

export interface AccountInfo {
  balances: TokenBalance[];
  pendingTransfers: number;
  expiredAllocations: number;
}

export interface AccountAdmin {
  partyAddress: string;
  instruments: Array<{ id: string; admin: string }>;
  hasIntentAccount: boolean;
}

export interface PoolInfo {
  contractId: string;
  tokenA: { id: string; admin: string };
  tokenB: { id: string; admin: string };
  reserveA: number;
  reserveB: number;
}

export interface SwapQuote {
  tradePrice: number;
  slippage: number;
  estimatedTimeSeconds: number;
  poolPriceBefore: number;
  poolPriceAfter: number;
  returnedAmount: number;
  returnedInstrument: { id: string; admin: string };
  fees: {
    feePercentage: number;
    amountAdmin: number;
    amountLiquidity: number;
    networkFee: number;
  };
}

export interface SwapResult {
  txId: string;
  status: 'submitted' | 'confirmed' | 'failed';
  inputAmount: number;
  outputAmount: number;
}

export interface BuildResult {
  id: string;
  transactionHash?: string;  // for operator TXs
  digest?: string;           // for intent swaps
}

// ---------------------------------------------------------------------------
// Ed25519 Signing
// ---------------------------------------------------------------------------

function ed25519Sign(message: string, privateKeyHex: string): string {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  // Node.js crypto Ed25519 signing
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      // Ed25519 PKCS8 prefix
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKey.subarray(0, 32), // Ed25519 seed is 32 bytes
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const sig = crypto.sign(null, Buffer.from(message), keyObject);
  return sig.toString('base64url');
}

function ed25519PublicKey(privateKeyHex: string): string {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKey.subarray(0, 32),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const pubKey = crypto.createPublicKey(keyObject);
  const pubDer = pubKey.export({ format: 'der', type: 'spki' });
  // Last 32 bytes of SPKI DER = raw public key
  return Buffer.from(pubDer).subarray(-32).toString('base64url');
}

// ---------------------------------------------------------------------------
// secp256k1 Signing (for swap intents)
// ---------------------------------------------------------------------------

function secp256k1Sign(digestHex: string, privateKeyHex: string): string {
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      // secp256k1 PKCS8 prefix (SEC1 wrapped)
      Buffer.from('30740201010420', 'hex'),
      privateKey,
      Buffer.from('a00706052b8104000aa144034200', 'hex'),
      // We need the public key here — compute it
      Buffer.alloc(65), // placeholder, will use different approach
    ]),
    format: 'der',
    type: 'sec1',
  });

  const sig = crypto.sign('sha256', Buffer.from(digestHex, 'hex'), {
    key: keyObject,
    dsaEncoding: 'der',
  });
  return sig.toString('hex');
}

// ---------------------------------------------------------------------------
// CantexRealClient — Direct REST API
// ---------------------------------------------------------------------------

export class CantexRealClient {
  private readonly baseUrl: string;
  private readonly operatorKey: string;
  private readonly tradingKey: string;
  private apiToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(cfg?: Partial<CantexConfig>) {
    this.baseUrl = cfg?.baseUrl || config.cantexApiUrl;
    this.operatorKey = cfg?.operatorKey || config.cantexOperatorKey;
    this.tradingKey = cfg?.tradingKey || config.cantexTradingKey;
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  private async authenticate(): Promise<string> {
    // Return cached token if still valid
    if (this.apiToken && Date.now() < this.tokenExpiresAt) {
      return this.apiToken;
    }

    logger.info('Authenticating with Cantex API', { baseUrl: this.baseUrl });

    // Step 1: Begin challenge
    const pubKey = ed25519PublicKey(this.operatorKey);
    const beginRes = await fetch(`${this.baseUrl}/v1/auth/api-key/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: pubKey }),
    });

    if (!beginRes.ok) {
      throw new CantexError(`Auth begin failed: ${await beginRes.text()}`);
    }

    const { message, challengeId } = await beginRes.json() as { message: string; challengeId: string };

    // Step 2: Sign and finish
    const signature = ed25519Sign(message, this.operatorKey);
    const finishRes = await fetch(`${this.baseUrl}/v1/auth/api-key/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, signature }),
    });

    if (!finishRes.ok) {
      throw new CantexError(`Auth finish failed: ${await finishRes.text()}`);
    }

    const { api_key } = await finishRes.json() as { api_key: string };
    this.apiToken = api_key;
    this.tokenExpiresAt = Date.now() + 3600_000; // 1 hour
    logger.info('Cantex API authenticated');
    return api_key;
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async authGet<T>(path: string): Promise<T> {
    return cantexBreaker.execute(() =>
      withRetry(async () => {
        const token = await this.authenticate();
        const res = await fetch(`${this.baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new CantexError(`GET ${path}: ${res.status} ${await res.text()}`);
        return res.json() as Promise<T>;
      }, { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 }),
    );
  }

  private async authPost<T>(path: string, body: unknown): Promise<T> {
    return cantexBreaker.execute(() =>
      withRetry(async () => {
        const token = await this.authenticate();
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new CantexError(`POST ${path}: ${res.status} ${await res.text()}`);
        return res.json() as Promise<T>;
      }, { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 }),
    );
  }

  // -----------------------------------------------------------------------
  // Account
  // -----------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const raw = await this.authGet<any>('/v1/account/info');
    return {
      balances: (raw.balances || []).map((b: any) => ({
        instrumentId: b.instrument_id || b.instrumentId,
        instrumentAdmin: b.instrument_admin || b.instrumentAdmin,
        amount: Number(b.unlocked_amount || b.amount || 0),
        locked: Number(b.locked_amount || b.locked || 0),
      })),
      pendingTransfers: raw.pending_transfers || 0,
      expiredAllocations: raw.expired_allocations || 0,
    };
  }

  async getAccountAdmin(): Promise<AccountAdmin> {
    const raw = await this.authGet<any>('/v1/account/admin');
    return {
      partyAddress: raw.party_address || raw.partyAddress || '',
      instruments: raw.instruments || [],
      hasIntentAccount: raw.has_intent_account || raw.hasIntentAccount || false,
    };
  }

  // -----------------------------------------------------------------------
  // Pools
  // -----------------------------------------------------------------------

  async getPoolsInfo(): Promise<PoolInfo[]> {
    const raw = await this.authGet<any>('/v2/pools/info');
    const pools = raw.pools || raw || [];
    return pools.map((p: any) => ({
      contractId: p.contract_id || p.contractId || '',
      tokenA: { id: p.token_a?.id || '', admin: p.token_a?.admin || '' },
      tokenB: { id: p.token_b?.id || '', admin: p.token_b?.admin || '' },
      reserveA: Number(p.reserve_a || 0),
      reserveB: Number(p.reserve_b || 0),
    }));
  }

  // -----------------------------------------------------------------------
  // Quote
  // -----------------------------------------------------------------------

  async getSwapQuote(
    sellAmount: number,
    sellInstrumentId: string,
    sellInstrumentAdmin: string,
    buyInstrumentId: string,
    buyInstrumentAdmin: string,
  ): Promise<SwapQuote> {
    const raw = await this.authPost<any>('/v2/pools/quote', {
      sellAmount: String(sellAmount),
      sellInstrumentId,
      sellInstrumentAdmin,
      buyInstrumentId,
      buyInstrumentAdmin,
    });

    return {
      tradePrice: Number(raw.trade_price || raw.tradePrice || 0),
      slippage: Number(raw.slippage || 0),
      estimatedTimeSeconds: Number(raw.estimated_time_seconds || 30),
      poolPriceBefore: Number(raw.pool_price_before_trade || 0),
      poolPriceAfter: Number(raw.pool_price_after_trade || 0),
      returnedAmount: Number(raw.returned?.amount || 0),
      returnedInstrument: {
        id: raw.returned?.instrument_id || '',
        admin: raw.returned?.instrument_admin || '',
      },
      fees: {
        feePercentage: Number(raw.fees?.fee_percentage || 0),
        amountAdmin: Number(raw.fees?.amount_admin || 0),
        amountLiquidity: Number(raw.fees?.amount_liquidity || 0),
        networkFee: Number(raw.fees?.network_fee || 0),
      },
    };
  }

  // -----------------------------------------------------------------------
  // Swap Execution (3-step: build → sign → submit)
  // -----------------------------------------------------------------------

  async executeSwap(
    sellAmount: number,
    sellInstrumentId: string,
    sellInstrumentAdmin: string,
    buyInstrumentId: string,
    buyInstrumentAdmin: string,
  ): Promise<SwapResult> {
    logger.info('Executing Cantex swap', {
      sell: `${sellAmount} ${sellInstrumentId}`,
      buy: buyInstrumentId,
    });

    // Step 1: Build swap intent
    const buildResult = await this.authPost<any>('/v1/intent/build/pool/swap', {
      sellAmount: String(sellAmount),
      sellInstrumentId,
      sellInstrumentAdmin,
      buyInstrumentId,
      buyInstrumentAdmin,
    });

    const buildId = buildResult.id;
    const digest = buildResult.digest;

    if (!buildId || !digest) {
      throw new CantexError('Swap build failed: no id or digest returned');
    }

    // Step 2: Sign digest with secp256k1 trading key
    let intentSignature: string;
    try {
      intentSignature = secp256k1Sign(digest, this.tradingKey);
    } catch (err) {
      throw new CantexError(`Failed to sign swap intent: ${err}`);
    }

    // Step 3: Submit signed intent
    const submitResult = await this.authPost<any>('/v1/intent/submit', {
      id: buildId,
      intentTradingKeySignature: intentSignature,
    });

    // Get quote for output amount estimation
    const quote = await this.getSwapQuote(
      sellAmount, sellInstrumentId, sellInstrumentAdmin,
      buyInstrumentId, buyInstrumentAdmin,
    );

    logger.info('Cantex swap submitted', { buildId, status: submitResult.status || 'submitted' });

    return {
      txId: buildId,
      status: submitResult.status || 'submitted',
      inputAmount: sellAmount,
      outputAmount: quote.returnedAmount,
    };
  }

  // -----------------------------------------------------------------------
  // Transfer
  // -----------------------------------------------------------------------

  async transfer(
    instrumentId: string,
    instrumentAdmin: string,
    receiver: string,
    amount: number,
    memo = '',
  ): Promise<string> {
    // Build transfer
    const buildResult = await this.authPost<any>('/v1/ledger/transaction/build/transfer', {
      instrumentId,
      instrumentAdmin,
      receiver,
      amount: String(amount),
      memo,
    });

    const buildId = buildResult.id;
    const txHash = buildResult.transaction_hash || buildResult.transactionHash;

    if (!buildId || !txHash) {
      throw new CantexError('Transfer build failed');
    }

    // Sign with operator key
    const signature = ed25519Sign(txHash, this.operatorKey);

    // Submit
    await this.authPost('/v1/ledger/transaction/submit', {
      id: buildId,
      operatorKeySignedTransactionHash: signature,
    });

    return buildId;
  }

  // -----------------------------------------------------------------------
  // Status check
  // -----------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/pools/info`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.status !== 0;
    } catch {
      return false;
    }
  }
}
