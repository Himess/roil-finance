/**
 * xReserve client — Circle's USDC lock-and-mint bridge between Ethereum and Canton.
 *
 * **Important:** Canton Network is NOT a CCTP domain. USDC arrives on Canton via
 * Circle's xReserve (a separate lock-and-mint bridge operated by Circle + Digital
 * Asset), not CCTP. Source docs:
 *   - https://docs.digitalasset.com/usdc/xreserve/
 *   - https://developers.circle.com/xreserve/tutorials/deposit-usdc-on-ethereum-for-usdcx-on-canton
 *
 * Deposit flow (Ethereum → Canton):
 *   1. User creates BridgeUserAgreementRequest on Canton (onboarding, one-time)
 *   2. Operator accepts → BridgeUserAgreement contract created
 *   3. User approves USDC to xReserve on Ethereum
 *   4. User calls xReserve.depositToRemote(amount, 10001, keccak256(partyId), USDC, 0, hookData)
 *   5. Wait ~13-15 min Ethereum finality (2 epochs)
 *   6. Operator writes DepositAttestation on Canton visible to user
 *   7. User exercises BridgeUserAgreement_Mint(attestationCid, ...) → receives USDCx
 *
 * Withdraw flow (Canton → Ethereum):
 *   1. User exercises BridgeUserAgreement_Burn(amount, 0, ethAddress, holdings, requestId)
 *   2. Operator releases USDC on Ethereum minus xReserve fee
 *   3. Currently only destinationDomain=0 (Ethereum) supported
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { logger } from '../monitoring/logger.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export const CANTON_XRESERVE_DOMAIN = 10001;
export const ETHEREUM_DOMAIN = 0;

/** Digital Asset utility backend URLs */
export const UTILITY_BACKEND: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'https://api.utilities.digitalasset.com',
  testnet: 'https://api.utilities.digitalasset-staging.com',
};

export function getUtilityBackend(): string {
  return config.network === 'mainnet'
    ? UTILITY_BACKEND.mainnet
    : UTILITY_BACKEND.testnet;
}

/** xReserve Ethereum source chain — only Ethereum is supported today */
export type XReserveSource = 'ethereum' | 'sepolia';

export interface XReserveChainConfig {
  id: XReserveSource;
  chainId: number;
  name: string;
  xReserveContract: `0x${string}`;
  usdcContract: `0x${string}`;
  rpcUrl: string;
}

/**
 * xReserve contracts — source: digital-asset/xreserve-deposits (canton-deposit-script-v2/config_canton.ts)
 */
export const XRESERVE_CHAINS: Record<XReserveSource, XReserveChainConfig> = {
  sepolia: {
    id: 'sepolia',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    xReserveContract: '0x008888878f94C0d87defdf0B07f46B93C1934442',
    usdcContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  ethereum: {
    id: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    xReserveContract: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    usdcContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
  },
};

/** Which Ethereum chain to use based on Canton network */
export function getSourceChain(): XReserveSource {
  return config.network === 'mainnet' ? 'ethereum' : 'sepolia';
}

/**
 * xReserve operator party — writes DepositAttestation contracts on Canton
 * after observing Ethereum deposits.
 */
export const XRESERVE_OPERATOR: Record<'mainnet' | 'testnet', string> = {
  mainnet:
    'decentralized-usdc-interchain-rep::12208115f1e168dd7e792320be9c4ca720c751a02a3053c7606e1c1cd3dad9bf60ef',
  testnet:
    'decentralized-usdc-interchain-rep::122049e2af8a725bd19759320fc83c638e7718973eac189d8f201309c512d1ffec61',
};

export function getOperator(): string {
  return config.network === 'mainnet'
    ? XRESERVE_OPERATOR.mainnet
    : XRESERVE_OPERATOR.testnet;
}

/**
 * utility-bridge-v0 template IDs (admin-hosted).
 * Full package hash resolved at runtime via /v2/packages lookup.
 */
export const BRIDGE_TEMPLATES = {
  UserAgreementRequest:
    '#utility-bridge-v0:Utility.Bridge.V0.Agreement.User:BridgeUserAgreementRequest',
  UserAgreement:
    '#utility-bridge-v0:Utility.Bridge.V0.Agreement.User:BridgeUserAgreement',
  DepositAttestation:
    '#utility-bridge-v0:Utility.Bridge.V0.Attestation.Deposit:DepositAttestation',
  BurnMintFactory:
    '#utility-bridge-v0:Utility.Bridge.V0.Factory:BurnMintFactory',
} as const;

/** Splice Token Standard Holding interface (for USDCx balances) */
export const SPLICE_HOLDING_INTERFACE =
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';

export type DepositStatus =
  | 'pending_approval'
  | 'burning'
  | 'awaiting_finality'
  | 'awaiting_attestation'
  | 'attested'
  | 'minting'
  | 'completed'
  | 'failed';

export type WithdrawStatus =
  | 'pending'
  | 'burning'
  | 'released'
  | 'completed'
  | 'failed';

export interface DepositRecord {
  id: string;
  cantonParty: string;
  evmAddress: string;
  sourceChain: XReserveSource;
  amount: string;
  status: DepositStatus;
  burnTxHash?: string;
  attestationContractId?: string;
  mintTxId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface WithdrawRecord {
  id: string;
  cantonParty: string;
  destinationEvmAddress: string;
  destinationChain: XReserveSource;
  amount: string;
  status: WithdrawStatus;
  burnContractId?: string;
  releaseTxHash?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// XReserveClient
// ---------------------------------------------------------------------------

export class XReserveClient {
  private readonly deposits = new Map<string, DepositRecord>();
  private readonly withdrawals = new Map<string, WithdrawRecord>();
  private pollerId: ReturnType<typeof setInterval> | null = null;

  /**
   * Start polling Canton ledger for new DepositAttestation contracts
   * addressed to users with pending deposits.
   */
  startPolling(intervalMs = 60_000): void {
    if (this.pollerId) return;
    this.pollerId = setInterval(() => {
      this.pollAttestations().catch(err =>
        logger.error('[xreserve] Poller error', { error: String(err) }),
      );
    }, intervalMs);
    logger.info('[xreserve] Attestation poller started', { intervalMs });
  }

  stopPolling(): void {
    if (this.pollerId) {
      clearInterval(this.pollerId);
      this.pollerId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Deposit (Ethereum → Canton)
  // -------------------------------------------------------------------------

  createDeposit(args: {
    cantonParty: string;
    evmAddress: string;
    amount: string;
  }): DepositRecord {
    const id = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const sourceChain = getSourceChain();

    const record: DepositRecord = {
      id,
      cantonParty: args.cantonParty,
      evmAddress: args.evmAddress,
      sourceChain,
      amount: args.amount,
      status: 'pending_approval',
      createdAt: now,
      updatedAt: now,
    };

    this.deposits.set(id, record);
    logger.info('[xreserve] Deposit created', {
      id,
      party: args.cantonParty,
      amount: args.amount,
    });
    return record;
  }

  recordBurnTx(depositId: string, burnTxHash: string): DepositRecord | null {
    const record = this.deposits.get(depositId);
    if (!record) return null;
    record.burnTxHash = burnTxHash;
    record.status = 'awaiting_finality';
    record.updatedAt = new Date().toISOString();
    return record;
  }

  markAttested(
    depositId: string,
    attestationContractId: string,
  ): DepositRecord | null {
    const record = this.deposits.get(depositId);
    if (!record) return null;
    record.attestationContractId = attestationContractId;
    record.status = 'attested';
    record.updatedAt = new Date().toISOString();
    return record;
  }

  markMinted(depositId: string, mintTxId: string): DepositRecord | null {
    const record = this.deposits.get(depositId);
    if (!record) return null;
    record.mintTxId = mintTxId;
    record.status = 'completed';
    record.completedAt = new Date().toISOString();
    record.updatedAt = record.completedAt;
    return record;
  }

  getDeposit(id: string): DepositRecord | undefined {
    return this.deposits.get(id);
  }

  getDepositsByParty(cantonParty: string): DepositRecord[] {
    return Array.from(this.deposits.values())
      .filter(d => d.cantonParty === cantonParty)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // -------------------------------------------------------------------------
  // Withdraw (Canton → Ethereum)
  // -------------------------------------------------------------------------

  createWithdrawal(args: {
    cantonParty: string;
    destinationEvmAddress: string;
    amount: string;
  }): WithdrawRecord {
    const id = `wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const record: WithdrawRecord = {
      id,
      cantonParty: args.cantonParty,
      destinationEvmAddress: args.destinationEvmAddress,
      destinationChain: getSourceChain(), // Only ETH today
      amount: args.amount,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.withdrawals.set(id, record);
    return record;
  }

  getWithdrawal(id: string): WithdrawRecord | undefined {
    return this.withdrawals.get(id);
  }

  getWithdrawalsByParty(cantonParty: string): WithdrawRecord[] {
    return Array.from(this.withdrawals.values())
      .filter(w => w.cantonParty === cantonParty)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markWithdrawBurned(
    withdrawId: string,
    burnContractId: string,
  ): WithdrawRecord | null {
    const w = this.withdrawals.get(withdrawId);
    if (!w) return null;
    w.burnContractId = burnContractId;
    w.status = 'burning';
    w.updatedAt = new Date().toISOString();
    return w;
  }

  markWithdrawReleased(
    withdrawId: string,
    releaseTxHash: string,
  ): WithdrawRecord | null {
    const w = this.withdrawals.get(withdrawId);
    if (!w) return null;
    w.releaseTxHash = releaseTxHash;
    w.status = 'completed';
    w.completedAt = new Date().toISOString();
    w.updatedAt = w.completedAt;
    return w;
  }

  // -------------------------------------------------------------------------
  // Polling: watch Canton for DepositAttestation contracts
  // -------------------------------------------------------------------------

  private async pollAttestations(): Promise<void> {
    const pending = Array.from(this.deposits.values()).filter(
      d => d.status === 'awaiting_finality' || d.status === 'awaiting_attestation',
    );
    if (pending.length === 0) return;

    try {
      const uniqueParties = [...new Set(pending.map(d => d.cantonParty))];
      for (const party of uniqueParties) {
        const attestations = await this.queryAttestations(party);
        for (const att of attestations) {
          // Match attestation to a pending deposit by recipient + amount
          const match = pending.find(
            d =>
              d.cantonParty === party &&
              !d.attestationContractId &&
              this.amountsMatch(d.amount, att.payload.amount),
          );
          if (match) {
            logger.info('[xreserve] Found matching attestation', {
              depositId: match.id,
              attestationCid: att.contractId,
            });
            this.markAttested(match.id, att.contractId);
          }
        }
      }
    } catch (err) {
      logger.warn('[xreserve] Attestation poll failed', {
        error: String(err),
      });
    }
  }

  private amountsMatch(a: string, b: string): boolean {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return a === b;
    }
  }

  private async queryAttestations(
    party: string,
  ): Promise<Array<{ contractId: string; payload: { amount: string } }>> {
    try {
      const url = `${config.jsonApiUrl}/v2/state/active-contracts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            filtersByParty: {
              [party]: {
                cumulative: [
                  {
                    identifierFilter: {
                      TemplateFilter: {
                        value: {
                          templateId: BRIDGE_TEMPLATES.DepositAttestation,
                          includeCreatedEventBlob: false,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          verbose: false,
          activeAtOffset: 0,
        }),
      });

      if (!res.ok) {
        // utility-bridge-v0 package may not be vetted on our participant yet
        return [];
      }

      const data = (await res.json()) as {
        contractEntries?: Array<{
          activeContract?: {
            createdEvent?: {
              contractId?: string;
              createArgument?: { amount?: string };
            };
          };
        }>;
      };

      return (data.contractEntries ?? [])
        .map(e => e.activeContract?.createdEvent)
        .filter(Boolean)
        .map(ev => ({
          contractId: ev!.contractId ?? '',
          payload: { amount: String(ev!.createArgument?.amount ?? '0') },
        }));
    } catch (err) {
      logger.debug('[xreserve] queryAttestations error', {
        error: String(err),
      });
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Helpers for frontend
  // -------------------------------------------------------------------------

  /**
   * Auto-select user's USDCx Holding contracts covering the burn amount.
   * Queries the Splice Token Standard Holding interface via the Ledger API.
   *
   * Returns contractIds sorted by amount (largest first), selected greedily
   * until total >= burnAmount. Throws if user lacks sufficient USDCx.
   */
  async selectHoldingsForBurn(
    cantonParty: string,
    burnAmountUnits: string, // 6-decimal integer
  ): Promise<string[]> {
    try {
      const url = `${config.jsonApiUrl}/v2/state/active-contracts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            filtersByParty: {
              [cantonParty]: {
                cumulative: [
                  {
                    identifierFilter: {
                      InterfaceFilter: {
                        value: {
                          interfaceId: SPLICE_HOLDING_INTERFACE,
                          includeInterfaceView: true,
                          includeCreatedEventBlob: false,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          verbose: false,
          activeAtOffset: 0,
        }),
      });

      if (!res.ok) {
        throw new Error(`Holding query failed: ${res.status}`);
      }

      const data = (await res.json()) as {
        contractEntries?: Array<{
          activeContract?: {
            createdEvent?: {
              contractId?: string;
              interfaceViews?: Array<{
                viewValue?: {
                  instrumentId?: { id?: string };
                  amount?: string;
                  owner?: string;
                };
              }>;
            };
          };
        }>;
      };

      type Entry = { contractId: string; amount: bigint };
      const usdcxEntries: Entry[] = [];

      for (const e of data.contractEntries ?? []) {
        const ev = e.activeContract?.createdEvent;
        if (!ev?.contractId) continue;
        const view = ev.interfaceViews?.[0]?.viewValue;
        if (view?.instrumentId?.id !== 'USDCx') continue;
        if (!view.amount) continue;
        // Splice amounts are decimal strings with 10 decimals — convert to 6-decimal units
        // 1 USDCx in Splice (10 decimals) = 1_000_000 units (6 decimals)
        const raw = view.amount;
        const [whole, frac = ''] = raw.split('.');
        const frac6 = (frac + '000000').slice(0, 6);
        const units = BigInt(whole) * 1_000_000n + BigInt(frac6 || '0');
        usdcxEntries.push({ contractId: ev.contractId, amount: units });
      }

      // Sort by amount descending, greedy select
      usdcxEntries.sort((a, b) => (b.amount > a.amount ? 1 : -1));

      const need = BigInt(burnAmountUnits);
      const selected: string[] = [];
      let total = 0n;
      for (const entry of usdcxEntries) {
        if (total >= need) break;
        selected.push(entry.contractId);
        total += entry.amount;
      }

      if (total < need) {
        throw new Error(
          `Insufficient USDCx: have ${total.toString()}, need ${need.toString()}`,
        );
      }
      return selected;
    } catch (err) {
      logger.error('[xreserve] selectHoldingsForBurn failed', {
        error: String(err),
      });
      throw err;
    }
  }

  /**
   * Fetch BurnMintFactory contract + disclosed contracts from Digital Asset's
   * utility backend. Required for BridgeUserAgreement_Mint and _Burn.
   *
   * Best-effort — if DA's backend is unreachable, fall back to querying the
   * local ledger for any visible BurnMintFactory contract.
   */
  async fetchMintFactory(): Promise<{
    factoryCid: string;
    contextContractIds: string[];
  } | null> {
    const operator = getOperator();

    // Try DA utility backend (Token Standard pattern)
    const backend = getUtilityBackend();
    const paths = [
      `/api/token-standard/v0/registrars/${encodeURIComponent(operator)}/registry/burn-mint-instruction/v1/burn-mint-factory`,
      `/api/utilities/v0/registry/burn-mint-instruction/v1/burn-mint-factory`,
      `/registry/burn-mint-instruction/v1/burn-mint-factory`,
    ];

    for (const path of paths) {
      try {
        const res = await fetch(`${backend}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            choiceArguments: {},
            excludeDebugFields: true,
          }),
        });

        if (!res.ok) continue;

        const data = (await res.json()) as {
          factoryId?: string;
          choiceContext?: {
            disclosedContracts?: Array<{ contractId?: string }>;
          };
        };

        if (data.factoryId) {
          return {
            factoryCid: data.factoryId,
            contextContractIds: (data.choiceContext?.disclosedContracts ?? [])
              .map(c => c.contractId ?? '')
              .filter(Boolean),
          };
        }
      } catch {
        // Try next path
      }
    }

    // Fallback: query local ledger for BurnMintFactory contracts
    // (requires operator to have disclosed them to our participant)
    try {
      const url = `${config.jsonApiUrl}/v2/state/active-contracts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            filtersByParty: {
              [operator]: {
                cumulative: [
                  {
                    identifierFilter: {
                      TemplateFilter: {
                        value: {
                          templateId: BRIDGE_TEMPLATES.BurnMintFactory,
                          includeCreatedEventBlob: false,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          verbose: false,
          activeAtOffset: 0,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          contractEntries?: Array<{
            activeContract?: { createdEvent?: { contractId?: string } };
          }>;
        };
        const first =
          data.contractEntries?.[0]?.activeContract?.createdEvent?.contractId;
        if (first) {
          return { factoryCid: first, contextContractIds: [] };
        }
      }
    } catch (err) {
      logger.warn('[xreserve] Ledger factory fallback failed', {
        error: String(err),
      });
    }

    return null;
  }

  /**
   * Build the deposit transaction parameters for the frontend.
   * Returns contract addresses, Canton domain, and encoded recipient.
   */
  buildDepositParams(cantonParty: string): {
    chain: XReserveChainConfig;
    cantonDomain: number;
    remoteRecipient: `0x${string}`;
    hookData: `0x${string}`;
  } {
    const chain = XRESERVE_CHAINS[getSourceChain()];
    return {
      chain,
      cantonDomain: CANTON_XRESERVE_DOMAIN,
      remoteRecipient: keccak256Utf8(cantonParty),
      hookData: (`0x${Buffer.from(cantonParty, 'utf8').toString('hex')}`) as `0x${string}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure-JS keccak256 for node (used only for deposit setup — not perf-critical)
// ---------------------------------------------------------------------------

function keccak256Utf8(input: string): `0x${string}` {
  const bytes = new TextEncoder().encode(input);
  const hash = keccak_256(bytes);
  return `0x${Buffer.from(hash).toString('hex')}` as `0x${string}`;
}

export const xreserveClient = new XReserveClient();
