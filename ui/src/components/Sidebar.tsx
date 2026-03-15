import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Repeat2,
  Trophy,
  Settings,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';
import { useBackendStatus } from '@/hooks/useApi';
import { useWallet } from '@/hooks/useWallet';
import WalletConnect from '@/components/WalletConnect';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/dca', label: 'DCA', icon: Repeat2 },
  { to: '/rewards', label: 'Rewards', icon: Trophy },
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

  const walletStatusColor = connected ? 'bg-green-500' : 'bg-slate-500';
  const walletStatusLabel = connected ? 'Wallet Connected' : 'Not Connected';

  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-slate-950 border-r border-slate-800 flex flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-slate-800">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-white leading-tight">
            Canton
          </h1>
          <p className="text-xs text-slate-400 leading-tight">Rebalancer</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600/15 text-blue-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
              )
            }
          >
            <Icon className="w-4.5 h-4.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-slate-800 space-y-3">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors w-full">
          <Settings className="w-4.5 h-4.5" />
          Settings
        </button>

        {/* Wallet connect */}
        <WalletConnect />

        {/* Canton Network / wallet status */}
        <div className="px-3 mt-1">
          <div className="text-xs text-slate-600">Canton Network</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={clsx('w-2 h-2 rounded-full', walletStatusColor)} />
            <span className="text-xs text-slate-500">{walletStatusLabel}</span>
          </div>
        </div>

        {/* Backend API status */}
        <div className="px-3">
          <div className="text-xs text-slate-600">Backend API</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={clsx('w-2 h-2 rounded-full', backendStatusColor)} />
            <span className="text-xs text-slate-500">{backendStatusLabel}</span>
          </div>
          {status === 'disconnected' && (
            <span className="text-xs text-slate-600 mt-0.5 block">
              Using demo data
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
