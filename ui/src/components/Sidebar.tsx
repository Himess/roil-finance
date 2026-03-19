import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  PlusCircle,
  Repeat2,
  Trophy,
  Settings,
  Layers,
  Menu,
  X,
  Shield,
} from 'lucide-react';
import clsx from 'clsx';
import { useBackendStatus } from '@/hooks/useApi';
import { useWallet } from '@/hooks/useWallet';
import WalletConnect from '@/components/WalletConnect';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create', label: 'Create', icon: PlusCircle },
  { to: '/dca', label: 'DCA', icon: Repeat2 },
  { to: '/rewards', label: 'Rewards', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export default function Sidebar() {
  const { status } = useBackendStatus(10_000);
  const { connected } = useWallet();

  const backendStatusColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'disconnected'
        ? 'bg-red-500'
        : 'bg-yellow-500';

  const backendStatusLabel =
    status === 'connected'
      ? 'Backend Connected'
      : status === 'disconnected'
        ? 'Backend Offline'
        : 'Checking...';

  const walletStatusColor = connected ? 'bg-green-500' : 'bg-ink-faint';
  const walletStatusLabel = connected ? 'Wallet Connected' : 'Not Connected';

  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-surface-border">
        <img src="/logo.jpg" alt="Roil" className="w-12 h-12 rounded-lg object-cover" />
        <h1 className="text-2xl font-extrabold text-ink">Roil</h1>
        {/* Close button on mobile */}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto md:hidden text-ink-secondary hover:text-ink"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-lg transition-colors',
                isActive
                  ? 'bg-accent-light text-accent font-bold'
                  : 'text-ink-secondary hover:text-ink hover:bg-surface-hover font-medium',
              )
            }
          >
            <Icon className="w-4.5 h-4.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-surface-border space-y-3">
        {/* Wallet connect */}
        <WalletConnect />

        {/* Canton Network / wallet status */}
        <div className="px-3 mt-1">
          <div className="text-base text-ink-secondary">Canton Network</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={clsx('w-2 h-2 rounded-full', walletStatusColor)} />
            <span className="text-base text-ink-muted">{walletStatusLabel}</span>
          </div>
        </div>

        {/* Backend API status */}
        <div className="px-3">
          <div className="text-base text-ink-secondary">Backend API</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={clsx('w-2 h-2 rounded-full', backendStatusColor)} />
            <span className="text-base text-ink-muted">{backendStatusLabel}</span>
          </div>
          {status === 'disconnected' && (
            <span className="text-base text-ink-secondary mt-0.5 block">
              Using demo data
            </span>
          )}
        </div>

        {/* Ledger sync status */}
        <div className="px-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-base text-ink-secondary">
              Ledger: {status === 'connected' ? 'Synced' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Canton privacy badge */}
        <div className="px-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <Shield className="w-4 h-4 text-emerald-700" />
            <span className="text-base text-emerald-700">Privacy-enabled ledger</span>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-40 md:hidden p-2 bg-surface-card border border-surface-border rounded-lg text-ink-secondary hover:text-ink"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={clsx(
          'fixed top-0 left-0 h-screen w-60 border-r border-surface-border flex flex-col z-50 transition-transform md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar — always visible */}
      <aside className="hidden md:flex fixed top-0 left-0 h-screen w-60 border-r border-surface-border flex-col z-30">
        {sidebarContent}
      </aside>
    </>
  );
}
