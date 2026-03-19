import React from 'react';
import { ArrowRight, Pause, Play, Trash2, Clock } from 'lucide-react';
import clsx from 'clsx';
import TokenIcon from '@/components/TokenIcon';
import type { DCASchedule } from '@/types';

interface DCACardProps {
  schedule: DCASchedule;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}

function formatFrequency(f: string): string {
  switch (f) {
    case 'Hourly':
      return 'Every hour';
    case 'Daily':
      return 'Every day';
    case 'Weekly':
      return 'Every week';
    case 'Monthly':
      return 'Every month';
    default:
      return f;
  }
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function DCACard({
  schedule,
  onPause,
  onResume,
  onCancel,
}: DCACardProps) {
  return (
    <div
      className={clsx(
        'card-hover',
        !schedule.isActive && 'opacity-60',
      )}
    >
      {/* Header row: source -> target */}
      <div className="flex items-center gap-3 mb-4">
        <TokenIcon symbol={schedule.sourceAsset.symbol} size={32} />

        <ArrowRight className="w-4 h-4 text-ink-muted" />

        <TokenIcon symbol={schedule.targetAsset.symbol} size={32} />

        <div className="flex-1">
          <p className="text-base font-semibold text-ink">
            {schedule.sourceAsset.symbol}{' '}
            <span className="text-ink-muted font-normal">to</span>{' '}
            {schedule.targetAsset.symbol}
          </p>
        </div>

        {/* Status badge */}
        <span
          className={clsx(
            'badge',
            schedule.isActive
              ? 'bg-emerald-50 text-positive'
              : 'bg-surface-muted text-ink-secondary',
          )}
        >
          {schedule.isActive ? 'Active' : 'Paused'}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-sm text-ink-muted">Amount</p>
          <p className="text-base font-medium text-ink">
            {schedule.amountPerBuy.toLocaleString()}{' '}
            <span className="text-ink-secondary text-sm">
              {schedule.sourceAsset.symbol}
            </span>
          </p>
        </div>
        <div>
          <p className="text-sm text-ink-muted">Frequency</p>
          <p className="text-base font-medium text-ink">
            {formatFrequency(schedule.frequency)}
          </p>
        </div>
        <div>
          <p className="text-sm text-ink-muted">Executions</p>
          <p className="text-base font-medium text-ink">
            {schedule.totalExecutions}
          </p>
        </div>
      </div>

      {/* Footer: created time + actions */}
      <div className="flex items-center justify-between pt-3 border-t border-surface-border">
        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Clock className="w-3.5 h-3.5" />
          Created {timeSince(schedule.createdAt)}
        </div>

        <div className="flex items-center gap-1.5">
          {schedule.isActive ? (
            <button
              onClick={onPause}
              className="p-1.5 rounded-md hover:bg-surface-hover text-ink-secondary hover:text-warning transition-colors"
              title="Pause"
              aria-label="Pause schedule"
            >
              <Pause className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onResume}
              className="p-1.5 rounded-md hover:bg-surface-hover text-ink-secondary hover:text-positive transition-colors"
              title="Resume"
              aria-label="Resume schedule"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md hover:bg-surface-hover text-ink-secondary hover:text-negative transition-colors"
            title="Cancel"
            aria-label="Cancel schedule"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(DCACard);
