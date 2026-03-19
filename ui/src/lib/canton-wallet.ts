/**
 * Canton Wallet Integration
 *
 * Supported wallet connections:
 * 1. Canton Browser Extension (window.canton) — native Canton wallet
 * 2. JSON API Direct Mode — for development/testing
 *
 * Future integrations:
 * - @canton-network/dapp-sdk — official Canton dApp SDK
 * - WalletConnect — for mobile wallet support
 * - Ledger Hardware Wallet — via @ledgerhq/app-canton
 *
 * To add a new wallet provider:
 * 1. Implement the CantonExtension interface (see canton.d.ts)
 * 2. Add detection in connectExtension()
 * 3. Add balance fetching in fetchBalancesViaExtension()
 */

// ---------------------------------------------------------------------------
// Canton Wallet abstraction
//
// Two modes:
//   1. Browser extension (window.canton) -- production
//   2. Direct JSON API connection         -- development
// ---------------------------------------------------------------------------

export interface WalletState {
  connected: boolean;
  party: string | null;       // full party ID (e.g., "Alice::1220abcd...")
  displayName: string | null; // friendly name extracted from the party ID
  balances: TokenBalance[];
}

export interface TokenBalance {
  instrumentId: string;
  amount: number;
  locked: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a minimal unsigned JWT for dev-mode JSON API auth */
function buildDevJwt(party: string): string {
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub: party,
    iss: 'roil-finance-dev',
    aud: 'canton-json-api',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'daml_ledger_api',
    actAs: [party],
    readAs: [party],
    applicationId: 'roil-finance-ui',
  };
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode(header)}.${encode(payload)}.`;
}

/** Extract a friendly display name from a full Canton party ID */
function extractDisplayName(party: string): string {
  // "Alice::1220abcd..." -> "Alice"
  const idx = party.indexOf('::');
  if (idx > 0) return party.slice(0, idx);
  return party;
}

/** Truncate a party ID for display: "Alice::1220ab...ef12" */
export function truncateParty(party: string, tailLen = 4): string {
  const idx = party.indexOf('::');
  if (idx < 0 || party.length < idx + 6 + tailLen) return party;
  const prefix = party.slice(0, idx + 2); // "Alice::"
  const hash = party.slice(idx + 2);
  if (hash.length <= 8) return party;
  return `${prefix}${hash.slice(0, 4)}...${hash.slice(-tailLen)}`;
}

// ---------------------------------------------------------------------------
// CantonWallet class
// ---------------------------------------------------------------------------

export class CantonWallet {
  private state: WalletState = {
    connected: false,
    party: null,
    displayName: null,
    balances: [],
  };

  private listeners: Set<(state: WalletState) => void> = new Set();
  private jsonApiUrl: string;
  private devToken: string | null = null;

  constructor(options?: { jsonApiUrl?: string }) {
    this.jsonApiUrl = options?.jsonApiUrl || 'http://localhost:3975';
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Connect the wallet.
   * Tries the Canton browser extension first; falls back to direct JSON API.
   * @param partyHint  party ID to use when connecting via JSON API (dev mode)
   */
  async connect(partyHint?: string): Promise<WalletState> {
    // Check for Canton browser extension
    if (typeof window !== 'undefined' && window.canton) {
      return this.connectViaExtension();
    }
    // Fallback: direct JSON API connection (dev mode)
    return this.connectViaJsonApi(partyHint || 'app-user');
  }

  /** Disconnect the wallet and reset state */
  async disconnect(): Promise<void> {
    this.devToken = null;
    this.updateState({
      connected: false,
      party: null,
      displayName: null,
      balances: [],
    });
  }

  /** Refresh token balances from the ledger */
  async refreshBalances(): Promise<TokenBalance[]> {
    if (!this.state.connected || !this.state.party) return [];

    try {
      if (typeof window !== 'undefined' && window.canton) {
        return this.fetchBalancesViaExtension();
      }
      return this.fetchBalancesViaJsonApi();
    } catch (err) {
      console.warn('[CantonWallet] Failed to refresh balances:', err);
      return this.state.balances;
    }
  }

  /**
   * Sign and submit a Daml command via the wallet.
   * In extension mode, delegates to the browser extension.
   * In dev mode, submits directly via JSON API.
   */
  async submitTransaction(commands: unknown[]): Promise<unknown> {
    if (typeof window !== 'undefined' && window.canton) {
      return window.canton.request({
        method: 'canton_submitTransaction',
        params: commands,
      });
    }

    // Dev mode — submit via JSON API /v2/commands/submit-and-wait
    if (!this.devToken || !this.state.party) {
      throw new Error('Wallet not connected');
    }

    const res = await fetch(`${this.jsonApiUrl}/v2/commands/submit-and-wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.devToken}`,
      },
      body: JSON.stringify({
        commands,
        actAs: [this.state.party],
        readAs: [this.state.party],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Submit failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  /** Subscribe to wallet state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: WalletState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Return a snapshot of the current wallet state */
  getState(): WalletState {
    return { ...this.state };
  }

  /** Return the current dev JWT token (or null if not connected or using extension) */
  getCurrentToken(): string | null {
    return this.devToken;
  }

  // -----------------------------------------------------------------------
  // Extension-based connection
  // -----------------------------------------------------------------------

  private async connectViaExtension(): Promise<WalletState> {
    const canton = window.canton!;

    try {
      const accounts: string[] = await canton.request({
        method: 'canton_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from Canton extension');
      }

      const party = accounts[0];
      const displayName = extractDisplayName(party);

      this.updateState({
        connected: true,
        party,
        displayName,
        balances: [],
      });

      // Best-effort balance fetch after connection
      try {
        const balances = await this.fetchBalancesViaExtension();
        this.updateState({ ...this.state, balances });
      } catch {
        // balances may not be available immediately
      }

      return this.getState();
    } catch (err) {
      console.error('[CantonWallet] Extension connection failed:', err);
      throw err;
    }
  }

  private async fetchBalancesViaExtension(): Promise<TokenBalance[]> {
    const canton = window.canton!;
    const result = await canton.request({
      method: 'canton_getBalances',
    });

    if (!Array.isArray(result)) return [];

    return result.map((b: any) => ({
      instrumentId: String(b.instrumentId ?? b.symbol ?? 'unknown'),
      amount: Number(b.amount ?? 0),
      locked: Number(b.locked ?? 0),
    }));
  }

  // -----------------------------------------------------------------------
  // JSON API-based connection (dev mode)
  // -----------------------------------------------------------------------

  private async connectViaJsonApi(userId: string): Promise<WalletState> {
    // Build an unsigned JWT for local dev
    const party = userId.includes('::') ? userId : `${userId}::dev`;
    this.devToken = buildDevJwt(party);

    // Try to verify the connection by querying the JSON API
    let verified = false;
    try {
      const endRes = await fetch(`${this.jsonApiUrl}/v2/state/ledger-end`, {
        headers: { 'Authorization': `Bearer ${this.devToken}` },
        signal: AbortSignal.timeout(5000),
      });
      verified = endRes.ok || endRes.status === 400; // 400 means reachable but bad query
    } catch {
      // JSON API not available — still allow connection in pure dev mode
    }

    const displayName = extractDisplayName(party);

    this.updateState({
      connected: true,
      party,
      displayName,
      balances: [],
    });

    // Attempt to fetch balances if API is reachable
    if (verified) {
      try {
        const balances = await this.fetchBalancesViaJsonApi();
        this.updateState({ ...this.state, balances });
      } catch {
        // continue without balances
      }
    }

    return this.getState();
  }

  private async fetchBalancesViaJsonApi(): Promise<TokenBalance[]> {
    if (!this.devToken || !this.state.party) return [];

    try {
      // First fetch ledger-end offset
      const endRes = await fetch(`${this.jsonApiUrl}/v2/state/ledger-end`, {
        headers: { 'Authorization': `Bearer ${this.devToken}` },
        signal: AbortSignal.timeout(5000),
      });
      const endData = await endRes.json();
      const offset = endData.offset;

      const templateId = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';

      // Then query with correct v2 format
      const res = await fetch(`${this.jsonApiUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.devToken}`,
        },
        body: JSON.stringify({
          eventFormat: {
            filtersByParty: {
              [this.state.party!]: {
                cumulative: [{ templateFilter: { value: templateId } }]
              }
            },
            verbose: true,
          },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];

      const data = await res.json();

      // Parse active contracts into TokenBalance entries
      const balances: TokenBalance[] = [];
      const contracts = data?.result ?? data?.events ?? [];

      for (const contract of contracts) {
        const payload = contract?.payload ?? contract?.created?.payload;
        if (!payload) continue;

        const instrumentId = payload?.instrument?.id?.unpack ?? payload?.instrument?.symbol ?? 'unknown';
        const amount = Number(payload?.amount ?? 0);
        const locked = Number(payload?.lock?.amount ?? 0);

        // Aggregate by instrument
        const existing = balances.find((b) => b.instrumentId === instrumentId);
        if (existing) {
          existing.amount += amount;
          existing.locked += locked;
        } else {
          balances.push({ instrumentId, amount, locked });
        }
      }

      return balances;
    } catch (err) {
      console.warn('[CantonWallet] Balance fetch via JSON API failed:', err);
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  private updateState(newState: WalletState) {
    this.state = { ...newState };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.error('[CantonWallet] Listener error:', err);
      }
    }
  }
}
