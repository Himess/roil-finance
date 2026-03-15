import { ArrowRight, RefreshCw, Repeat2, CheckCircle, Clock, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ActivityEntry } from '@/types';
import { ASSET_COLORS } from '@/config';

interface SwapHistoryProps {
  activities: ActivityEntry[];
  limit?: number;
  showType?: boolean;
  className?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffHours < 48) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAmount(amount: number, symbol: string): string {
  if (symbol === 'CBTC' && amount < 1) {
    return amount.toFixed(6);
  }
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const STATUS_ICON = {
  completed: CheckCircle,
  pending: Clock,
  failed: XCircle,
};

const STATUS_COLOR = {
  completed: 'text-green-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

export default function SwapHistory({
  activities,
  limit,
  showType = true,
  className,
}: SwapHistoryProps) {
  const displayed = limit ? activities.slice(0, limit) : activities;

  if (displayed.length === 0) {
    return (
      <div className={clsx('card', className)}>
        <h3 className="text-sm font-semibold text-slate-300 mb-4">
          Activity History
        </h3>
        <div className="text-center py-10">
          <RefreshCw className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No activity yet</p>
          <p className="text-xs text-slate-600 mt-1">
            Rebalances and DCA executions will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('card', className)}>
      <h3 className="text-sm font-semibold text-slate-300 mb-4">
        Activity History
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-700">
              <th className="text-left font-medium pb-2 pr-4">Date</th>
              {showType && (
                <th className="text-left font-medium pb-2 pr-4">Type</th>
              )}
              <th className="text-left font-medium pb-2 pr-4">Swap</th>
              <th className="text-right font-medium pb-2 pr-4">From</th>
              <th className="text-right font-medium pb-2 pr-4">To</th>
              <th className="text-right font-medium pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((entry) => {
              const StatusIcon = STATUS_ICON[entry.status];
              const firstLeg = entry.swapLegs[0];

              return (
                <tr
                  key={entry.id}
                  className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/20 transition-colors"
                >
                  {/* Date */}
                  <td className="py-3 pr-4">
                    <span className="text-xs text-slate-400">
                      {formatDate(entry.timestamp)}
                    </span>
                  </td>

                  {/* Type */}
                  {showType && (
                    <td className="py-3 pr-4">
                      <span
                        className={clsx(
                          'badge',
                          entry.type === 'rebalance'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-purple-500/15 text-purple-400',
                        )}
                      >
                        {entry.type === 'rebalance' ? (
                          <RefreshCw className="w-3 h-3 mr-1" />
                        ) : (
                          <Repeat2 className="w-3 h-3 mr-1" />
                        )}
                        {entry.type === 'rebalance' ? 'Rebal' : 'DCA'}
                      </span>
                    </td>
                  )}

                  {/* Swap direction */}
                  <td className="py-3 pr-4">
                    {firstLeg && (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-xs font-medium"
                          style={{
                            color:
                              ASSET_COLORS[firstLeg.fromAsset.symbol] ??
                              '#9CA3AF',
                          }}
                        >
                          {firstLeg.fromAsset.symbol}
                        </span>
                        <ArrowRight className="w-3 h-3 text-slate-600" />
                        <span
                          className="text-xs font-medium"
                          style={{
                            color:
                              ASSET_COLORS[firstLeg.toAsset.symbol] ??
                              '#9CA3AF',
                          }}
                        >
                          {firstLeg.toAsset.symbol}
                        </span>
                        {entry.swapLegs.length > 1 && (
                          <span className="text-[10px] text-slate-600 ml-1">
                            +{entry.swapLegs.length - 1}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* From amount */}
                  <td className="py-3 pr-4 text-right">
                    {firstLeg && (
                      <span className="text-xs text-slate-300">
                        {formatAmount(
                          firstLeg.fromAmount,
                          firstLeg.fromAsset.symbol,
                        )}{' '}
                        <span className="text-slate-500">
                          {firstLeg.fromAsset.symbol}
                        </span>
                      </span>
                    )}
                  </td>

                  {/* To amount */}
                  <td className="py-3 pr-4 text-right">
                    {firstLeg && (
                      <span className="text-xs text-slate-300">
                        {formatAmount(
                          firstLeg.toAmount,
                          firstLeg.toAsset.symbol,
                        )}{' '}
                        <span className="text-slate-500">
                          {firstLeg.toAsset.symbol}
                        </span>
                      </span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-3 text-right">
                    <StatusIcon
                      className={clsx(
                        'w-4 h-4 inline-block',
                        STATUS_COLOR[entry.status],
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {limit && activities.length > limit && (
        <div className="text-center mt-3">
          <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            View all {activities.length} entries
          </button>
        </div>
      )}
    </div>
  );
}
