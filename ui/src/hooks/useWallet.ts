import { useState, useEffect, useCallback } from 'react';
import { CantonWallet, WalletState, TokenBalance } from '@/lib/canton-wallet';

// ---------------------------------------------------------------------------
// Singleton wallet instance — shared across all components
// ---------------------------------------------------------------------------

const wallet = new CantonWallet();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseWalletReturn extends WalletState {
  /** Connect the wallet. Optionally pass a party hint for dev/JSON API mode. */
  connect: (partyHint?: string) => Promise<WalletState>;
  /** Disconnect the wallet */
  disconnect: () => Promise<void>;
  /** Re-fetch balances from the ledger */
  refreshBalances: () => Promise<TokenBalance[]>;
  /** True when the Canton browser extension is detected */
  isExtensionAvailable: boolean;
  /** True while a connect/disconnect operation is in progress */
  isConnecting: boolean;
  /** Error message from the last failed operation, or null */
  error: string | null;
}

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>(wallet.getState());
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to wallet state changes
  useEffect(() => {
    return wallet.subscribe(setState);
  }, []);

  const connect = useCallback(async (partyHint?: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await wallet.connect(partyHint);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    await wallet.disconnect();
  }, []);

  const refreshBalances = useCallback(async () => {
    setError(null);
    try {
      return await wallet.refreshBalances();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to refresh balances';
      setError(msg);
      throw err;
    }
  }, []);

  const isExtensionAvailable =
    typeof window !== 'undefined' && !!(window as any).canton;

  return {
    ...state,
    connect,
    disconnect,
    refreshBalances,
    isExtensionAvailable,
    isConnecting,
    error,
  };
}
