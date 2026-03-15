import { ArrowRight, Pause, Play, Trash2, Clock } from 'lucide-react';
import clsx from 'clsx';
import { ASSET_COLORS } from '@/config';
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

export default function DCACard({
  schedule,
  onPause,
  onResume,
  onCancel,
}: DCACardProps) {
  const srcColor = ASSET_COLORS[schedule.sourceAsset.symbol] ?? '#6B7280';
  const tgtColor = ASSET_COLORS[schedule.targetAsset.symbol] ?? '#6B7280';

  return (
    <div
      className={clsx(
        'card-hover',
        !schedule.isActive && 'opacity-60',
      )}
    >
      {/* Header row: source → target */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: srcColor }}
        >
          {schedule.sourceAsset.symbol.charAt(0)}
        </div>

        <ArrowRight className="w-4 h-4 text-slate-500" />

        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: tgtColor }}
        >
          {schedule.targetAsset.symbol.charAt(0)}
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            {schedule.sourceAsset.symbol}{' '}
            <span className="text-slate-500 font-normal">to</span>{' '}
            {schedule.targetAsset.symbol}
          </p>
        </div>

        {/* Status badge */}
        <span
          className={clsx(
            'badge',
            schedule.isActive
              ? 'bg-green-500/15 text-green-400'
              : 'bg-slate-700 text-slate-400',
          )}
        >
          {schedule.isActive ? 'Active' : 'Paused'}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-xs text-slate-500">Amount</p>
          <p className="text-sm font-medium text-white">
            {schedule.amountPerBuy.toLocaleString()}{' '}
            <span className="text-slate-400 text-xs">
              {schedule.sourceAsset.symbol}
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Frequency</p>
          <p className="text-sm font-medium text-white">
            {formatFrequency(schedule.frequency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Executions</p>
          <p className="text-sm font-medium text-white">
            {schedule.totalExecutions}
          </p>
        </div>
      </div>

      {/* Footer: created time + actions */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-700">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="w-3 h-3" />
          Created {timeSince(schedule.createdAt)}
        </div>

        <div className="flex items-center gap-1.5">
          {schedule.isActive ? (
            <button
              onClick={onPause}
              className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-amber-400 transition-colors"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onResume}
              className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-green-400 transition-colors"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors"
            title="Cancel"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
