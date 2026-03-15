import { Award, Star, Crown, Gem } from 'lucide-react';
import clsx from 'clsx';
import type { RewardTier as RewardTierType } from '@/types';
import { TIER_THRESHOLDS, FEE_REBATE_PCT } from '@/config';

interface RewardTierProps {
  tier: RewardTierType;
  txCount: number;
  nextTier: RewardTierType | null;
  txToNextTier: number;
  progressPct: number;
  feeRebatePct: number;
  className?: string;
}

const TIER_CONFIG: Record<
  RewardTierType,
  {
    icon: typeof Award;
    gradient: string;
    border: string;
    text: string;
    glow: string;
  }
> = {
  Bronze: {
    icon: Award,
    gradient: 'from-amber-700 to-amber-900',
    border: 'border-amber-700/50',
    text: 'text-amber-500',
    glow: 'shadow-amber-900/20',
  },
  Silver: {
    icon: Star,
    gradient: 'from-slate-300 to-slate-500',
    border: 'border-slate-400/50',
    text: 'text-slate-300',
    glow: 'shadow-slate-400/20',
  },
  Gold: {
    icon: Crown,
    gradient: 'from-yellow-400 to-yellow-600',
    border: 'border-yellow-500/50',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-500/20',
  },
  Platinum: {
    icon: Gem,
    gradient: 'from-cyan-300 to-blue-500',
    border: 'border-cyan-400/50',
    text: 'text-cyan-400',
    glow: 'shadow-cyan-500/20',
  },
};

export default function RewardTierBadge({
  tier,
  txCount,
  nextTier,
  txToNextTier,
  progressPct,
  feeRebatePct,
  className,
}: RewardTierProps) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;

  return (
    <div
      className={clsx(
        'card border',
        config.border,
        'shadow-lg',
        config.glow,
        className,
      )}
    >
      {/* Tier badge */}
      <div className="flex items-center gap-4 mb-5">
        <div
          className={clsx(
            'w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center',
            config.gradient,
          )}
        >
          <Icon className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">
            Current Tier
          </p>
          <p className={clsx('text-2xl font-bold', config.text)}>{tier}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Fee Rebate</p>
          <p className={clsx('text-lg font-bold', config.text)}>
            {feeRebatePct}%
          </p>
        </div>
      </div>

      {/* Progress bar to next tier */}
      {nextTier && (
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">
              {txCount} TX this month
            </span>
            <span className="text-slate-500">
              {txToNextTier} TX to{' '}
              <span className={TIER_CONFIG[nextTier].text}>{nextTier}</span>
            </span>
          </div>

          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-2 rounded-full bg-gradient-to-r transition-all duration-700',
                config.gradient,
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-600 mt-1">
            <span>{TIER_THRESHOLDS[tier].min} TX</span>
            <span>{TIER_THRESHOLDS[nextTier].min} TX</span>
          </div>
        </div>
      )}

      {!nextTier && (
        <div className="text-center py-2">
          <p className="text-sm text-cyan-400 font-medium">
            Maximum tier reached
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Enjoying the highest fee rebate!
          </p>
        </div>
      )}
    </div>
  );
}
