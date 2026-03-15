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
import { useParty } from '@/context/PartyContext';
import { FEE_REBATE_PCT } from '@/config';
import type { RewardTier } from '@/types';

const TIER_ORDER: RewardTier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];

const TIER_COLORS: Record<RewardTier, string> = {
  Bronze: 'text-amber-600',
  Silver: 'text-slate-300',
  Gold: 'text-yellow-400',
  Platinum: 'text-cyan-400',
};

function formatMonth(monthId: string): string {
  const [year, month] = monthId.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function RewardsPage() {
  const { party } = useParty();
  const { stats } = useRewards(party);
  const { payouts } = usePayoutHistory(party);
  const [copiedReferral, setCopiedReferral] = useState(false);

  const referralLink = `https://rebalancer.canton.network/ref/${party.replace('::', '-')}`;

  const handleCopyReferral = () => {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 2000);
    });
  };

  const totalPaidOut = useMemo(
    () => payouts.reduce((acc, p) => acc + p.amount, 0),
    [payouts],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">App Rewards</h2>
        <p className="text-sm text-slate-500 mt-0.5">
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
        <h3 className="text-sm font-semibold text-slate-300 mb-4">
          Tier Benefits
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-700">
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
                      'border-b border-slate-700/50 last:border-0',
                      isCurrent && 'bg-slate-700/20',
                    )}
                  >
                    <td className="py-3 pr-4">
                      <span
                        className={clsx(
                          'text-sm font-semibold',
                          TIER_COLORS[tier],
                        )}
                      >
                        {tier}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-sm text-slate-300">
                        {thresholds[tier]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-sm text-slate-300">
                        {FEE_REBATE_PCT[tier]}%
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {isCurrent ? (
                        <span className="badge bg-blue-500/15 text-blue-400">
                          Current
                        </span>
                      ) : isAchieved ? (
                        <span className="badge bg-green-500/15 text-green-400">
                          Achieved
                        </span>
                      ) : (
                        <span className="badge bg-slate-700 text-slate-500">
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
        <h3 className="text-sm font-semibold text-slate-300 mb-4">
          Payout History
        </h3>

        {payouts.length === 0 ? (
          <div className="text-center py-8">
            <Gift className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No payouts yet</p>
            <p className="text-xs text-slate-600 mt-1">
              Keep trading to earn your first reward payout
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-700">
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
                      className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <span className="text-sm text-slate-300">
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
                        <span className="text-sm text-slate-400">
                          {payout.txCount}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-sm font-medium text-green-400">
                          +{payout.amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t border-slate-700">
              <div className="text-right">
                <p className="text-xs text-slate-500">Total Paid Out</p>
                <p className="text-lg font-bold text-green-400">
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
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-300">
              Refer Friends
            </h3>
            <p className="text-xs text-slate-500">
              Earn 10% of your referrals' reward payouts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-400 font-mono truncate">
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

        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-700">
          <div>
            <p className="text-xs text-slate-500">Referrals</p>
            <p className="text-lg font-bold text-white">3</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Active</p>
            <p className="text-lg font-bold text-green-400">2</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Credits Earned</p>
            <p className="text-lg font-bold text-purple-400">8.50 CC</p>
          </div>
        </div>
      </div>
    </div>
  );
}
