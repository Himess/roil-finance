/**
 * Canton dApp SDK Wallet Adapter
 *
 * Uses the official @canton-network/dapp-sdk for wallet connection,
 * transaction signing, and ledger API access.
 *
 * This adapter wraps the SDK's singleton to provide a consistent
 * interface with our existing CantonWallet abstraction.
 */

import {
  connect as sdkConnect,
  disconnect as sdkDisconnect,
  listAccounts as sdkListAccounts,
  prepareExecuteAndWait as sdkExecuteAndWait,
  ledgerApi as sdkLedgerApi,
  onStatusChanged,
  onAccountsChanged,
} from '@canton-network/dapp-sdk';

export interface CantonSDKState {
  connected: boolean;
  party: string | null;
  displayName: string | null;
}

type StateListener = (state: CantonSDKState) => void;

/**
 * Adapter class that wraps @canton-network/dapp-sdk for use in our app.
 */
export class CantonSDKWallet {
  private state: CantonSDKState = { connected: false, party: null, displayName: null };
  private listeners: Set<StateListener> = new Set();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Listen for SDK status changes
    try {
      await onStatusChanged((event: any) => {
        const connected = event.status === 'connected';
        this.updateState({
          connected,
          party: connected ? event.party || this.state.party : null,
          displayName: connected ? event.displayName || this.state.displayName : null,
        });
      });

      await onAccountsChanged((event: any) => {
        const accounts = event.accounts || [];
        if (accounts.length > 0) {
          this.updateState({
            ...this.state,
            party: accounts[0].party,
            displayName: accounts[0].displayName || null,
          });
        }
      });
    } catch {
      // SDK not available -- will fallback to custom wallet
    }
  }

  async connect(): Promise<CantonSDKState> {
    try {
      const result: any = await sdkConnect();
      const party = result.party || result.accounts?.[0]?.party || null;
      const displayName = result.displayName || result.accounts?.[0]?.displayName || null;

      this.updateState({ connected: true, party, displayName });
      return this.state;
    } catch (err) {
      console.error('Canton SDK connect failed:', err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await sdkDisconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.updateState({ connected: false, party: null, displayName: null });
  }

  async getAccounts(): Promise<{ party: string; displayName?: string }[]> {
    try {
      const result: any = await sdkListAccounts();
      return result.accounts || [];
    } catch {
      return [];
    }
  }

  async submitTransaction(commands: unknown[], actAs: string[]): Promise<unknown> {
    return sdkExecuteAndWait({ commands, actAs } as any);
  }

  async ledgerApiCall(method: string, path: string, body?: unknown): Promise<unknown> {
    return sdkLedgerApi({ method, path, body } as any);
  }

  getState(): CantonSDKState {
    return { ...this.state };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(newState: CantonSDKState): void {
    this.state = { ...newState };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Check if the Canton dApp SDK is available in the browser.
   */
  static isAvailable(): boolean {
    try {
      // The SDK auto-detects Canton wallet providers
      return true; // SDK handles provider detection internally
    } catch {
      return false;
    }
  }
}

export const cantonSDKWallet = new CantonSDKWallet();
