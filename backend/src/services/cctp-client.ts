/**
 * CCTP (Cross-Chain Transfer Protocol) client for Roil.
 *
 * Circle's official USDC bridge between EVM chains and Canton Network.
 * CCTP uses burn-and-mint — not wrapping. USDC is destroyed on source,
 * minted on destination. Native USDC on every chain.
 *
 * Flow (EVM → Canton):
 * 1. User approves USDC on source chain
 * 2. User calls depositForBurn on TokenMessenger contract
 * 3. Circle generates attestation (~20 min finality)
 * 4. Backend polls attestation API
 * 5. Backend submits receiveMessage on Canton MessageTransmitter
 * 6. USDCx minted to user's Canton party
 *
 * Flow (Canton → EVM):
 * 1. Backend calls burnUSDCx on Canton
 * 2. Circle generates attestation
 * 3. User (or backend) submits receiveMessage on EVM
 * 4. USDC minted to user's EVM address
 */

import { logger } from '../monitoring/logger.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported source chains for CCTP v2 */
export type CCTPChain =
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'avalanche';

/** CCTP domain ID (Circle's chain identifier) */
export const CCTP_DOMAINS: Record<CCTPChain, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
};

/** Canton is domain 10 (assigned by Circle) */
export const CCTP_DOMAIN_CANTON = 10;

/** Deposit status */
export type DepositStatus =
  | 'pending_approval'    // user hasn't approved USDC yet
  | 'burning'             // depositForBurn tx submitted on source
  | 'awaiting_attestation' // waiting for Circle (~20 min)
  | 'attested'            // attestation received, ready to mint
  | 'minting'             // receiveMessage tx submitted on Canton
  | 'completed'           // USDCx in user's Canton party
  | 'failed';             // something went wrong

export interface DepositRequest {
  /** Unique deposit ID */
  id: string;
  /** Canton party that will receive USDCx */
  cantonParty: string;
  /** EVM address that initiated the deposit */
  evmAddress: string;
  /** Source chain */
  sourceChain: CCTPChain;
  /** USDC amount (6 decimals) */
  amount: string;
  /** Current status */
  status: DepositStatus;
  /** Source chain burn tx hash */
  burnTxHash?: string;
  /** Attestation message bytes (hex) */
  messageBytes?: string;
  /** Attestation signature (hex) */
  attestation?: string;
  /** Canton mint tx (contract ID) */
  mintContractId?: string;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Error message if failed */
  error?: string;
}

export interface WithdrawRequest {
  id: string;
  /** Canton party burning USDCx */
  cantonParty: string;
  /** Destination EVM address */
  evmAddress: string;
  /** Destination chain */
  destinationChain: CCTPChain;
  /** USDCx amount (6 decimals) */
  amount: string;
  /** Current status */
  status: DepositStatus;
  burnContractId?: string;
  messageBytes?: string;
  attestation?: string;
  mintTxHash?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Circle CCTP contract addresses (CCTP v2)
// ---------------------------------------------------------------------------

/**
 * TokenMessenger contracts — users call depositForBurn here.
 * Source: https://developers.circle.com/stablecoins/docs/evm-smart-contracts
 */
export const CCTP_TOKEN_MESSENGER: Record<CCTPChain, string> = {
  ethereum: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  avalanche: '0x6b25532e1060CE10cc3B0A99e5683b91BFDe6982',
  optimism: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
  arbitrum: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
  base: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
  polygon: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
};

/** MessageTransmitter contracts — for receiving minted USDC */
export const CCTP_MESSAGE_TRANSMITTER: Record<CCTPChain, string> = {
  ethereum: '0x0a992d191DEeC32aFe36203Ad87D7d289a738F81',
  avalanche: '0x8186359aF5F57FbB40c6b14A588d2A59C0C29880',
  optimism: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
  arbitrum: '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca',
  base: '0xAD09780d193884d503182aD4588450C416D6F9D4',
  polygon: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
};

/** Native USDC contract on each chain */
export const USDC_ADDRESS: Record<CCTPChain, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

/** Circle's attestation API base URL */
const CIRCLE_ATTESTATION_API = 'https://iris-api.circle.com';
const CIRCLE_ATTESTATION_API_SANDBOX = 'https://iris-api-sandbox.circle.com';

// ---------------------------------------------------------------------------
// CCTPClient
// ---------------------------------------------------------------------------

export class CCTPClient {
  private readonly attestationApi: string;
  private readonly deposits = new Map<string, DepositRequest>();
  private readonly withdrawals = new Map<string, WithdrawRequest>();
  private pollerId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Use sandbox API on testnet, production on mainnet
    this.attestationApi =
      config.network === 'mainnet'
        ? CIRCLE_ATTESTATION_API
        : CIRCLE_ATTESTATION_API_SANDBOX;
  }

  /**
   * Start polling for attestations on pending deposits/withdrawals.
   * Circle attestations take ~20 min for Ethereum, less for L2s.
   */
  startPolling(intervalMs: number = 60_000): void {
    if (this.pollerId) return;
    this.pollerId = setInterval(() => {
      this.pollPendingAttestations().catch(err => {
        logger.error('[cctp] Poller error', { error: String(err) });
      });
    }, intervalMs);
    logger.info('[cctp] Attestation poller started', { intervalMs });
  }

  stopPolling(): void {
    if (this.pollerId) {
      clearInterval(this.pollerId);
      this.pollerId = null;
    }
  }

  /**
   * Create a new deposit record (EVM → Canton).
   * Called when user initiates a deposit from the frontend.
   */
  createDeposit(args: {
    cantonParty: string;
    evmAddress: string;
    sourceChain: CCTPChain;
    amount: string;
  }): DepositRequest {
    const id = `deposit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const deposit: DepositRequest = {
      id,
      cantonParty: args.cantonParty,
      evmAddress: args.evmAddress,
      sourceChain: args.sourceChain,
      amount: args.amount,
      status: 'pending_approval',
      createdAt: now,
      updatedAt: now,
    };

    this.deposits.set(id, deposit);
    logger.info('[cctp] Deposit created', {
      id,
      party: args.cantonParty,
      chain: args.sourceChain,
      amount: args.amount,
    });
    return deposit;
  }

  /**
   * Record that user submitted the depositForBurn tx on source chain.
   * Moves deposit to awaiting_attestation.
   */
  recordBurnTx(depositId: string, burnTxHash: string): DepositRequest | null {
    const deposit = this.deposits.get(depositId);
    if (!deposit) return null;

    deposit.burnTxHash = burnTxHash;
    deposit.status = 'awaiting_attestation';
    deposit.updatedAt = new Date().toISOString();
    logger.info('[cctp] Burn tx recorded', { depositId, burnTxHash });
    return deposit;
  }

  /**
   * Fetch attestation from Circle's API.
   * Returns null if not yet ready (202 response).
   */
  async fetchAttestation(messageHash: string): Promise<{
    status: string;
    attestation?: string;
    message?: string;
  } | null> {
    try {
      const res = await fetch(
        `${this.attestationApi}/attestations/${messageHash}`,
      );

      if (res.status === 404) {
        return null; // Not yet indexed
      }
      if (!res.ok) {
        logger.warn('[cctp] Attestation API error', { status: res.status });
        return null;
      }

      const data = (await res.json()) as {
        status: string;
        attestation?: string;
        message?: string;
      };

      return data;
    } catch (err) {
      logger.warn('[cctp] Attestation fetch failed', { error: String(err) });
      return null;
    }
  }

  /**
   * Poll pending deposits/withdrawals and fetch attestations when ready.
   */
  private async pollPendingAttestations(): Promise<void> {
    const pending = Array.from(this.deposits.values()).filter(
      d => d.status === 'awaiting_attestation' && d.burnTxHash,
    );

    for (const deposit of pending) {
      try {
        // Message hash derived from burn tx hash (actual implementation
        // needs to decode the MessageSent event log from burn tx receipt)
        if (!deposit.burnTxHash) continue;
        const result = await this.fetchAttestation(deposit.burnTxHash);

        if (result && result.status === 'complete' && result.attestation) {
          deposit.attestation = result.attestation;
          deposit.messageBytes = result.message;
          deposit.status = 'attested';
          deposit.updatedAt = new Date().toISOString();
          logger.info('[cctp] Attestation received', { depositId: deposit.id });
          // Next step: backend auto-mints on Canton via receiveMessage
          // (handled by a separate mint routine when Canton-side contracts available)
        }
      } catch (err) {
        logger.warn('[cctp] Poll failed for deposit', {
          id: deposit.id,
          error: String(err),
        });
      }
    }
  }

  /** Get deposit by ID */
  getDeposit(id: string): DepositRequest | undefined {
    return this.deposits.get(id);
  }

  /** List deposits for a Canton party */
  getDepositsByParty(cantonParty: string): DepositRequest[] {
    return Array.from(this.deposits.values())
      .filter(d => d.cantonParty === cantonParty)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Get contract addresses for a chain — used by frontend to build tx */
  getChainAddresses(chain: CCTPChain): {
    tokenMessenger: string;
    messageTransmitter: string;
    usdc: string;
    domainId: number;
  } {
    return {
      tokenMessenger: CCTP_TOKEN_MESSENGER[chain],
      messageTransmitter: CCTP_MESSAGE_TRANSMITTER[chain],
      usdc: USDC_ADDRESS[chain],
      domainId: CCTP_DOMAINS[chain],
    };
  }

  /** Canton destination domain — used when building burn call */
  getCantonDomain(): number {
    return CCTP_DOMAIN_CANTON;
  }

  /**
   * Create a withdrawal request (Canton → EVM).
   * Backend burns USDCx on Canton, user claims on destination chain.
   */
  createWithdrawal(args: {
    cantonParty: string;
    evmAddress: string;
    destinationChain: CCTPChain;
    amount: string;
  }): WithdrawRequest {
    const id = `withdraw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const withdrawal: WithdrawRequest = {
      id,
      cantonParty: args.cantonParty,
      evmAddress: args.evmAddress,
      destinationChain: args.destinationChain,
      amount: args.amount,
      status: 'burning',
      createdAt: now,
      updatedAt: now,
    };

    this.withdrawals.set(id, withdrawal);
    logger.info('[cctp] Withdrawal created', {
      id,
      party: args.cantonParty,
      chain: args.destinationChain,
    });
    return withdrawal;
  }

  getWithdrawal(id: string): WithdrawRequest | undefined {
    return this.withdrawals.get(id);
  }

  getWithdrawalsByParty(cantonParty: string): WithdrawRequest[] {
    return Array.from(this.withdrawals.values())
      .filter(w => w.cantonParty === cantonParty)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const cctpClient = new CCTPClient();
