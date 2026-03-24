/**
 * Cantex DEX TypeScript Client
 *
 * Native TypeScript implementation of the Cantex REST API.
 * Replaces the Python subprocess bridge with direct HTTP calls.
 *
 * Auth: Ed25519 challenge-response -> Bearer token (auto-refreshed 60s before expiry)
 * Swaps: secp256k1 intent signing -> atomic on-chain settlement
 *
 * API: https://api.cantex.io (mainnet) / https://api.testnet.cantex.io (testnet)
 * Docs: https://docs.cantex.io
 */

import * as crypto from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { withRetry } from './utils/retry.js';
import { cantexBreaker } from './utils/circuit-breaker.js';
import { CantexError } from './utils/errors.js';
import { logger } from './monitoring/logger.js';

// ---------------------------------------------------------------------------
// Zod schemas for critical Cantex API response validation
// ---------------------------------------------------------------------------

const BalanceEntrySchema = z.object({
  instrument_id: z.string().optional(),
  instrumentId: z.string().optional(),
  unlocked_amount: z.union([z.string(), z.number()]).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  locked_amount: z.union([z.string(), z.number()]).optional(),
  locked: z.union([z.string(), z.number()]).optional(),
  instrument_admin: z.string().optional(),
  instrumentAdmin: z.string().optional(),
});

const AccountInfoResponseSchema = z.object({
  balances: z.array(BalanceEntrySchema),
  pending_transfers: z.number().optional(),
  expired_allocations: z.number().optional(),
});

const SwapQuoteResponseSchema = z.object({
  trade_price: z.union([z.string(), z.number()]).optional(),
  tradePrice: z.union([z.string(), z.number()]).optional(),
  slippage: z.union([z.string(), z.number()]).optional(),
  estimated_time_seconds: z.number().optional(),
  pool_price_before_trade: z.union([z.string(), z.number()]).optional(),
  pool_price_after_trade: z.union([z.string(), z.number()]).optional(),
  returned: z.object({
    amount: z.union([z.string(), z.number()]),
    instrument_id: z.string().optional(),
    instrument_admin: z.string().optional(),
  }).optional(),
  fees: z.object({
    fee_percentage: z.union([z.string(), z.number()]).optional(),
    amount_admin: z.union([z.string(), z.number()]).optional(),
    amount_liquidity: z.union([z.string(), z.number()]).optional(),
    network_fee: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

const SwapBuildResponseSchema = z.object({
  id: z.string(),
  digest: z.string(),
});

const SwapSubmitResponseSchema = z.object({
  status: z.string().optional(),
});

/** How many seconds before token expiry to trigger a proactive refresh */
const TOKEN_REFRESH_BUFFER_MS = 60_000; // 60 seconds

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

  // Derive the uncompressed public key from the private key using ECDH
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  const publicKey = ecdh.getPublicKey(); // 65 bytes uncompressed

  // Build a SEC1 DER-encoded key with the actual public key
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      // secp256k1 SEC1 prefix: SEQUENCE { INTEGER(1), OCTET STRING(32 bytes privkey),
      //   [0] OID(secp256k1), [1] BIT STRING(65 bytes pubkey) }
      Buffer.from('30740201010420', 'hex'),
      privateKey,
      Buffer.from('a00706052b8104000aa144034200', 'hex'),
      publicKey,
    ]),
    format: 'der',
    type: 'sec1',
  });

  // The digest is already hashed, so sign it directly without re-hashing
  const sig = crypto.sign(null, Buffer.from(digestHex, 'hex'), {
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

  /**
   * Authenticate with the Cantex API using Ed25519 challenge-response.
   *
   * Flow:
   *   1. POST /v1/auth/api-key/begin  { publicKey }  -> { message, challengeId }
   *   2. Sign `message` with Ed25519 operator key
   *   3. POST /v1/auth/api-key/finish { challengeId, signature } -> { api_key, expires_in? }
   *   4. Cache token, proactively refresh 60s before expiry
   *
   * The token is stored in `this.apiToken` and reused until it is within
   * TOKEN_REFRESH_BUFFER_MS of expiry, at which point a fresh token is
   * obtained transparently.
   */
  private async authenticate(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.apiToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.apiToken;
    }

    // If we are within the refresh buffer but token is not yet expired,
    // attempt a background refresh but return the current token if refresh fails
    if (this.apiToken && Date.now() < this.tokenExpiresAt) {
      try {
        return await this.performAuthentication();
      } catch (err) {
        logger.warn('[Cantex] Proactive token refresh failed, using existing token', {
          error: String(err),
          expiresInMs: this.tokenExpiresAt - Date.now(),
        });
        return this.apiToken;
      }
    }

    // Token expired or never obtained — must authenticate
    return this.performAuthentication();
  }

  /**
   * Execute the Ed25519 challenge-response authentication flow.
   */
  private async performAuthentication(): Promise<string> {
    logger.info('[Cantex] Authenticating with Cantex API', { baseUrl: this.baseUrl });

    // Step 1: Begin challenge — send Ed25519 public key
    const pubKey = ed25519PublicKey(this.operatorKey);
    const beginRes = await fetch(`${this.baseUrl}/v1/auth/api-key/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: pubKey }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!beginRes.ok) {
      const body = await beginRes.text();
      throw new CantexError(`Auth begin failed (${beginRes.status}): ${body}`);
    }

    const { message, challengeId } = await beginRes.json() as {
      message: string;
      challengeId: string;
    };

    // Step 2: Sign the challenge with Ed25519 operator key
    const signature = ed25519Sign(message, this.operatorKey);

    // Step 3: Complete challenge — exchange signature for Bearer token
    const finishRes = await fetch(`${this.baseUrl}/v1/auth/api-key/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, signature }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!finishRes.ok) {
      const body = await finishRes.text();
      throw new CantexError(`Auth finish failed (${finishRes.status}): ${body}`);
    }

    const authResult = await finishRes.json() as {
      api_key: string;
      expires_in?: number; // seconds, if provided by the API
    };

    // Step 4: Cache token with expiry
    this.apiToken = authResult.api_key;
    const ttlMs = (authResult.expires_in ?? 3600) * 1000; // default 1 hour
    this.tokenExpiresAt = Date.now() + ttlMs;

    logger.info('[Cantex] Authenticated successfully', {
      expiresInSeconds: Math.round(ttlMs / 1000),
    });
    return authResult.api_key;
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
    const raw = await this.authGet<unknown>('/v1/account/info');
    const parsed = AccountInfoResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CantexError(
        `Invalid getAccountInfo response: ${parsed.error.message}. Raw: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    const data = parsed.data;
    return {
      balances: data.balances.map((b) => ({
        instrumentId: b.instrument_id || b.instrumentId || '',
        instrumentAdmin: b.instrument_admin || b.instrumentAdmin || '',
        amount: Number(b.unlocked_amount || b.amount || 0),
        locked: Number(b.locked_amount || b.locked || 0),
      })),
      pendingTransfers: data.pending_transfers || 0,
      expiredAllocations: data.expired_allocations || 0,
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
    const raw = await this.authPost<unknown>('/v2/pools/quote', {
      sellAmount: String(sellAmount),
      sellInstrumentId,
      sellInstrumentAdmin,
      buyInstrumentId,
      buyInstrumentAdmin,
    });

    const parsed = SwapQuoteResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CantexError(
        `Invalid getSwapQuote response: ${parsed.error.message}. Raw: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    const data = parsed.data;

    return {
      tradePrice: Number(data.trade_price || data.tradePrice || 0),
      slippage: Number(data.slippage || 0),
      estimatedTimeSeconds: Number(data.estimated_time_seconds || 30),
      poolPriceBefore: Number(data.pool_price_before_trade || 0),
      poolPriceAfter: Number(data.pool_price_after_trade || 0),
      returnedAmount: Number(data.returned?.amount || 0),
      returnedInstrument: {
        id: data.returned?.instrument_id || '',
        admin: data.returned?.instrument_admin || '',
      },
      fees: {
        feePercentage: Number(data.fees?.fee_percentage || 0),
        amountAdmin: Number(data.fees?.amount_admin || 0),
        amountLiquidity: Number(data.fees?.amount_liquidity || 0),
        networkFee: Number(data.fees?.network_fee || 0),
      },
    };
  }

  // -----------------------------------------------------------------------
  // Swap Execution (3-step: build → sign → submit)
  // -----------------------------------------------------------------------

  /**
   * Execute a swap on Cantex via the 3-step intent flow:
   *
   *   1. POST /v1/intent/build/pool/swap  -> { id, digest }
   *      Builds the intent structure (from, to, amount, nonce) server-side.
   *   2. Sign the returned `digest` with secp256k1 trading key.
   *      This proves the trading key holder authorized this specific intent.
   *   3. POST /v1/intent/submit { id, intentTradingKeySignature }
   *      Submits the signed intent for on-chain settlement.
   */
  async executeSwap(
    sellAmount: number,
    sellInstrumentId: string,
    sellInstrumentAdmin: string,
    buyInstrumentId: string,
    buyInstrumentAdmin: string,
  ): Promise<SwapResult> {
    logger.info('[Cantex] Executing swap', {
      sell: `${sellAmount} ${sellInstrumentId}`,
      buy: buyInstrumentId,
    });

    // Step 1: Build swap intent — the server creates the intent structure
    // with (from, to, amount, nonce) and returns a digest to sign
    const buildRaw = await this.authPost<unknown>('/v1/intent/build/pool/swap', {
      sellAmount: String(sellAmount),
      sellInstrumentId,
      sellInstrumentAdmin,
      buyInstrumentId,
      buyInstrumentAdmin,
    });

    const buildParsed = SwapBuildResponseSchema.safeParse(buildRaw);
    if (!buildParsed.success) {
      throw new CantexError(
        `Swap build failed: invalid response structure. ${buildParsed.error.message}. Raw: ${JSON.stringify(buildRaw).slice(0, 200)}`,
      );
    }

    const buildId = buildParsed.data.id;
    const digest = buildParsed.data.digest;

    // Step 2: Sign the intent digest with secp256k1 trading key
    // The digest encodes (from, to, amount, nonce) — signing it authorizes
    // exactly this swap intent and no other
    let intentSignature: string;
    try {
      intentSignature = secp256k1Sign(digest, this.tradingKey);
    } catch (err) {
      throw new CantexError(`Failed to sign swap intent digest: ${err}`);
    }

    // Step 3: Submit signed intent for on-chain settlement
    const submitRaw = await this.authPost<unknown>('/v1/intent/submit', {
      id: buildId,
      intentTradingKeySignature: intentSignature,
    });

    const submitParsed = SwapSubmitResponseSchema.safeParse(submitRaw);
    if (!submitParsed.success) {
      throw new CantexError(
        `Swap submit response invalid: ${submitParsed.error.message}. Raw: ${JSON.stringify(submitRaw).slice(0, 200)}`,
      );
    }
    const submitResult = submitParsed.data;

    // Get quote for output amount estimation (swap is async, so we estimate)
    const quote = await this.getSwapQuote(
      sellAmount, sellInstrumentId, sellInstrumentAdmin,
      buyInstrumentId, buyInstrumentAdmin,
    );

    logger.info('[Cantex] Swap submitted', {
      buildId,
      status: submitResult.status || 'submitted',
      estimatedOutput: quote.returnedAmount,
    });

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
      return res.ok;
    } catch {
      return false;
    }
  }
}
