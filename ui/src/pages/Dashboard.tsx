import { useMemo, useState } from 'react';
import {
  DollarSign,
  Activity,
  BarChart3,
  Trophy,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import AllocationChart from '@/components/AllocationChart';
import DriftIndicator from '@/components/DriftIndicator';
import PortfolioSetup from '@/components/PortfolioSetup';
import SwapHistory from '@/components/SwapHistory';
import { usePortfolio, useDrift, useRebalanceHistory, useRebalance } from '@/hooks/usePortfolio';
import { useRewards } from '@/hooks/useRewards';
import { useDCAHistory } from '@/hooks/useDCA';
import { useParty } from '@/context/PartyContext';
import { useWallet } from '@/hooks/useWallet';
import type { ActivityEntry, Holding, TargetAllocation, TriggerMode } from '@/types';

export default function Dashboard() {
  const { party } = useParty();
  const { portfolio } = usePortfolio(party);
  const { drift } = useDrift(party);
  const { activities: rebalActivities } = useRebalanceHistory(party);
  const { activities: dcaActivities } = useDCAHistory(party);
  const { stats } = useRewards(party);
  const rebalanceMutation = useRebalance();
  const [isRebalancing, setIsRebalancing] = useState(false);

  // Wallet state — used to overlay real balances when available
  const { connected: walletConnected, balances: walletBalances } = useWallet();

  // Build effective holdings: prefer wallet balances when connected and non-empty,
  // otherwise fall back to portfolio (backend/demo) holdings.
  const effectiveHoldings: Holding[] = useMemo(() => {
    if (walletConnected && walletBalances.length > 0) {
      return walletBalances.map((wb) => ({
        asset: { symbol: wb.instrumentId, admin: 'Canton::Admin' },
        amount: wb.amount,
        valueCc: wb.amount, // 1:1 in CC terms by default
      }));
    }
    return portfolio.holdings;
  }, [walletConnected, walletBalances, portfolio.holdings]);

  // Merge and sort all activities
  const allActivities: ActivityEntry[] = useMemo(() => {
    const merged = [...rebalActivities, ...dcaActivities];
    merged.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return merged;
  }, [rebalActivities, dcaActivities]);

  // Calculate total portfolio value from effective holdings
  const totalValue = useMemo(
    () => effectiveHoldings.reduce((acc, h) => acc + h.valueCc, 0),
    [effectiveHoldings],
  );

  // Monthly TX count from all activity
  const monthlyTxCount = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return allActivities.filter(
      (a) => new Date(a.timestamp) >= startOfMonth,
    ).length;
  }, [allActivities]);

  const handleRebalance = async () => {
    setIsRebalancing(true);
    try {
      // Use the party as the portfolio ID for the rebalance call.
      // When the backend returns a real contractId, the portfolio hook
      // can be updated to pass that instead.
      await rebalanceMutation.mutate({ id: party });
    } catch {
      // error is captured in mutation
    } finally {
      setIsRebalancing(false);
    }
  };

  const handleSaveTargets = (_targets: TargetAllocation[], _mode: TriggerMode) => {
    // In a real app this would call useUpdateTargets + useUpdateTriggerMode
    // For demo we just log
    console.log('Save targets:', _targets, _mode);
  };

  const threshold =
    portfolio.triggerMode.tag === 'DriftThreshold'
      ? portfolio.triggerMode.value
      : null;
  const showRebalanceBtn = threshold !== null ? drift >= threshold : true;

  // Are we showing wallet-sourced data?
  const usingWalletBalances = walletConnected && walletBalances.length > 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Portfolio overview for{' '}
            <span className="text-slate-400 font-mono text-xs">
              {party}
            </span>
          </p>
        </div>

        {showRebalanceBtn && (
          <button
            onClick={handleRebalance}
            disabled={isRebalancing}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRebalancing ? 'animate-spin' : ''}`}
            />
            {isRebalancing ? 'Rebalancing...' : 'Rebalance Now'}
          </button>
        )}
      </div>

      {/* Wallet balance hint */}
      {!walletConnected && (
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg">
          <Wallet className="w-4 h-4 text-slate-500 shrink-0" />
          <p className="text-xs text-slate-400">
            Connect your wallet to see real balances. Currently showing demo data.
          </p>
        </div>
      )}

      {usingWalletBalances && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <Wallet className="w-4 h-4 text-green-400 shrink-0" />
          <p className="text-xs text-green-300">
            Showing live balances from your connected wallet.
          </p>
        </div>
      )}

      {/* Stats cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Value"
          value={`${totalValue.toLocaleString()} CC`}
          subtitle={`$${totalValue.toLocaleString()} USD`}
          trend={{ value: 3.2, label: 'vs last month' }}
          icon={<DollarSign className="w-5 h-5" />}
        />
        <StatsCard
          title="Max Drift"
          value={`${drift.toFixed(2)}%`}
          subtitle={
            threshold !== null
              ? `Auto-trigger at ${threshold}%`
              : 'Manual mode'
          }
          icon={<Activity className="w-5 h-5" />}
        />
        <StatsCard
          title="Monthly TXs"
          value={monthlyTxCount}
          subtitle={`${portfolio.totalRebalances} lifetime`}
          trend={{ value: 12, label: 'vs last month' }}
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <StatsCard
          title="Reward Tier"
          value={stats.tier}
          subtitle={`${stats.feeRebatePct}% fee rebate`}
          icon={<Trophy className="w-5 h-5" />}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AllocationChart
          holdings={effectiveHoldings}
          targets={portfolio.targets}
        />
        <DriftIndicator
          drift={drift}
          triggerMode={portfolio.triggerMode}
        />
      </div>

      {/* Portfolio setup */}
      <PortfolioSetup
        initialTargets={portfolio.targets}
        holdings={effectiveHoldings}
        triggerMode={portfolio.triggerMode}
        onSave={handleSaveTargets}
      />

      {/* Recent activity */}
      <SwapHistory activities={allActivities} limit={5} />
    </div>
  );
}
