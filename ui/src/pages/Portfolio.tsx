import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Pause, Play, Trash2, Edit3, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { TOKEN_LOGOS } from '@/config';

/* ------------------------------------------------------------------ */
/* Token accent colors                                                 */
/* ------------------------------------------------------------------ */
const TOKEN_ACCENT: Record<string, string> = {
  CC: '#059669', USDCx: '#2563EB', CBTC: '#F59E0B', ETHx: '#8B5CF6',
  SOLx: '#14F195', XAUt: '#D97706', XAGt: '#A8A9AD', USTb: '#1E40AF',
};

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */
interface TokenAllocation {
  symbol: string;
  targetPct: number;
  currentPct: number;
  holdings: string;
  value: string;
  change24h: number;
}

const PORTFOLIO_TOKENS: TokenAllocation[] = [
  { symbol: 'CBTC', targetPct: 35, currentPct: 37.2, holdings: '1,250 CBTC', value: '$45,200', change24h: 2.4 },
  { symbol: 'ETHx', targetPct: 25, currentPct: 23.1, holdings: '12.5 ETHx', value: '$32,300', change24h: -1.2 },
  { symbol: 'CC', targetPct: 20, currentPct: 19.8, holdings: '5,800 CC', value: '$25,840', change24h: 0.8 },
  { symbol: 'XAUt', targetPct: 15, currentPct: 15.4, holdings: '8.2 XAUt', value: '$19,360', change24h: 0.3 },
  { symbol: 'USDCx', targetPct: 5, currentPct: 4.5, holdings: '6,450 USDCx', value: '$6,450', change24h: 0.0 },
];

interface RebalanceEvent {
  id: number;
  date: string;
  action: string;
  status: 'Completed' | 'Pending';
}

const REBALANCE_HISTORY: RebalanceEvent[] = [
  { id: 1, date: 'Mar 21, 2026', action: 'Sold 0.8 ETHx → Bought 412 CC', status: 'Completed' },
  { id: 2, date: 'Mar 12, 2026', action: 'Sold 0.015 CBTC → Bought 1,310 USDCx', status: 'Completed' },
  { id: 3, date: 'Feb 22, 2026', action: 'Sold 0.1 XAUt → Bought 580 CC', status: 'Completed' },
];

/* ------------------------------------------------------------------ */
/* Toggle component                                                    */
/* ------------------------------------------------------------------ */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="relative w-[44px] h-[26px] rounded-full cursor-pointer transition-all duration-200"
      style={{ backgroundColor: checked ? '#059669' : '#E5E7EB' }}
    >
      <div
        className="absolute top-[2px] left-[2px] w-[22px] h-[22px] bg-white rounded-full shadow transition-transform duration-200"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(0)' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm Dialog                                                      */
/* ------------------------------------------------------------------ */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl p-6 w-[420px] shadow-xl">
        <h3 className="text-[20px] font-bold text-[#111827] mb-2">{title}</h3>
        <p className="text-[14px] text-[#6B7280] mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl border border-[#D6D9E3] text-[14px] font-medium text-[#6B7280] hover:bg-[#F3F4F9] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white transition-opacity hover:opacity-90 ${
              danger
                ? 'bg-[#DC2626]'
                : 'bg-gradient-to-r from-[#059669] to-[#10B981]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export default function Portfolio() {
  const navigate = useNavigate();
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [paused, setPaused] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const totalValue = '$129,150';
  const driftThreshold = 5.0;
  const maxDrift = Math.max(
    ...PORTFOLIO_TOKENS.map((t) => Math.abs(t.currentPct - t.targetPct)),
  );
  const driftStatus = maxDrift > driftThreshold ? 'high' : maxDrift > driftThreshold * 0.6 ? 'medium' : 'low';

  const handleDelete = () => {
    setShowDeleteDialog(false);
    navigate('/create');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-[#111827]">My Portfolio</h1>
          <p className="text-[15px] text-[#6B7280] mt-1">
            Balanced Growth strategy &middot; Created Feb 1, 2026
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPaused(!paused)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-medium border transition-colors ${
              paused
                ? 'border-[#059669] text-[#059669] hover:bg-[#E0F5EA]'
                : 'border-[#D6D9E3] text-[#6B7280] hover:bg-[#F3F4F9]'
            }`}
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => navigate('/create/build', { state: { allocations: PORTFOLIO_TOKENS.map((t) => ({ symbol: t.symbol, pct: t.targetPct })), templateName: 'Balanced Growth' } })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-medium border border-[#D6D9E3] text-[#6B7280] hover:bg-[#F3F4F9] transition-colors"
          >
            <Edit3 className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-medium border border-[#FFE4E6] text-[#E11D48] hover:bg-[#FFE4E6] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-[14px]
                       bg-gradient-to-r from-[#059669] to-[#10B981] hover:opacity-90 transition-opacity shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Rebalance Now
          </button>
        </div>
      </div>

      {/* Status bar */}
      {paused && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
          <Pause className="w-4 h-4 text-[#D97706]" />
          <span className="text-[14px] font-medium text-[#92400E]">
            Portfolio is paused. Auto-rebalancing is disabled.
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Total Value</p>
          <p className="text-[26px] font-bold text-[#111827] mt-1">{totalValue}</p>
        </div>
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Tokens</p>
          <p className="text-[26px] font-bold text-[#111827] mt-1">{PORTFOLIO_TOKENS.length}</p>
        </div>
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Max Drift</p>
          <p className={`text-[26px] font-bold mt-1 ${
            driftStatus === 'high' ? 'text-[#DC2626]' : driftStatus === 'medium' ? 'text-[#D97706]' : 'text-[#059669]'
          }`}>
            {maxDrift.toFixed(1)}%
          </p>
        </div>
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#6B7280]">Auto-Rebalance</p>
              <p className="text-[14px] font-semibold text-[#111827] mt-2">
                Threshold: {driftThreshold}%
              </p>
            </div>
            <Toggle checked={autoRebalance} onChange={setAutoRebalance} />
          </div>
        </div>
      </div>

      {/* Token allocations table */}
      <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
        <h2 className="text-[18px] font-bold text-[#111827] mb-5">Token Allocations</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[13px] text-[#9CA3AF] border-b border-[#D6D9E3]">
                <th className="text-left font-medium pb-3 pr-4">Token</th>
                <th className="text-right font-medium pb-3 pr-4">Holdings</th>
                <th className="text-right font-medium pb-3 pr-4">Value</th>
                <th className="text-right font-medium pb-3 pr-4">Target</th>
                <th className="text-right font-medium pb-3 pr-4">Current</th>
                <th className="text-right font-medium pb-3 pr-4">Drift</th>
                <th className="text-right font-medium pb-3">24h</th>
              </tr>
            </thead>
            <tbody>
              {PORTFOLIO_TOKENS.map((t) => {
                const drift = t.currentPct - t.targetPct;
                const absDrift = Math.abs(drift);
                return (
                  <tr key={t.symbol} className="border-b border-[#D6D9E3]/50 last:border-0 hover:bg-[#ECEEF4] transition-colors">
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-3">
                        <img src={TOKEN_LOGOS[t.symbol]} alt={t.symbol} className="w-8 h-8 rounded-full object-cover" />
                        <span className="text-[15px] font-semibold text-[#111827]">{t.symbol}</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <span className="text-[14px] text-[#111827]">{t.holdings}</span>
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <span className="text-[14px] font-semibold text-[#111827]">{t.value}</span>
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <span className="text-[14px] text-[#6B7280]">{t.targetPct}%</span>
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-[60px] h-[6px] rounded-full bg-[#E5E7EB] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${t.currentPct}%`, backgroundColor: TOKEN_ACCENT[t.symbol] || '#6B7280' }}
                          />
                        </div>
                        <span className="text-[14px] font-semibold" style={{ color: TOKEN_ACCENT[t.symbol] || '#111827' }}>
                          {t.currentPct}%
                        </span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <span className={`text-[13px] font-medium px-2 py-0.5 rounded-full ${
                        absDrift > driftThreshold
                          ? 'bg-[#FFE4E6] text-[#DC2626]'
                          : absDrift > driftThreshold * 0.6
                            ? 'bg-[#FEF3C7] text-[#D97706]'
                            : 'bg-[#E0F5EA] text-[#059669]'
                      }`}>
                        {drift > 0 ? '+' : ''}{drift.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {t.change24h > 0 ? (
                          <TrendingUp className="w-3.5 h-3.5 text-[#059669]" />
                        ) : t.change24h < 0 ? (
                          <TrendingDown className="w-3.5 h-3.5 text-[#DC2626]" />
                        ) : null}
                        <span className={`text-[13px] font-medium ${
                          t.change24h > 0 ? 'text-[#059669]' : t.change24h < 0 ? 'text-[#DC2626]' : 'text-[#9CA3AF]'
                        }`}>
                          {t.change24h > 0 ? '+' : ''}{t.change24h}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rebalance History */}
      <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
        <h2 className="text-[18px] font-bold text-[#111827] mb-4">Rebalance History</h2>
        <div className="space-y-3">
          {REBALANCE_HISTORY.map((event) => (
            <div key={event.id} className="flex items-center justify-between py-2 border-b border-[#D6D9E3]/50 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#FEF3C7] flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-[#D97706]" />
                </div>
                <div>
                  <p className="text-[14px] text-[#111827]">{event.action}</p>
                  <p className="text-[12px] text-[#9CA3AF]">{event.date}</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E0F5EA] text-[#059669]">
                {event.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy Info */}
      <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
        <h2 className="text-[18px] font-bold text-[#111827] mb-4">Strategy Details</h2>
        <div className="grid grid-cols-2 gap-x-12 gap-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Strategy</span>
            <span className="text-[14px] font-semibold text-[#111827]">Balanced Growth</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Created</span>
            <span className="text-[14px] text-[#111827]">Feb 1, 2026</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Drift Threshold</span>
            <span className="text-[14px] font-semibold text-[#059669]">{driftThreshold}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Last Rebalance</span>
            <span className="text-[14px] text-[#111827]">Mar 21, 2026</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Total Rebalances</span>
            <span className="text-[14px] font-semibold text-[#111827]">3</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Status</span>
            <div className="flex items-center gap-1.5">
              {paused ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />
                  <span className="text-[14px] font-medium text-[#D97706]">Paused</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
                  <span className="text-[14px] font-medium text-[#059669]">Active</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <ConfirmDialog
          title="Delete Portfolio"
          message="Are you sure you want to delete this portfolio? This will stop all auto-rebalancing and DCA schedules linked to it. This action cannot be undone."
          confirmLabel="Delete Portfolio"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  );
}
