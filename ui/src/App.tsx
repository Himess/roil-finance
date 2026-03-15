import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/pages/Dashboard';
import DCAPage from '@/pages/DCAPage';
import RewardsPage from '@/pages/RewardsPage';
import { PartyProvider, useParty } from '@/context/PartyContext';

function PartySelector() {
  const { party, setParty } = useParty();

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

function AppContent() {
  return (
    <div className="min-h-screen bg-slate-900">
      <Sidebar />

      {/* Main content area — offset by sidebar width */}
      <main className="ml-60 min-h-screen">
        {/* Party selector for dev/testing */}
        <PartySelector />

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
