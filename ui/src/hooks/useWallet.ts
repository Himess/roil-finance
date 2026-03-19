import { useState, useEffect, useCallback } from 'react';
import { CantonWallet, WalletState, TokenBalance } from '@/lib/canton-wallet';
import { cantonSDKWallet } from '@/lib/canton-sdk-wallet';
import { setAuthToken } from './useApi';

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
  /** True when connected via the official Canton dApp SDK */
  isSDKConnected: boolean;
  /** True while a connect/disconnect operation is in progress */
  isConnecting: boolean;
  /** Error message from the last failed operation, or null */
  error: string | null;
}

export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>(wallet.getState());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSDKConnected, setIsSDKConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to wallet state changes
  useEffect(() => {
    const unsubWallet = wallet.subscribe(setState);

    // Also subscribe to SDK state changes so the UI updates if
    // the SDK wallet status changes externally (e.g. user disconnects
    // via the Canton wallet provider).
    const unsubSDK = cantonSDKWallet.subscribe((sdkState) => {
      setIsSDKConnected(sdkState.connected);
      if (sdkState.connected && sdkState.party) {
        setState({
          connected: true,
          party: sdkState.party,
          displayName: sdkState.displayName || sdkState.party,
          balances: [],
        });
      }
    });

    return () => {
      unsubWallet();
      unsubSDK();
    };
  }, []);

  const connect = useCallback(async (partyHint?: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      // Try official Canton dApp SDK first
      try {
        await cantonSDKWallet.init();
        const sdkState = await cantonSDKWallet.connect();
        if (sdkState.connected && sdkState.party) {
          const walletState: WalletState = {
            connected: true,
            party: sdkState.party,
            displayName: sdkState.displayName || sdkState.party,
            balances: [],
          };
          setState(walletState);
          setAuthToken(sdkState.party); // SDK manages auth internally
          return walletState;
        }
      } catch {
        // SDK not available or connect failed -- fall back to custom wallet
      }

      // Fallback: existing custom wallet connection
      const result = await wallet.connect(partyHint);
      // After successful connection, set the auth token for API requests
      const token = wallet.getCurrentToken();
      setAuthToken(token);
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
    setAuthToken(null);
    // Disconnect both SDK and custom wallet to ensure clean state
    await cantonSDKWallet.disconnect();
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
    typeof window !== 'undefined' && !!window.canton;

  return {
    ...state,
    connect,
    disconnect,
    refreshBalances,
    isExtensionAvailable,
    isSDKConnected,
    isConnecting,
    error,
  };
}
