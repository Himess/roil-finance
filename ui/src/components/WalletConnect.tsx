import { useState, useRef, useEffect } from 'react';
import { Wallet, ChevronDown, LogOut, RefreshCw, Plug } from 'lucide-react';
import clsx from 'clsx';
import { useWallet } from '@/hooks/useWallet';
import { truncateParty } from '@/lib/canton-wallet';

// ---------------------------------------------------------------------------
// WalletConnect component
//
// Renders a connect button when disconnected.
// When connected, shows the party name, truncated ID, and a balance summary
// in a dropdown with balances and a disconnect action.
// ---------------------------------------------------------------------------

export default function WalletConnect() {
  const {
    connected,
    party,
    displayName,
    balances,
    connect,
    disconnect,
    refreshBalances,
    isExtensionAvailable,
    isSDKConnected,
    isConnecting,
    error,
  } = useWallet();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [partyHint, setPartyHint] = useState('');
  const [showHintInput, setShowHintInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ------- Handlers -------

  const handleConnect = async () => {
    try {
      if (!isExtensionAvailable && !partyHint) {
        // Show the hint input so user can enter a party ID for dev mode
        setShowHintInput(true);
        return;
      }
      await connect(partyHint || undefined);
      setShowHintInput(false);
      setPartyHint('');
    } catch {
      // error state is managed by useWallet
    }
  };

  const handleConnectWithHint = async () => {
    try {
      await connect(partyHint || undefined);
      setShowHintInput(false);
      setPartyHint('');
    } catch {
      // error state is managed by useWallet
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    setDropdownOpen(false);
  };

  const handleRefresh = async () => {
    await refreshBalances();
  };

  // ------- CC balance summary -------

  const ccBalance = balances.find((b) => b.instrumentId === 'CC');
  const ccTotal = ccBalance ? ccBalance.amount : null;

  // ------- Render: Disconnected state -------

  if (!connected) {
    return (
      <div className="px-3">
        {/* Dev mode hint input */}
        {showHintInput && !isExtensionAvailable && (
          <div className="mb-2">
            <label className="text-sm text-ink-muted block mb-1">
              Party ID (dev mode)
            </label>
            <input
              type="text"
              value={partyHint}
              onChange={(e) => setPartyHint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConnectWithHint();
              }}
              placeholder="e.g. Alice::1220..."
              className="w-full bg-surface border border-surface-border rounded px-2 py-1.5 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-accent mb-1.5"
              spellCheck={false}
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleConnectWithHint}
                disabled={isConnecting}
                className="flex-1 bg-accent hover:bg-accent-hover text-white text-sm font-medium py-1.5 px-2 rounded transition-colors disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
              <button
                onClick={() => {
                  setShowHintInput(false);
                  setPartyHint('');
                }}
                className="bg-surface-muted hover:bg-surface-hover text-ink text-sm font-medium py-1.5 px-2 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Main connect button */}
        {!showHintInput && (
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex items-center gap-2 w-full bg-accent hover:bg-accent-hover text-white text-base font-medium py-2.5 px-3 rounded-lg transition-colors disabled:opacity-50"
          >
            <Wallet className="w-4 h-4" />
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}

        {/* Extension badge */}
        {!showHintInput && (
          <div className="flex items-center gap-1.5 mt-2 px-1">
            <Plug className="w-3 h-3 text-ink-muted" />
            <span className="text-sm text-ink-muted">
              {isExtensionAvailable
                ? 'Canton extension detected'
                : 'Canton SDK + Dev mode (JSON API)'}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-negative mt-1.5 px-1">{error}</p>
        )}
      </div>
    );
  }

  // ------- Render: Connected state -------

  return (
    <div className="px-3 relative" ref={dropdownRef}>
      {/* Connected button / trigger */}
      <button
        onClick={() => setDropdownOpen((prev) => !prev)}
        className={clsx(
          'flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-left transition-colors',
          'bg-surface-muted hover:bg-surface-hover border border-surface-border',
        )}
      >
        {/* Green status dot */}
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-ink truncate">
            {displayName ?? 'Connected'}
          </p>
          <p className="text-sm text-ink-muted font-mono truncate">
            {party ? truncateParty(party) : ''}
          </p>
        </div>

        <ChevronDown
          className={clsx(
            'w-4 h-4 text-ink-secondary transition-transform shrink-0',
            dropdownOpen && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown */}
      {dropdownOpen && (
        <div className="absolute left-3 right-3 bottom-full mb-2 bg-white border border-surface-border rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Balance summary */}
          <div className="px-4 py-3 border-b border-surface-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-secondary font-medium">
                Balances
              </span>
              <button
                onClick={handleRefresh}
                className="text-ink-secondary hover:text-ink transition-colors"
                title="Refresh balances"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {balances.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {balances.map((b) => (
                  <div
                    key={b.instrumentId}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm text-ink font-medium">
                      {b.instrumentId}
                    </span>
                    <div className="text-right">
                      <span className="text-sm text-ink font-medium">
                        {b.amount.toLocaleString()}
                      </span>
                      {b.locked > 0 && (
                        <span className="text-sm text-ink-muted ml-1">
                          ({b.locked.toLocaleString()} locked)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {ccTotal !== null && (
                  <div className="pt-1.5 mt-1.5 border-t border-surface-border flex items-center justify-between">
                    <span className="text-sm text-ink-secondary">CC Balance</span>
                    <span className="text-sm text-ink font-semibold">
                      {ccTotal.toLocaleString()} CC
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-muted mt-2">
                No balances found
              </p>
            )}
          </div>

          {/* Party info */}
          <div className="px-4 py-2.5 border-b border-surface-border">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-muted">Party</p>
              {isSDKConnected && (
                <span className="text-sm text-accent bg-accent-light px-1.5 py-0.5 rounded">
                  via Canton SDK
                </span>
              )}
            </div>
            <p className="text-sm text-ink font-mono break-all mt-0.5">
              {party}
            </p>
          </div>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-negative hover:bg-surface-hover transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-negative mt-1.5 px-1">{error}</p>
      )}
    </div>
  );
}
