import { useState } from 'react';
import { ShieldCheck, Key, Timer } from 'lucide-react';

// ---------------------------------------------------------------------------
// Toggle Component
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="relative w-[48px] h-[28px] rounded-full cursor-pointer transition-all duration-200"
      style={{ backgroundColor: checked ? '#059669' : '#E5E7EB' }}
    >
      <div
        className="absolute top-[2px] left-[2px] w-[24px] h-[24px] bg-white rounded-full shadow transition-transform duration-200"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slippage options
// ---------------------------------------------------------------------------

const SLIPPAGE_OPTIONS = [0.5, 1.0, 2.0, 5.0];

// ---------------------------------------------------------------------------
// Strategy options
// ---------------------------------------------------------------------------

const STRATEGIES = [
  {
    id: 'portfolio-targets',
    name: 'Portfolio Targets',
    description: 'Reinvest yields according to target allocation',
  },
  {
    id: 'same-asset',
    name: 'Same Asset',
    description: 'Reinvest back into the same yielding asset',
  },
  {
    id: 'usdc-only',
    name: 'USDC Only',
    description: 'Convert all yields to stablecoin',
  },
];

// ---------------------------------------------------------------------------
// Notification rows
// ---------------------------------------------------------------------------

const NOTIFICATION_DEFAULTS: { label: string; defaultOn: boolean }[] = [
  { label: 'Rebalance alerts', defaultOn: true },
  { label: 'DCA execution', defaultOn: true },
  { label: 'Reward payouts', defaultOn: true },
  { label: 'Price alerts', defaultOn: false },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Settings() {
  // Auto-Rebalance
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [driftThreshold, setDriftThreshold] = useState(5);

  // Max Slippage
  const [slippage, setSlippage] = useState(0.5);

  // Auto-Compound Strategy
  const [compoundStrategy, setCompoundStrategy] = useState('portfolio-targets');

  // Notifications
  const [notifications, setNotifications] = useState<boolean[]>(
    NOTIFICATION_DEFAULTS.map((n) => n.defaultOn),
  );

  const toggleNotification = (index: number) => {
    setNotifications((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-[26px] font-bold text-ink">Settings</h1>

      <div className="flex gap-6">
      {/* ==================== LEFT COLUMN ==================== */}
      <div className="flex-1 space-y-5">
        {/* --- Auto-Rebalance Card --- */}
        <div className="bg-[#F3F4F9] border border-surface-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg font-semibold text-ink">Auto-Rebalance</span>
            <Toggle checked={autoRebalance} onChange={setAutoRebalance} />
          </div>
          <p className="text-sm text-ink-secondary mb-5">
            Automatically rebalance your portfolio when allocation drifts beyond
            the set threshold.
          </p>

          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">Drift Threshold</span>
            <span className="text-xs font-semibold bg-[#E0F5EA] text-[#059669] px-2.5 py-0.5 rounded-full">
              {driftThreshold.toFixed(1)}%
            </span>
          </div>

          <input
            type="range"
            min={1}
            max={20}
            step={0.1}
            value={driftThreshold}
            onChange={(e) => setDriftThreshold(parseFloat(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: '#059669' }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-ink-muted">1%</span>
            <span className="text-xs text-ink-muted">20%</span>
          </div>
        </div>

        {/* --- Max Slippage Card --- */}
        <div className="bg-[#F3F4F9] border border-surface-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-lg font-semibold text-ink">Max Slippage</span>
            <span className="text-xs font-semibold bg-[#E0F5EA] text-[#059669] px-2.5 py-0.5 rounded-full">
              {slippage.toFixed(1)}%
            </span>
          </div>

          <div className="flex gap-3">
            {SLIPPAGE_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setSlippage(opt)}
                className={
                  slippage === opt
                    ? 'flex-1 py-2 rounded-xl text-sm font-medium bg-[#059669] text-white transition-colors'
                    : 'flex-1 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors'
                }
              >
                {opt.toFixed(1)}%
              </button>
            ))}
          </div>
        </div>

        {/* --- Auto-Compound Strategy Card --- */}
        <div className="bg-[#F3F4F9] border border-surface-border rounded-2xl p-6">
          <span className="text-lg font-semibold text-ink block mb-4">
            Auto-Compound Strategy
          </span>

          <div className="space-y-3">
            {STRATEGIES.map((s) => {
              const selected = compoundStrategy === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setCompoundStrategy(s.id)}
                  className={`w-full text-left bg-white rounded-xl p-[14px_18px] transition-all ${
                    selected
                      ? 'border-2 border-[#059669]'
                      : 'border border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Radio dot */}
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selected ? 'border-[#059669]' : 'border-gray-300'
                      }`}
                    >
                      {selected && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[#059669]" />
                      )}
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-ink">{s.name}</div>
                      <div className="text-xs text-ink-secondary mt-0.5">
                        {s.description}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ==================== RIGHT COLUMN ==================== */}
      <div className="w-[380px] space-y-5">
        {/* --- Notifications Card --- */}
        <div className="bg-[#F3F4F9] border border-surface-border rounded-2xl p-6">
          <span className="text-lg font-semibold text-ink block mb-4">
            Notifications
          </span>

          <div className="space-y-4">
            {NOTIFICATION_DEFAULTS.map((item, idx) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-ink">{item.label}</span>
                <Toggle
                  checked={notifications[idx]}
                  onChange={() => toggleNotification(idx)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* --- Security Card --- */}
        <div className="bg-[#F3F4F9] border border-surface-border rounded-2xl p-6">
          <span className="text-lg font-semibold text-ink block mb-4">
            Security
          </span>

          <div className="space-y-4">
            {/* Wallet Connected */}
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-[#059669] shrink-0" />
              <span className="text-sm text-ink flex-1">Wallet Connected</span>
              <span className="text-xs font-semibold bg-[#E0F5EA] text-[#059669] px-2.5 py-0.5 rounded-full">
                Verified
              </span>
            </div>

            {/* 2FA */}
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-[#059669] shrink-0" />
              <span className="text-sm text-ink flex-1">2FA</span>
              <span className="text-xs font-semibold bg-[#E0F5EA] text-[#059669] px-2.5 py-0.5 rounded-full">
                Enabled
              </span>
            </div>

            {/* Last Login */}
            <div className="flex items-center gap-3">
              <Timer className="w-5 h-5 text-gray-400 shrink-0" />
              <span className="text-sm text-ink flex-1">Last Login</span>
              <span className="text-xs font-medium text-gray-500">
                2 hours ago
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
