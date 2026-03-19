import { useMemo, useState } from 'react';
import {
  Trophy,
  Gift,
  Calendar,
  Users,
  Copy,
  Check,
  TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import RewardTierBadge from '@/components/RewardTier';
import StatsCard from '@/components/StatsCard';
import { useRewards, usePayoutHistory } from '@/hooks/useRewards';
import { useQuery } from '@/hooks/useApi';
import { useParty } from '@/context/PartyContext';
import { FEE_REBATE_PCT } from '@/config';
import type { RewardTier } from '@/types';

const TIER_ORDER: RewardTier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];

const TIER_COLORS: Record<RewardTier, string> = {
  Bronze: 'text-amber-700',
  Silver: 'text-ink-secondary',
  Gold: 'text-yellow-600',
  Platinum: 'text-cyan-600',
};

function formatMonth(monthId: string): string {
  const [year, month] = monthId.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function RewardsPage() {
  const { party } = useParty();
  const { stats, isLoading: rewardsLoading, error: rewardsError } = useRewards(party);
  const { payouts, isLoading: payoutsLoading, error: payoutsError } = usePayoutHistory(party);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const leaderboardQuery = useQuery<{ rank: number; tier: string; txCount: number; anonymousId: string }[]>(
    '/api/rewards/leaderboard',
    [],
  );

  const referralLink = `${window.location.origin}/ref/${party?.slice(0, 8) || 'user'}`;

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 2000);
    }).catch((err) => {
      console.warn('Failed to copy referral link:', err);
    });
  };

  const totalPaidOut = useMemo(
    () => payouts.reduce((acc, p) => acc + p.amount, 0),
    [payouts],
  );

  const isLoading = rewardsLoading || payoutsLoading;
  const error = rewardsError || payoutsError;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-muted rounded w-48" />
          <div className="h-32 bg-surface-muted rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-surface-muted rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-base text-amber-700">
            Using demo data — backend unavailable: {error}
          </p>
        </div>
      )}
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-ink">App Rewards</h2>
        <p className="text-base text-ink-muted mt-0.5">
          Earn CC fee rebates based on your transaction activity
        </p>
      </div>

      {/* Tier badge — prominent */}
      <RewardTierBadge
        tier={stats.tier}
        txCount={stats.txCount}
        nextTier={stats.nextTier}
        txToNextTier={stats.txToNextTier}
        progressPct={stats.progressPct}
        feeRebatePct={stats.feeRebatePct}
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Monthly TXs"
          value={stats.txCount}
          subtitle={`${stats.txToNextTier} to next tier`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatsCard
          title="Consecutive Months"
          value={stats.consecutiveMonths}
          subtitle="At current tier or above"
          icon={<Calendar className="w-5 h-5" />}
        />
        <StatsCard
          title="Total Earned"
          value={`${stats.totalEarned.toFixed(2)} CC`}
          subtitle="Lifetime rewards"
          icon={<Gift className="w-5 h-5" />}
        />
        <StatsCard
          title="Fee Rebate"
          value={`${stats.feeRebatePct}%`}
          subtitle={`${stats.tier} tier benefit`}
          icon={<Trophy className="w-5 h-5" />}
        />
      </div>

      {/* Tier comparison table */}
      <div className="card">
        <h3 className="text-lg font-semibold text-ink mb-4">
          Tier Benefits
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-sm text-ink-muted border-b border-surface-border">
                <th className="text-left font-medium pb-2 pr-4">Tier</th>
                <th className="text-left font-medium pb-2 pr-4">
                  TX/Month
                </th>
                <th className="text-left font-medium pb-2 pr-4">
                  Fee Rebate
                </th>
                <th className="text-right font-medium pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {TIER_ORDER.map((tier) => {
                const isCurrent = tier === stats.tier;
                const tierIndex = TIER_ORDER.indexOf(tier);
                const currentIndex = TIER_ORDER.indexOf(stats.tier);
                const isAchieved = tierIndex <= currentIndex;
                const thresholds: Record<RewardTier, string> = {
                  Bronze: '0 - 50',
                  Silver: '51 - 200',
                  Gold: '201 - 500',
                  Platinum: '501+',
                };

                return (
                  <tr
                    key={tier}
                    className={clsx(
                      'border-b border-surface-border/50 last:border-0',
                      isCurrent && 'bg-surface-muted',
                    )}
                  >
                    <td className="py-3 pr-4">
                      <span
                        className={clsx(
                          'text-base font-semibold',
                          TIER_COLORS[tier],
                        )}
                      >
                        {tier}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-sm text-ink">
                        {thresholds[tier]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-sm text-ink">
                        {FEE_REBATE_PCT[tier]}%
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {isCurrent ? (
                        <span className="badge bg-accent-light text-accent">
                          Current
                        </span>
                      ) : isAchieved ? (
                        <span className="badge bg-emerald-50 text-positive">
                          Achieved
                        </span>
                      ) : (
                        <span className="badge bg-surface-muted text-ink-muted">
                          Locked
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payout history */}
      <div className="card">
        <h3 className="text-lg font-semibold text-ink mb-4">
          Payout History
        </h3>

        {payouts.length === 0 ? (
          <div className="text-center py-8">
            <Gift className="w-8 h-8 text-ink-faint mx-auto mb-3" />
            <p className="text-base text-ink-muted">No payouts yet</p>
            <p className="text-base text-ink-muted mt-1">
              Keep trading to earn your first reward payout
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-sm text-ink-muted border-b border-surface-border">
                    <th className="text-left font-medium pb-2 pr-4">
                      Month
                    </th>
                    <th className="text-left font-medium pb-2 pr-4">
                      Tier
                    </th>
                    <th className="text-right font-medium pb-2 pr-4">
                      TX Count
                    </th>
                    <th className="text-right font-medium pb-2">
                      Reward (CC)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout, i) => (
                    <tr
                      key={`${payout.monthId}-${i}`}
                      className="border-b border-surface-border/50 last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <span className="text-sm text-ink">
                          {formatMonth(payout.monthId)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={clsx(
                            'text-sm font-medium',
                            TIER_COLORS[payout.tier],
                          )}
                        >
                          {payout.tier}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-sm text-ink-secondary">
                          {payout.txCount}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-sm font-medium text-positive">
                          +{payout.amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t border-surface-border">
              <div className="text-right">
                <p className="text-sm text-ink-muted">Total Paid Out</p>
                <p className="text-xl font-bold text-positive">
                  {totalPaidOut.toFixed(2)} CC
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Referral section */}
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-ink">
              Refer Friends
            </h3>
            <p className="text-base text-ink-muted">
              Earn 10% of your referrals' reward payouts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 bg-surface border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink-secondary font-mono truncate">
            {referralLink}
          </div>
          <button
            onClick={handleCopyReferral}
            className={clsx(
              'btn-secondary flex items-center gap-2 shrink-0',
              copiedReferral && 'bg-green-600 hover:bg-green-600 text-white',
            )}
          >
            {copiedReferral ? (
              <>
                <Check className="w-4 h-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-surface-border">
          <p className="text-base text-ink-muted">Referral tracking coming soon</p>
        </div>
      </div>

      {/* Privacy-Preserving Leaderboard */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-ink mb-4">Network Leaderboard</h3>
        <p className="text-base text-ink-muted mb-4">Rankings are anonymized — only you know your position</p>
        <table className="w-full text-base">
          <thead>
            <tr className="text-sm text-ink-muted border-b border-surface-border">
              <th className="text-left py-2">Rank</th>
              <th className="text-left py-2">ID</th>
              <th className="text-left py-2">Tier</th>
              <th className="text-right py-2">TXs</th>
            </tr>
          </thead>
          <tbody>
            {(leaderboardQuery.data || []).map((entry) => (
              <tr key={entry.rank} className="border-b border-surface-border/50">
                <td className="py-2 text-ink">{`#${entry.rank}`}</td>
                <td className="py-2 font-mono text-sm text-ink-secondary">{entry.anonymousId}</td>
                <td className="py-2">
                  <span className={clsx('text-sm px-2 py-0.5 rounded-full',
                    entry.tier === 'Platinum' ? 'bg-purple-50 text-purple-600' :
                    entry.tier === 'Gold' ? 'bg-amber-50 text-amber-700' :
                    entry.tier === 'Silver' ? 'bg-surface-muted text-ink-secondary' :
                    'bg-amber-50 text-amber-600'
                  )}>
                    {entry.tier}
                  </span>
                </td>
                <td className="py-2 text-right text-ink">{entry.txCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!leaderboardQuery.data || leaderboardQuery.data.length === 0) && (
          <p className="text-center text-ink-muted py-4">Leaderboard data will appear as users interact with the network</p>
        )}
      </div>
    </div>
  );
}
