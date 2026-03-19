import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Wallet, X, Users, MessageCircle, RefreshCw, PlusCircle,
  ArrowUpRight, ArrowDownRight,
  Activity, Trophy, TrendingUp,
} from 'lucide-react';
import { ResponsiveContainer, Tooltip, Area, AreaChart, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { useParty } from '@/context/PartyContext';
import { usePortfolio, useRebalanceHistory, usePerformance } from '@/hooks/usePortfolio';
import { useWallet } from '@/hooks/useWallet';
import { useRewards } from '@/hooks/useRewards';
import { useMarketPrices } from '@/hooks/useMarket';
import { useEventStream } from '@/hooks/useEventStream';
import { useToast } from '@/components/Toast';
import { apiFetch } from '@/hooks/useApi';
import { config } from '@/config';
import TokenIcon from '@/components/TokenIcon';
import ConfirmDialog from '@/components/ConfirmDialog';
import SwapHistory from '@/components/SwapHistory';

export default function Dashboard() {
  const { party } = useParty();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { portfolio, isLoading, error: portfolioError, refetch: refetchPortfolio } = usePortfolio(party);
  const { activities: rebalanceActivities } = useRebalanceHistory(party);
  const performanceQuery = usePerformance(party);
  const { stats } = useRewards(party);
  const { connected: walletConnected } = useWallet();
  const { priceMap } = useMarketPrices();

  // Engagement card dismiss state
  const [walletCardDismissed, setWalletCardDismissed] = useState(false);
  const [socialCardDismissed, setSocialCardDismissed] = useState(false);
  const [inviteCardDismissed, setInviteCardDismissed] = useState(false);

  // Confirm dialog
  const [showRebalanceConfirm, setShowRebalanceConfirm] = useState(false);
  const [isRebalancing, setIsRebalancing] = useState(false);

  // Performance chart time range
  const [timeRange, setTimeRange] = useState<'1D' | '1W' | '1M' | '1Y' | 'All'>('1M');

  // SSE real-time updates
  useEventStream({
    party,
    enabled: true,
    onRebalance: () => refetchPortfolio(),
    onPortfolioUpdate: () => refetchPortfolio(),
  });

  // Calculate total value in USD
  const ccPrice = priceMap.get('CC') || 0.15;
  const totalValueCc = useMemo(() => {
    return portfolio.holdings.reduce((sum, h) => sum + h.valueCc, 0);
  }, [portfolio.holdings]);
  const totalValueUsd = totalValueCc * ccPrice;

  // 24h change from performance
  const change24h = performanceQuery.data?.summary?.change24h ?? 0;
  const change24hUsd = totalValueUsd * (change24h / 100);

  // Chart data
  const chartData = useMemo(() => {
    const history = performanceQuery.data?.history || [];
    const now = Date.now();
    const rangeMs: Record<string, number> = {
      '1D': 86400000, '1W': 604800000, '1M': 2592000000, '1Y': 31536000000, 'All': Infinity,
    };
    const cutoff = now - (rangeMs[timeRange] || 2592000000);
    return history
      .filter((s: { timestamp: string }) => new Date(s.timestamp).getTime() >= cutoff)
      .map((s: { timestamp: string; totalValueCc: number }) => ({
        time: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: Math.round(s.totalValueCc * ccPrice * 100) / 100,
      }));
  }, [performanceQuery.data?.history, timeRange, ccPrice]);

  // Drift
  const maxDrift = useMemo(() => {
    if (!portfolio.holdings.length || !portfolio.targets.length) return 0;
    const totalValue = portfolio.holdings.reduce((s, h) => s + h.valueCc, 0);
    if (totalValue === 0) return 0;
    let max = 0;
    for (const t of portfolio.targets) {
      const h = portfolio.holdings.find(hh => hh.asset.symbol === t.asset.symbol);
      const currentPct = h ? (h.valueCc / totalValue) * 100 : 0;
      max = Math.max(max, Math.abs(currentPct - t.targetPct));
    }
    return Math.round(max * 100) / 100;
  }, [portfolio]);

  // Rebalance handler
  const handleRebalance = useCallback(async () => {
    setIsRebalancing(true);
    setShowRebalanceConfirm(false);
    try {
      await apiFetch(`${config.backendUrl}/api/portfolio/${encodeURIComponent(party)}/rebalance`, {
        method: 'POST',
      });
      addToast('success', 'Portfolio rebalanced successfully');
      refetchPortfolio();
    } catch (err) {
      addToast('error', `Rebalance failed: ${err}`);
    } finally {
      setIsRebalancing(false);
    }
  }, [party, addToast, refetchPortfolio]);

  // Monthly TX count
  const monthlyTxCount = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return rebalanceActivities.filter(l => new Date(l.timestamp) >= startOfMonth).length;
  }, [rebalanceActivities]);

  // Trigger mode helpers
  const triggerTag = portfolio.triggerMode?.tag;
  const triggerValue = triggerTag === 'DriftThreshold'
    ? (portfolio.triggerMode as { tag: 'DriftThreshold'; value: number }).value
    : null;

  // Portfolios table data
  const portfolioTableData = useMemo(() => {
    if (!portfolio) return [];
    const triggerText = triggerTag === 'DriftThreshold'
      ? `Auto at ${triggerValue}% drift`
      : triggerTag === 'PriceCondition' ? 'Price condition' : 'Manual';
    return [{
      name: portfolio.targets.length > 3 ? 'Diversified Portfolio' : 'My Portfolio',
      tokens: portfolio.targets.map(t => t.asset.symbol),
      nextRebalance: triggerText,
      currentValue: totalValueUsd,
      totalReturn: change24hUsd * 30, // rough estimate
      dailyReturn: change24hUsd,
      dailyReturnPct: change24h,
    }];
  }, [portfolio, totalValueUsd, change24hUsd, change24h, triggerTag, triggerValue]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="h-full grid gap-3" style={{ gridTemplateColumns: '1fr 280px', gridTemplateRows: 'minmax(220px, 1fr) auto auto auto' }}>
        <div className="card p-4 animate-pulse bg-surface-muted" style={{ gridColumn: '1', gridRow: '1' }} />
        <div className="flex flex-col gap-3" style={{ gridColumn: '2', gridRow: '1' }}>
          <div className="card p-3 flex-1 animate-pulse bg-surface-muted" />
          <div className="card p-3 flex-1 animate-pulse bg-surface-muted" />
          <div className="card p-3 flex-1 animate-pulse bg-surface-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full grid gap-3" style={{ gridTemplateColumns: '1fr 280px', gridTemplateRows: 'minmax(220px, 1fr) auto auto auto' }}>
      {/* Warning banner */}
      {portfolioError && (
        <div className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg text-base text-amber-700" style={{ gridColumn: '1 / -1' }}>
          Using demo data — backend unavailable
        </div>
      )}

      {/* ================================================================= */}
      {/* ROW 1, COL 1: Total Value + Chart */}
      {/* ================================================================= */}
      <div className="card p-6" style={{ gridColumn: '1', gridRow: '1' }}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-xl text-ink-secondary">Total Value</p>
            <p className="text-6xl font-extrabold text-ink">
              ${totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {change24h >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-positive" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-negative" />
              )}
              <span className={clsx('text-xl font-medium', change24h >= 0 ? 'text-positive' : 'text-negative')}>
                {change24h >= 0 ? '+' : ''}${Math.abs(change24hUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {' '}({change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%)
              </span>
              <span className="text-lg text-ink-muted">{'\u2248'} {totalValueCc.toLocaleString()} CC</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 bg-surface-muted rounded-lg p-0.5">
            {(['1D', '1W', '1M', '1Y', 'All'] as const).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={clsx(
                  'px-2 py-0.5 rounded text-base transition-colors',
                  timeRange === r ? 'bg-surface-card font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[120px]">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#9B9B9B' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E8E6E0', borderRadius: '8px', fontSize: '13px' }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
                />
                <Area type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2} fill="url(#chartGradient)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="relative h-full">
              <svg width="100%" height="100%" className="absolute inset-0">
                <line x1="0" y1="50" x2="100%" y2="50" stroke="#E8E6E0" strokeWidth="2" strokeDasharray="8,6" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-xl text-ink-muted">Start trading to see your performance</p>
                <Link to="/create" className="text-xl font-semibold text-accent hover:underline mt-1">Create your first portfolio &rarr;</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* ROW 1, COL 2: Side Stats Stack */}
      {/* ================================================================= */}
      <div className="flex flex-col gap-3" style={{ gridColumn: '2', gridRow: '1' }}>
        <div className="card p-4 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Activity className="w-3.5 h-3.5 text-ink-muted" />
            <span className="text-lg text-ink-secondary">Max Drift</span>
          </div>
          <p className="text-3xl font-extrabold text-ink">{maxDrift.toFixed(2)}%</p>
          <p className="text-base text-ink-muted">
            {triggerTag === 'DriftThreshold' ? `Auto at ${triggerValue}%` : 'Manual'}
          </p>
        </div>
        <div className="card p-4 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="w-3.5 h-3.5 text-ink-muted" />
            <span className="text-lg text-ink-secondary">24H Change</span>
          </div>
          <p className={clsx('text-3xl font-extrabold', change24h >= 0 ? 'text-positive' : 'text-negative')}>
            {change24h >= 0 ? '+' : ''}${Math.abs(change24hUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="text-base text-ink-muted">({change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%)</p>
        </div>
        <div className="card p-4 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Trophy className="w-3.5 h-3.5 text-ink-muted" />
            <span className="text-lg text-ink-secondary">Reward Tier</span>
          </div>
          <p className="text-3xl font-extrabold text-ink">{stats?.tier || 'Bronze'}</p>
          <p className="text-base text-ink-muted">{stats?.feeRebatePct != null ? `${stats.feeRebatePct}%` : '0.5%'} fee rebate</p>
        </div>
      </div>

      {/* ================================================================= */}
      {/* ROW 2: Engagement Cards — full width */}
      {/* ================================================================= */}
      <div className="grid grid-cols-3 gap-3" style={{ gridColumn: '1 / -1', gridRow: '2' }}>
        {!walletConnected && !walletCardDismissed ? (
          <div className="card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent-light flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xl font-semibold text-ink">Connect Wallet</h4>
              <p className="text-base text-ink-secondary">Real-time balances and trading</p>
            </div>
            <button onClick={() => setWalletCardDismissed(true)} className="text-ink-muted hover:text-ink shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : walletConnected ? (
          <div className="card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
              <RefreshCw className={clsx('w-4 h-4 text-emerald-600', isRebalancing && 'animate-spin')} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xl font-semibold text-ink">Quick Rebalance</h4>
              <button onClick={() => setShowRebalanceConfirm(true)} disabled={isRebalancing} className="text-base text-accent font-medium hover:underline">
                {isRebalancing ? 'Rebalancing...' : `Drift ${maxDrift.toFixed(1)}% — Rebalance →`}
              </button>
            </div>
          </div>
        ) : null}

        {!socialCardDismissed && (
          <div className="card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xl font-semibold text-ink">Connect X Account</h4>
              <p className="text-base text-ink-secondary">Access social rewards</p>
            </div>
            <button onClick={() => setSocialCardDismissed(true)} className="text-ink-muted hover:text-ink shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!inviteCardDismissed && (
          <div className="card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xl font-semibold text-ink">Invite Friends</h4>
              <p className="text-base text-ink-secondary">Earn from referral fees</p>
            </div>
            <button onClick={() => setInviteCardDismissed(true)} className="text-ink-muted hover:text-ink shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* ROW 3: My Portfolios — fills remaining space */}
      {/* ================================================================= */}
      <div className="card min-h-0 overflow-hidden flex flex-col" style={{ gridColumn: '1 / -1', gridRow: '3' }}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-surface-border shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-ink">My Portfolios</h2>
            <div className="flex items-center bg-surface-muted rounded p-0.5">
              <button className="px-2 py-0.5 rounded bg-surface-card text-base font-semibold text-ink shadow-sm">
                Active ({portfolioTableData.length})
              </button>
              <button className="px-2 py-0.5 rounded text-base text-ink-muted hover:text-ink">
                Archived (0)
              </button>
            </div>
          </div>
          <Link to="/create" className="btn-primary flex items-center gap-1.5 text-base px-3 py-1.5 rounded-full">
            <PlusCircle className="w-3.5 h-3.5" /> Create new
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="text-left px-4 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">Portfolio</th>
                <th className="text-left px-3 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">Tokens</th>
                <th className="text-left px-3 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">Rebalance</th>
                <th className="text-right px-3 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">Value</th>
                <th className="text-right px-3 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">Total</th>
                <th className="text-right px-4 py-2 text-lg font-semibold text-ink-secondary uppercase tracking-wide">24h</th>
              </tr>
            </thead>
            <tbody>
              {portfolioTableData.map((p, i) => (
                <tr key={i} className="border-b border-surface-border last:border-0 hover:bg-surface-hover cursor-pointer transition-colors" onClick={() => navigate('/create')}>
                  <td className="px-4 py-4"><p className="text-lg font-semibold text-ink">{p.name}</p></td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-1">
                      {p.tokens.slice(0, 5).map(t => (<TokenIcon key={t} symbol={t} size={22} showBadge={false} />))}
                      {p.tokens.length > 5 && <span className="text-lg text-ink-muted">+{p.tokens.length - 5}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-lg text-ink-secondary">{p.nextRebalance}</td>
                  <td className="px-3 py-4 text-right"><p className="text-xl font-bold text-ink">${p.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></td>
                  <td className="px-3 py-4 text-right">
                    <p className={clsx('text-lg font-medium', p.totalReturn >= 0 ? 'text-positive' : 'text-negative')}>
                      {p.totalReturn >= 0 ? '+' : ''}${Math.abs(p.totalReturn).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className={clsx('text-lg font-medium', p.dailyReturn >= 0 ? 'text-positive' : 'text-negative')}>
                      {p.dailyReturn >= 0 ? '+' : ''}${Math.abs(p.dailyReturn).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      <span className="ml-0.5">({p.dailyReturnPct >= 0 ? '+' : ''}{p.dailyReturnPct.toFixed(1)}%)</span>
                    </p>
                  </td>
                </tr>
              ))}
              {portfolioTableData.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center">
                  <p className="text-base text-ink-muted">No portfolios yet</p>
                  <Link to="/create" className="text-lg text-accent hover:underline mt-1 inline-block">Create your first portfolio &rarr;</Link>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================= */}
      {/* ROW 4: Activity History — fixed max height, scrollable */}
      {/* ================================================================= */}
      <div className="max-h-[180px] overflow-y-auto" style={{ gridColumn: '1 / -1', gridRow: '4' }}>
        <SwapHistory activities={rebalanceActivities} limit={10} />
      </div>

      {/* Rebalance Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showRebalanceConfirm}
        title="Confirm Rebalance"
        message={`This will rebalance your portfolio to match target allocations. Current drift: ${maxDrift.toFixed(1)}%`}
        confirmLabel="Rebalance"
        variant="warning"
        onConfirm={handleRebalance}
        onCancel={() => setShowRebalanceConfirm(false)}
      />
    </div>
  );
}
