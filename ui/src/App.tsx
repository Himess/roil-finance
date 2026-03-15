import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/pages/Dashboard';
import DCAPage from '@/pages/DCAPage';
import RewardsPage from '@/pages/RewardsPage';
import { PartyProvider, useParty } from '@/context/PartyContext';
import { useWallet } from '@/hooks/useWallet';

// ---------------------------------------------------------------------------
// PartySelector — manual party override for dev/testing.
// Hidden when wallet is connected (the wallet provides the party).
// ---------------------------------------------------------------------------

function PartySelector() {
  const { party, setParty } = useParty();
  const { connected } = useWallet();

  // When wallet is connected the party is driven by the wallet, not this input
  if (connected) return null;

  return (
    <div className="flex items-center gap-2 px-6 py-2 bg-slate-800/50 border-b border-slate-700">
      <label
        htmlFor="party-select"
        className="text-xs text-slate-500 shrink-0"
      >
        Party:
      </label>
      <input
        id="party-select"
        type="text"
        value={party}
        onChange={(e) => setParty(e.target.value)}
        className="flex-1 max-w-md bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
        spellCheck={false}
      />
      <span className="text-xs text-slate-600">(dev/testing)</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WalletPartySync — syncs the wallet party into PartyContext
// ---------------------------------------------------------------------------

function WalletPartySync() {
  const { connected, party: walletParty } = useWallet();
  const { setParty } = useParty();

  useEffect(() => {
    if (connected && walletParty) {
      setParty(walletParty);
    }
  }, [connected, walletParty, setParty]);

  return null;
}

// ---------------------------------------------------------------------------
// AppContent
// ---------------------------------------------------------------------------

function AppContent() {
  const { connected, displayName } = useWallet();

  return (
    <div className="min-h-screen bg-slate-900">
      <Sidebar />

      {/* Main content area — offset by sidebar width */}
      <main className="ml-60 min-h-screen">
        {/* Wallet-connected banner */}
        {connected && displayName && (
          <div className="flex items-center gap-2 px-6 py-2 bg-blue-600/10 border-b border-blue-500/20">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-blue-300">
              Wallet connected as{' '}
              <span className="font-semibold text-blue-200">
                {displayName}
              </span>
            </span>
          </div>
        )}

        {/* Party selector for dev/testing (hidden when wallet is connected) */}
        <PartySelector />

        {/* Sync wallet party -> PartyContext */}
        <WalletPartySync />

        <div className="max-w-6xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dca" element={<DCAPage />} />
            <Route path="/rewards" element={<RewardsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <PartyProvider>
      <AppContent />
    </PartyProvider>
  );
}
