import { useEffect } from 'react';
import { Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/pages/Dashboard';
import CreatePortfolio from '@/pages/CreatePortfolio';
import DCAPage from '@/pages/DCAPage';
import RewardsPage from '@/pages/RewardsPage';
import TransactionDetail from '@/pages/TransactionDetail';
import SettingsPage from '@/pages/SettingsPage';
import Slides from '@/pages/Slides';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { PartyProvider, useParty } from '@/context/PartyContext';
import { useWallet } from '@/hooks/useWallet';

function ReferralRedirect() {
  const { code } = useParams();
  // Store referral code in localStorage for later use
  if (code) localStorage.setItem('referralCode', code);
  return <Navigate to="/rewards" replace />;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-4xl font-bold text-ink mb-2">404</h1>
      <p className="text-ink-secondary mb-6">Page not found</p>
      <Link to="/" className="btn-primary">
        Return to Dashboard
      </Link>
    </div>
  );
}

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
    <div className="px-4 py-1 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
      <div className="flex items-center gap-1.5 shrink-0">
        <Wrench className="w-3.5 h-3.5 text-amber-700" />
        <span className="text-sm font-semibold text-amber-700">Dev</span>
      </div>
      <div className="flex items-center gap-2 flex-1">
        <label
          htmlFor="party-select"
          className="text-sm text-ink-muted shrink-0"
        >
          Party:
        </label>
        <input
          id="party-select"
          type="text"
          value={party}
          onChange={(e) => setParty(e.target.value)}
          className="flex-1 max-w-md bg-surface border border-amber-200 rounded px-2 py-1 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
          spellCheck={false}
        />
      </div>
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
    <div className="h-screen overflow-hidden">
      <Sidebar />

      {/* Main content area — offset by fixed sidebar, full height */}
      <main className="h-screen overflow-y-auto pt-14 md:pt-0 md:ml-60 flex flex-col">
        {/* Wallet-connected banner */}
        {connected && displayName && (
          <div className="flex items-center gap-2 px-6 py-2 bg-accent-light border-b border-blue-200">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-base text-accent">
              Wallet connected as{' '}
              <span className="font-semibold text-accent-hover">
                {displayName}
              </span>
            </span>
          </div>
        )}

        {/* Party selector for dev/testing (hidden when wallet is connected) */}
        <PartySelector />

        {/* Sync wallet party -> PartyContext */}
        <WalletPartySync />

        <div className="flex-1 flex flex-col min-h-0 mx-auto p-3 w-full">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/create" element={<CreatePortfolio />} />
              <Route path="/dca" element={<DCAPage />} />
              <Route path="/rewards" element={<RewardsPage />} />
              <Route path="/tx/:id" element={<TransactionDetail />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/ref/:code" element={<ReferralRedirect />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <PartyProvider>
      <ToastProvider>
        <Routes>
          <Route path="/slides" element={<Slides />} />
          <Route path="/*" element={<AppContent />} />
        </Routes>
      </ToastProvider>
    </PartyProvider>
  );
}
