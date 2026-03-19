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
    barBg: string;
  }
> = {
  Bronze: {
    icon: Award,
    gradient: 'from-amber-600 to-amber-800',
    border: 'border-amber-300',
    text: 'text-amber-700',
    glow: '',
    barBg: 'from-amber-500 to-amber-700',
  },
  Silver: {
    icon: Star,
    gradient: 'from-gray-400 to-gray-500',
    border: 'border-gray-300',
    text: 'text-gray-600',
    glow: '',
    barBg: 'from-gray-400 to-gray-500',
  },
  Gold: {
    icon: Crown,
    gradient: 'from-yellow-500 to-yellow-600',
    border: 'border-yellow-300',
    text: 'text-yellow-600',
    glow: '',
    barBg: 'from-yellow-400 to-yellow-600',
  },
  Platinum: {
    icon: Gem,
    gradient: 'from-cyan-500 to-blue-600',
    border: 'border-cyan-300',
    text: 'text-cyan-600',
    glow: '',
    barBg: 'from-cyan-400 to-blue-500',
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
          <p className="text-sm text-ink-muted uppercase tracking-wider font-medium">
            Current Tier
          </p>
          <p className={clsx('text-3xl font-bold', config.text)}>{tier}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-sm text-ink-muted">Fee Rebate</p>
          <p className={clsx('text-xl font-bold', config.text)}>
            {feeRebatePct}%
          </p>
        </div>
      </div>

      {/* Progress bar to next tier */}
      {nextTier && (
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-ink-secondary">
              {txCount} TX this month
            </span>
            <span className="text-ink-muted">
              {txToNextTier} TX to{' '}
              <span className={TIER_CONFIG[nextTier].text}>{nextTier}</span>
            </span>
          </div>

          <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-2 rounded-full bg-gradient-to-r transition-all duration-700',
                config.barBg,
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm text-ink-secondary mt-1">
            <span>{TIER_THRESHOLDS[tier].min} TX</span>
            <span>{TIER_THRESHOLDS[nextTier].min} TX</span>
          </div>
        </div>
      )}

      {!nextTier && (
        <div className="text-center py-2">
          <p className="text-base text-cyan-600 font-medium">
            Maximum tier reached
          </p>
          <p className="text-base text-ink-muted mt-1">
            Enjoying the highest fee rebate!
          </p>
        </div>
      )}
    </div>
  );
}
