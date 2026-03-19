import { useState, useEffect, useCallback } from 'react';
import {
  Sliders, TrendingUp, Zap, Bell, Shield, Check,
  Wallet, Globe, Key, Radio,
} from 'lucide-react';
import clsx from 'clsx';
import { useParty } from '@/context/PartyContext';
import { useToast } from '@/components/Toast';
import { apiFetch } from '@/hooks/useApi';
import { config } from '@/config';
import { useWallet } from '@/hooks/useWallet';

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'portfolio', label: 'Portfolio', icon: Sliders },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'compound', label: 'Auto-Compound', icon: Zap },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

// ---------------------------------------------------------------------------
// Toggle Component
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-12 h-7 rounded-full transition-colors duration-200 shrink-0',
        checked ? 'bg-accent' : 'bg-surface-muted',
      )}
    >
      <span className={clsx(
        'absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
        checked && 'translate-x-5',
      )} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Setting Row Component
// ---------------------------------------------------------------------------

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 flex items-center justify-between gap-6">
      <div className="flex-1 min-w-0">
        <h4 className="text-lg font-semibold text-ink">{title}</h4>
        <p className="text-base text-ink-secondary mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { party } = useParty();
  const { addToast } = useToast();
  const { connected: walletConnected } = useWallet();
  const [activeSection, setActiveSection] = useState<SectionId>('portfolio');

  // Portfolio settings
  const [autoRebalance, setAutoRebalance] = useState(() => localStorage.getItem('autoRebalance') !== 'false');
  const [driftThreshold, setDriftThreshold] = useState(() => parseInt(localStorage.getItem('driftThreshold') || '5'));
  const [slippage, setSlippage] = useState(() => parseFloat(localStorage.getItem('slippageTolerance') || '1'));

  // Compound settings
  const [compoundEnabled, setCompoundEnabled] = useState(false);
  const [compoundStrategy, setCompoundStrategy] = useState('portfolio-targets');

  // Notifications
  const [notifRebalance, setNotifRebalance] = useState(true);
  const [notifDCA, setNotifDCA] = useState(true);
  const [notifPrice, setNotifPrice] = useState(false);
  const [notifRewards, setNotifRewards] = useState(true);

  // Trading
  const [priceConditions, setPriceConditions] = useState(true);
  const [simulationMode, setSimulationMode] = useState(false);

  // Track changes
  const [hasChanges, setHasChanges] = useState(false);

  // Load compound config from backend
  useEffect(() => {
    apiFetch(`${config.backendUrl}/api/compound/${encodeURIComponent(party)}/config`)
      .then((data: any) => {
        if (data) {
          setCompoundEnabled(data.enabled ?? false);
          setCompoundStrategy(data.strategy ?? 'portfolio-targets');
        }
      })
      .catch(() => {});
  }, [party]);

  // Load notification prefs from localStorage
  useEffect(() => {
    const n = localStorage.getItem('notifications');
    if (n === 'false') {
      setNotifRebalance(false);
      setNotifDCA(false);
      setNotifRewards(false);
    }
  }, []);

  const markChanged = useCallback(() => setHasChanges(true), []);

  const handleSave = useCallback(async () => {
    // Save to localStorage
    localStorage.setItem('autoRebalance', String(autoRebalance));
    localStorage.setItem('driftThreshold', String(driftThreshold));
    localStorage.setItem('slippageTolerance', String(slippage));
    localStorage.setItem('notifications', String(notifRebalance || notifDCA || notifRewards));

    // Save compound to backend
    try {
      await apiFetch(`${config.backendUrl}/api/compound/${encodeURIComponent(party)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          strategy: compoundStrategy,
          minYieldThreshold: 10,
          enabled: compoundEnabled,
        }),
      });
      addToast('success', 'Settings saved');
      setHasChanges(false);
    } catch {
      addToast('error', 'Failed to save settings');
    }
  }, [party, autoRebalance, driftThreshold, slippage, compoundEnabled, compoundStrategy, notifRebalance, notifDCA, notifRewards, addToast]);

  const handleDiscard = useCallback(() => {
    setAutoRebalance(localStorage.getItem('autoRebalance') !== 'false');
    setDriftThreshold(parseInt(localStorage.getItem('driftThreshold') || '5'));
    setSlippage(parseFloat(localStorage.getItem('slippageTolerance') || '1'));
    setHasChanges(false);
  }, []);

  // Helpers to set + mark changed
  const set = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) => (v: T) => { setter(v); markChanged(); };

  const DRIFT_OPTIONS = [1, 3, 5, 7, 10, 15, 20];
  const SLIPPAGE_OPTIONS = [0.5, 1, 2, 3, 5];

  const STRATEGIES = [
    { id: 'portfolio-targets', name: 'Portfolio Targets', description: 'Reinvest based on your target allocation percentages' },
    { id: 'same-asset', name: 'Same Asset', description: 'Keep yields in the earning asset for compound growth' },
    { id: 'usdc-only', name: 'USDC Only', description: 'Convert all yields to stablecoins for safety' },
  ];

  return (
    <div className="flex gap-8 h-full">
      {/* Left: Section Navigation */}
      <div className="w-56 shrink-0">
        <h1 className="text-3xl font-extrabold text-ink mb-6">Settings</h1>
        <nav className="flex flex-col gap-1">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-lg text-left transition-colors',
                  activeSection === s.id
                    ? 'bg-white shadow-sm font-semibold text-ink'
                    : 'text-ink-secondary hover:bg-surface-hover',
                )}
              >
                <Icon className="w-5 h-5" />
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right: Active Section Content */}
      <div className="flex-1 max-w-3xl space-y-4">

        {/* ============ PORTFOLIO ============ */}
        {activeSection === 'portfolio' && (
          <>
            <SettingRow title="Auto-Rebalance" description="Automatically rebalance when drift exceeds threshold">
              <Toggle checked={autoRebalance} onChange={set(setAutoRebalance)} label="Auto-Rebalance" />
            </SettingRow>

            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-1">Drift Threshold</h4>
              <p className="text-base text-ink-secondary mb-4">Portfolio rebalances when any asset drifts more than {driftThreshold}% from target</p>
              <div className="flex gap-2 flex-wrap">
                {DRIFT_OPTIONS.map(v => (
                  <button
                    key={v}
                    onClick={() => { setDriftThreshold(v); markChanged(); }}
                    className={clsx(
                      'px-4 py-2 rounded-full text-base font-medium transition-colors',
                      driftThreshold === v ? 'bg-accent text-white' : 'bg-surface-muted text-ink-secondary hover:bg-surface-hover',
                    )}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-1">Slippage Tolerance</h4>
              <p className="text-base text-ink-secondary mb-4">Maximum price impact accepted per swap</p>
              <div className="flex gap-2 flex-wrap">
                {SLIPPAGE_OPTIONS.map(v => (
                  <button
                    key={v}
                    onClick={() => { setSlippage(v); markChanged(); }}
                    className={clsx(
                      'px-4 py-2 rounded-full text-base font-medium transition-colors',
                      slippage === v ? 'bg-accent text-white' : 'bg-surface-muted text-ink-secondary hover:bg-surface-hover',
                    )}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ============ TRADING ============ */}
        {activeSection === 'trading' && (
          <>
            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-1">Platform Fee</h4>
              <p className="text-base text-ink-secondary">Current: 0.1% per swap</p>
              <p className="text-base text-ink-muted mt-2">Fee is distributed to CC stakers and platform maintenance</p>
            </div>

            <SettingRow title="Price Condition Triggers" description='Enable "sell above X" / "buy below Y" automatic triggers'>
              <Toggle checked={priceConditions} onChange={set(setPriceConditions)} label="Price Conditions" />
            </SettingRow>

            <SettingRow title="Simulation Mode" description="Run rebalances as dry-run first before executing">
              <Toggle checked={simulationMode} onChange={set(setSimulationMode)} label="Simulation Mode" />
            </SettingRow>
          </>
        )}

        {/* ============ AUTO-COMPOUND ============ */}
        {activeSection === 'compound' && (
          <>
            <SettingRow title="Enable Auto-Compound" description="Automatically reinvest staking, lending, and LP yields">
              <Toggle checked={compoundEnabled} onChange={set(setCompoundEnabled)} label="Auto-Compound" />
            </SettingRow>

            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-1">Reinvestment Strategy</h4>
              <p className="text-base text-ink-secondary mb-4">Choose how yields are reinvested into your portfolio</p>
              <div className="grid grid-cols-3 gap-4">
                {STRATEGIES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setCompoundStrategy(s.id); markChanged(); }}
                    className={clsx(
                      'card p-5 text-left transition-all',
                      compoundStrategy === s.id
                        ? 'border-2 border-accent bg-accent-light shadow-md'
                        : 'hover:shadow-md',
                    )}
                  >
                    <div className="text-lg font-semibold text-ink">{s.name}</div>
                    <div className="text-base text-ink-secondary mt-2">{s.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ============ NOTIFICATIONS ============ */}
        {activeSection === 'notifications' && (
          <>
            <SettingRow title="Rebalance Alerts" description="Get notified when auto-rebalance executes">
              <Toggle checked={notifRebalance} onChange={set(setNotifRebalance)} label="Rebalance Alerts" />
            </SettingRow>
            <SettingRow title="DCA Execution" description="Notify on each dollar-cost averaging buy">
              <Toggle checked={notifDCA} onChange={set(setNotifDCA)} label="DCA Notifications" />
            </SettingRow>
            <SettingRow title="Price Alerts" description="Alert when tokens hit price condition triggers">
              <Toggle checked={notifPrice} onChange={set(setNotifPrice)} label="Price Alerts" />
            </SettingRow>
            <SettingRow title="Reward Payouts" description="Monthly CC reward distribution alerts">
              <Toggle checked={notifRewards} onChange={set(setNotifRewards)} label="Reward Notifications" />
            </SettingRow>
          </>
        )}

        {/* ============ SECURITY ============ */}
        {activeSection === 'security' && (
          <>
            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-4">Connection Status</h4>
              <div className="space-y-3">
                {[
                  { icon: Wallet, label: 'Wallet', value: walletConnected ? 'Connected via Canton SDK' : 'Not connected', ok: walletConnected },
                  { icon: Globe, label: 'Network', value: 'Canton Devnet', ok: true },
                  { icon: Key, label: 'Auth', value: 'JWT RS256 signed', ok: true },
                  { icon: Radio, label: 'Ledger', value: 'Synced', ok: true },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3">
                    <div className={clsx('w-2.5 h-2.5 rounded-full shrink-0', item.ok ? 'bg-positive' : 'bg-ink-muted')} />
                    <item.icon className="w-4 h-4 text-ink-muted" />
                    <span className="text-base text-ink-secondary w-20">{item.label}</span>
                    <span className="text-base text-ink flex-1">{item.value}</span>
                    {item.ok && <Check className="w-4 h-4 text-positive" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <h4 className="text-lg font-semibold text-ink mb-3">Privacy</h4>
              <div className="space-y-2">
                {[
                  'All portfolio data is encrypted on Canton',
                  'Sub-transaction privacy enabled',
                  'Only you can see your allocations',
                ].map(text => (
                  <div key={text} className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-base text-ink">{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1 py-3 text-lg">Disconnect Wallet</button>
              <button className="btn-secondary flex-1 py-3 text-lg">Export Data</button>
            </div>
          </>
        )}
      </div>

      {/* Floating Save Bar */}
      {hasChanges && (
        <div className="fixed bottom-6 right-6 flex gap-3 animate-slide-in z-50">
          <button
            onClick={handleDiscard}
            className="px-6 py-3 rounded-xl text-lg font-medium bg-white border border-surface-border hover:bg-surface-hover shadow-lg"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            className="px-8 py-3 rounded-xl text-lg font-semibold bg-accent text-white hover:bg-accent-hover shadow-lg"
          >
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
