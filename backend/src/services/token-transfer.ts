import { ledger, extractCreatedContractId, type DamlContract } from '../ledger.js';
import { cantex } from '../cantex.js';
import { config, TEMPLATES, TOKEN_STANDARD, INSTRUMENTS } from '../config.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CIP-0056 Holding view as returned by the Canton JSON Ledger API. */
export interface CIP56Holding {
  owner: string;
  instrument: {
    id: string;
    admin: string;
  };
  amount: string;
  lock: unknown;
}

/** Simplified holding returned to callers. */
export interface TokenHoldingSummary {
  instrumentId: string;
  instrumentAdmin: string;
  amount: number;
}

/** Payload shape for our TransferRequest Daml template. */
export interface TransferRequestPayload {
  platform: string;
  sender: string;
  receiver: string;
  instrumentId: string;
  instrumentAdmin: string;
  amount: string;
  status: { tag: string; value?: unknown };
  memo: string;
  createdAt: string;
}

/** Payload shape for our SwapRequest Daml template. */
export interface SwapRequestPayload {
  platform: string;
  user: string;
  sellAsset: string;
  sellAdmin: string;
  sellAmount: string;
  buyAsset: string;
  buyAdmin: string;
  buyAmount: string;
  status: { tag: string; value?: unknown };
  createdAt: string;
}

/** Payload shape for our TransferLog Daml template. */
export interface TransferLogPayload {
  platform: string;
  sender: string;
  receiver: string;
  instrumentId: string;
  instrumentAdmin: string;
  amount: string;
  memo: string;
  completedAt: string;
}

/** Payload shape for our SwapLog Daml template. */
export interface SwapLogPayload {
  platform: string;
  user: string;
  sellAsset: string;
  sellAmount: string;
  buyAsset: string;
  buyAmount: string;
  timestamp: string;
}

/** Result of a swap execution. */
export interface SwapExecutionResult {
  success: boolean;
  swapLogContractId?: string;
  sellAsset: string;
  sellAmount: number;
  buyAsset: string;
  buyAmount: number;
  error?: string;
}

/** Combined history entry for transfers and swaps. */
export interface HistoryEntry {
  type: 'transfer' | 'swap';
  timestamp: string;
  details: TransferLogPayload | SwapLogPayload;
}

// ---------------------------------------------------------------------------
// Template IDs for the new TokenTransfer module
// ---------------------------------------------------------------------------

const pkg = config.damlPackageName;

const TRANSFER_TEMPLATES = {
  TransferRequest: `#${pkg}:TokenTransfer:TransferRequest`,
  SwapRequest: `#${pkg}:TokenTransfer:SwapRequest`,
  TransferLog: `#${pkg}:TokenTransfer:TransferLog`,
  SwapLog: `#${pkg}:TokenTransfer:SwapLog`,
} as const;

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

type TransferMode = 'internal' | 'network';

/**
 * Determine whether to use internal (LocalNet) or network (DevNet/MainNet)
 * mode based on the current environment.
 *
 * - "internal" mode: Uses our own TransferRequest/SwapRequest templates.
 *   Suitable for LocalNet and testing where CIP-0056 infrastructure is absent.
 *
 * - "network" mode: Uses real CIP-0056 TransferFactory + Cantex.
 *   Used on DevNet, TestNet, and MainNet where the Canton token standard is live.
 */
function getMode(): TransferMode {
  return config.network === 'localnet' ? 'internal' : 'network';
}

// ---------------------------------------------------------------------------
// TokenTransferService
// ---------------------------------------------------------------------------

/**
 * Service that handles real CIP-0056 token operations for the rebalancer.
 *
 * Supports two modes:
 * 1. "internal" mode (LocalNet): Uses our own TransferRequest/SwapRequest
 *    templates to model transfers and swaps locally.
 * 2. "network" mode (DevNet/MainNet): Queries real CIP-0056 Holdings via
 *    the Splice.Api.Token interfaces and executes swaps via Cantex.
 */
export class TokenTransferService {
  private readonly mode: TransferMode;

  constructor() {
    this.mode = getMode();
    logger.info(`[TokenTransfer] Running in ${this.mode.toUpperCase()} mode`);
  }

  // -----------------------------------------------------------------------
  // Holdings query
  // -----------------------------------------------------------------------

  /**
   * Query token holdings for a party.
   *
   * In network mode, queries CIP-0056 Holding contracts via the
   * `Splice.Api.Token.HoldingV1:Holding` interface ID.
   *
   * In internal mode, queries Cantex balances (mock or real) and returns
   * them in the same format.
   */
  async queryHoldings(party: string): Promise<TokenHoldingSummary[]> {
    if (this.mode === 'network') {
      return this.queryHoldingsNetwork(party);
    }
    return this.queryHoldingsInternal(party);
  }

  /**
   * Network mode: Query CIP-0056 Holdings from the Canton ledger.
   * Uses the standardized interface ID for token holdings.
   */
  private async queryHoldingsNetwork(party: string): Promise<TokenHoldingSummary[]> {
    try {
      // Query using the CIP-0056 Holding interface
      const contracts = await ledger.queryContracts<CIP56Holding>(
        {
          [party]: {
            templateIds: [TOKEN_STANDARD.Holding],
          },
        },
        [party],
      );

      return contracts.map((c) => ({
        instrumentId: c.payload.instrument.id,
        instrumentAdmin: c.payload.instrument.admin,
        amount: Number(c.payload.amount),
      }));
    } catch (err) {
      logger.error('[TokenTransfer] Failed to query CIP-0056 Holdings', { error: String(err) });
      // Fallback to Cantex balances if CIP-0056 query fails
      logger.info('[TokenTransfer] Falling back to Cantex balances');
      return this.queryHoldingsInternal(party);
    }
  }

  /**
   * Internal mode: Get balances from Cantex (mock or real SDK).
   */
  private async queryHoldingsInternal(party: string): Promise<TokenHoldingSummary[]> {
    const balances = await cantex.getBalances(party);
    return balances.map((b) => ({
      instrumentId: b.asset,
      instrumentAdmin: this.resolveAdmin(b.asset),
      amount: b.amount,
    }));
  }

  // -----------------------------------------------------------------------
  // Transfer creation
  // -----------------------------------------------------------------------

  /**
   * Initiate a token transfer between two parties.
   *
   * In network mode, creates a CIP-0056 TransferInstruction via the
   * TransferFactory interface, then records a TransferRequest on our ledger.
   *
   * In internal mode, creates only the TransferRequest on our ledger.
   *
   * Returns the contract ID of the created TransferRequest.
   */
  async initiateTransfer(
    sender: string,
    receiver: string,
    instrumentId: string,
    amount: number,
    memo: string,
  ): Promise<string> {
    const platform = config.platformParty;
    const admin = this.resolveAdmin(instrumentId);
    const now = new Date().toISOString();

    if (this.mode === 'network') {
      // On the real network, call CIP-0056 TransferFactory first
      await this.createCIP56Transfer(sender, receiver, instrumentId, admin, amount);
    }

    // Create our own TransferRequest to track the transfer.
    // Use both platform and sender as actAs parties to satisfy the
    // Daml signatory requirement: signatory platform, sender
    const createResult = await ledger.create(
      TRANSFER_TEMPLATES.TransferRequest,
      {
        platform,
        sender,
        receiver,
        instrumentId,
        instrumentAdmin: admin,
        amount: String(amount),
        status: { tag: 'Pending', value: {} },
        memo,
        createdAt: now,
      },
      [platform, sender],
    );
    const contractId = extractCreatedContractId(createResult);

    logger.info(
      `[TokenTransfer] Created TransferRequest ${contractId}: ` +
      `${amount} ${instrumentId} from ${sender.slice(0, 16)}... to ${receiver.slice(0, 16)}...`,
    );

    return contractId;
  }

  /**
   * Network mode: Create a CIP-0056 TransferInstruction via the
   * TransferFactory interface on the Canton ledger.
   */
  private async createCIP56Transfer(
    sender: string,
    receiver: string,
    instrumentId: string,
    admin: string,
    amount: number,
  ): Promise<void> {
    try {
      // Query the TransferFactory for this instrument
      const factories = await ledger.queryContracts(
        {
          [sender]: {
            templateIds: [TOKEN_STANDARD.TransferFactory],
          },
        },
        [sender],
      );

      if (factories.length === 0) {
        throw new Error(`No TransferFactory found for party ${sender}`);
      }

      // Exercise the Transfer choice on the factory to create a TransferInstruction
      await ledger.exercise(
        TOKEN_STANDARD.TransferFactory,
        factories[0].contractId,
        'Transfer',
        {
          instrument: { id: instrumentId, admin },
          sender: { party: sender },
          receiver: { party: receiver },
          amount: String(amount),
        },
        [sender],
      );

      logger.info(
        `[TokenTransfer] CIP-0056 TransferInstruction created: ` +
        `${amount} ${instrumentId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[TokenTransfer] CIP-0056 Transfer failed: ${message}`);
      throw new Error(`CIP-0056 transfer failed: ${message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Swap execution
  // -----------------------------------------------------------------------

  /**
   * Execute a swap: sell one asset and buy another.
   *
   * Pipeline:
   * 1. Create a SwapRequest on the Daml ledger
   * 2. Get a quote from Cantex
   * 3. Execute the swap via Cantex
   * 4. Exercise ExecuteSwap on the SwapRequest to create a SwapLog
   *
   * In network mode, the Cantex swap triggers real CIP-0056 token movements.
   * In internal mode, the Cantex mock simulates the swap.
   */
  async executeSwap(
    user: string,
    sellAsset: string,
    sellAmount: number,
    buyAsset: string,
    expectedBuyAmount: number,
  ): Promise<SwapExecutionResult> {
    const platform = config.platformParty;
    const sellAdmin = this.resolveAdmin(sellAsset);
    const buyAdmin = this.resolveAdmin(buyAsset);
    const now = new Date().toISOString();

    try {
      // 1. Create SwapRequest on ledger.
      // Use both platform and user as actAs parties to satisfy the
      // Daml signatory requirement: signatory platform, user
      const swapCreateResult = await ledger.create(
        TRANSFER_TEMPLATES.SwapRequest,
        {
          platform,
          user,
          sellAsset,
          sellAdmin,
          sellAmount: String(sellAmount),
          buyAsset,
          buyAdmin,
          buyAmount: String(expectedBuyAmount),
          minBuyAmount: String(expectedBuyAmount * (1 - parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.02'))), // configurable slippage tolerance
          status: { tag: 'Pending', value: {} },
          createdAt: now,
        },
        [platform, user],
      );
      const swapRequestCid = extractCreatedContractId(swapCreateResult);

      logger.info(
        `[TokenTransfer] SwapRequest ${swapRequestCid}: ` +
        `${sellAmount} ${sellAsset} -> ~${expectedBuyAmount} ${buyAsset}`,
      );

      // 2. Execute swap via Cantex
      const swapResult = await cantex.executeSwap(sellAsset, buyAsset, sellAmount);
      const actualBuyAmount = swapResult.outputAmount;

      logger.info(
        `[TokenTransfer] Cantex swap executed: ` +
        `${sellAmount} ${sellAsset} -> ${actualBuyAmount} ${buyAsset} ` +
        `(tx: ${swapResult.txId})`,
      );

      // 3. Exercise ExecuteSwap to create SwapLog
      const swapLogCid = await ledger.exerciseAs<string>(
        TRANSFER_TEMPLATES.SwapRequest,
        swapRequestCid,
        'ExecuteSwap',
        {
          actualBuyAmount: String(actualBuyAmount),
          executedAt: swapResult.timestamp,
        },
        platform,
      );

      return {
        success: true,
        swapLogContractId: swapLogCid,
        sellAsset,
        sellAmount,
        buyAsset,
        buyAmount: actualBuyAmount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[TokenTransfer] Swap failed: ${message}`);

      return {
        success: false,
        sellAsset,
        sellAmount,
        buyAsset,
        buyAmount: 0,
        error: message,
      };
    }
  }

  // -----------------------------------------------------------------------
  // History queries
  // -----------------------------------------------------------------------

  /**
   * Get the combined transfer and swap history for a party.
   *
   * Queries both TransferLog and SwapLog contracts visible to the party,
   * merges them into a single timeline sorted by timestamp (newest first).
   */
  async getTransferHistory(party: string): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];

    // Query TransferLog contracts
    try {
      const transferLogs = await ledger.query<TransferLogPayload>(
        TRANSFER_TEMPLATES.TransferLog,
        party,
      );

      for (const log of transferLogs) {
        entries.push({
          type: 'transfer',
          timestamp: log.payload.completedAt,
          details: log.payload,
        });
      }
    } catch (err) {
      logger.error('[TokenTransfer] Failed to query TransferLog', { error: String(err) });
    }

    // Query SwapLog contracts
    try {
      const swapLogs = await ledger.query<SwapLogPayload>(
        TRANSFER_TEMPLATES.SwapLog,
        party,
      );

      for (const log of swapLogs) {
        entries.push({
          type: 'swap',
          timestamp: log.payload.timestamp,
          details: log.payload,
        });
      }
    } catch (err) {
      logger.error('[TokenTransfer] Failed to query SwapLog', { error: String(err) });
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return tb - ta;
    });

    return entries;
  }

  /**
   * Get pending TransferRequest contracts for a party (as sender or receiver).
   */
  async getPendingTransfers(party: string): Promise<DamlContract<TransferRequestPayload>[]> {
    const contracts = await ledger.query<TransferRequestPayload>(
      TRANSFER_TEMPLATES.TransferRequest,
      party,
    );

    return contracts.filter((c) => c.payload.status.tag === 'Pending');
  }

  /**
   * Get pending SwapRequest contracts for a party.
   */
  async getPendingSwaps(party: string): Promise<DamlContract<SwapRequestPayload>[]> {
    const contracts = await ledger.query<SwapRequestPayload>(
      TRANSFER_TEMPLATES.SwapRequest,
      party,
    );

    return contracts.filter((c) => c.payload.status.tag === 'Pending');
  }

  // -----------------------------------------------------------------------
  // CIP-0056 Allocation (token locking)
  // -----------------------------------------------------------------------

  /**
   * Create a CIP-0056 allocation (token lock) for pending swaps.
   * This locks tokens in escrow before a swap executes.
   */
  async createAllocation(
    owner: string,
    instrumentId: string,
    amount: number,
    lockHolder: string,
  ): Promise<{ allocationId: string; holdingCid: string } | null> {
    if (this.mode === 'internal') {
      logger.info('[TokenTransfer] Allocation skipped in internal mode');
      return null;
    }

    try {
      // Query AllocationFactory
      const factories = await ledger.queryContracts(
        { [config.platformParty]: { templateIds: [TOKEN_STANDARD.AllocationFactory] } },
        [config.platformParty],
      );

      if (factories.length === 0) {
        logger.warn('[TokenTransfer] No AllocationFactory found');
        return null;
      }

      const factory = factories[0];
      const result = await ledger.exercise(
        TOKEN_STANDARD.AllocationFactory,
        factory.contractId,
        'Allocate',
        {
          instrument: { id: instrumentId, admin: INSTRUMENTS[instrumentId as keyof typeof INSTRUMENTS]?.admin || '' },
          owner: { party: owner },
          amount: String(amount),
          lockHolder: { party: lockHolder },
        },
        [config.platformParty, owner],
      );

      const allocationId = extractCreatedContractId(result);
      logger.info(`[TokenTransfer] Allocation created: ${allocationId}`);
      return { allocationId: allocationId || '', holdingCid: '' };
    } catch (err) {
      logger.warn('[TokenTransfer] Allocation failed, continuing without lock', { error: String(err) });
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Resolve the admin party for a given instrument ID.
   * Falls back to an empty string if the instrument is unknown.
   */
  private resolveAdmin(instrumentId: string): string {
    const instrument = INSTRUMENTS[instrumentId as keyof typeof INSTRUMENTS];
    return instrument?.admin ?? '';
  }
}

/** Singleton instance */
export const tokenTransferService = new TokenTransferService();
