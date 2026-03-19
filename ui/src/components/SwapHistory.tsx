import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RefreshCw, Repeat2, CheckCircle, Clock, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ActivityEntry } from '@/types';
import TokenIcon from '@/components/TokenIcon';

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
  completed: 'text-positive',
  pending: 'text-warning',
  failed: 'text-negative',
};

export default function SwapHistory({
  activities,
  limit,
  showType = true,
  className,
}: SwapHistoryProps) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? activities : limit ? activities.slice(0, limit) : activities;

  if (displayed.length === 0) {
    return (
      <div className={clsx('card', className)}>
        <h3 className="text-3xl font-bold text-ink mb-4">
          Activity History
        </h3>
        <div className="text-center py-10">
          <RefreshCw className="w-8 h-8 text-ink-faint mx-auto mb-3" />
          <p className="text-base text-ink-muted">No activity yet</p>
          <p className="text-base text-ink-muted mt-1">
            Rebalances and DCA executions will appear here
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 mt-4 btn-primary text-base"
          >
            <RefreshCw className="w-3 h-3" />
            Trigger Rebalance
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('card', className)}>
      <h3 className="text-3xl font-bold text-ink mb-4">
        Activity History
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-lg font-semibold text-ink uppercase tracking-wide border-b border-surface-border">
              <th className="text-left pb-2 pr-4">Date</th>
              {showType && (
                <th className="text-left pb-2 pr-4">Type</th>
              )}
              <th className="text-left pb-2 pr-4">Swap</th>
              <th className="text-right pb-2 pr-4">From</th>
              <th className="text-right pb-2 pr-4">To</th>
              <th className="text-right pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((entry) => {
              const StatusIcon = STATUS_ICON[entry.status];
              const firstLeg = entry.swapLegs[0];

              return (
                <tr
                  key={entry.id}
                  onClick={() => navigate(`/tx/${entry.id}`)}
                  className="border-b border-surface-border/50 last:border-0 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  {/* Date */}
                  <td className="py-3 pr-4">
                    <span className="text-lg text-ink-secondary">
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
                            ? 'bg-accent-light text-accent'
                            : entry.type === 'dca'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700',
                        )}
                      >
                        {entry.type === 'rebalance' ? (
                          <RefreshCw className="w-3 h-3 mr-1" />
                        ) : (
                          <Repeat2 className="w-3 h-3 mr-1" />
                        )}
                        {entry.type === 'rebalance' ? 'Rebal' : entry.type === 'dca' ? 'DCA' : entry.type}
                      </span>
                    </td>
                  )}

                  {/* Swap direction */}
                  <td className="py-3 pr-4">
                    {firstLeg && (
                      <div className="flex items-center gap-1.5">
                        <TokenIcon symbol={firstLeg.fromAsset.symbol} size={20} showBadge={false} />
                        <span className="text-ink-muted">&rarr;</span>
                        <TokenIcon symbol={firstLeg.toAsset.symbol} size={20} showBadge={false} />
                        {entry.swapLegs.length > 1 && (
                          <span className="text-lg text-ink-faint ml-1">
                            +{entry.swapLegs.length - 1}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* From amount */}
                  <td className="py-3 pr-4 text-right">
                    {firstLeg && (
                      <span className="text-lg text-ink">
                        {formatAmount(
                          firstLeg.fromAmount,
                          firstLeg.fromAsset.symbol,
                        )}{' '}
                        <span className="text-ink-muted">
                          {firstLeg.fromAsset.symbol}
                        </span>
                      </span>
                    )}
                  </td>

                  {/* To amount */}
                  <td className="py-3 pr-4 text-right">
                    {firstLeg && (
                      <span className="text-lg text-ink">
                        {formatAmount(
                          firstLeg.toAmount,
                          firstLeg.toAsset.symbol,
                        )}{' '}
                        <span className="text-ink-muted">
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

      {!showAll && limit && activities.length > limit && (
        <div className="text-center mt-3">
          <button
            onClick={() => setShowAll(true)}
            className="text-base text-accent hover:text-accent-hover transition-colors"
          >
            View all {activities.length} entries
          </button>
        </div>
      )}
    </div>
  );
}
