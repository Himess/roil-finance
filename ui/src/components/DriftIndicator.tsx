import clsx from 'clsx';
import type { TriggerMode } from '@/types';

interface DriftIndicatorProps {
  drift: number;
  triggerMode: TriggerMode;
  className?: string;
}

export default function DriftIndicator({
  drift,
  triggerMode,
  className,
}: DriftIndicatorProps) {
  const maxDisplayDrift = 15; // max % for the bar
  const clampedDrift = Math.min(drift, maxDisplayDrift);
  const pct = (clampedDrift / maxDisplayDrift) * 100;

  const threshold =
    triggerMode.tag === 'DriftThreshold' ? triggerMode.value : null;
  const thresholdPct = threshold
    ? (Math.min(threshold, maxDisplayDrift) / maxDisplayDrift) * 100
    : null;

  const driftColor =
    drift > 5 ? 'bg-red-500' : drift > 3 ? 'bg-amber-500' : 'bg-green-500';
  const driftTextColor =
    drift > 5
      ? 'text-negative'
      : drift > 3
        ? 'text-warning'
        : 'text-positive';

  const statusLabel =
    drift > 5
      ? 'High Drift'
      : drift > 3
        ? 'Moderate Drift'
        : 'In Range';

  return (
    <div className={clsx('card', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-ink">
          Portfolio Drift
        </h3>
        <span className={clsx('badge', driftTextColor, 'bg-surface-muted')}>
          {statusLabel}
        </span>
      </div>

      {/* Big drift number */}
      <div className="flex items-baseline gap-2 mb-5">
        <span className={clsx('text-4xl font-bold', driftTextColor)}>
          {drift.toFixed(2)}
        </span>
        <span className="text-lg text-ink-muted">%</span>
      </div>

      {/* Drift bar */}
      <div className="relative">
        {/* Background track */}
        <div className="h-3 bg-surface-muted rounded-full overflow-hidden">
          {/* Green zone */}
          <div
            className="absolute top-0 left-0 h-3 bg-green-100 rounded-l-full"
            style={{ width: `${(3 / maxDisplayDrift) * 100}%` }}
          />
          {/* Yellow zone */}
          <div
            className="absolute top-0 h-3 bg-amber-100"
            style={{
              left: `${(3 / maxDisplayDrift) * 100}%`,
              width: `${((5 - 3) / maxDisplayDrift) * 100}%`,
            }}
          />
          {/* Red zone */}
          <div
            className="absolute top-0 h-3 bg-red-100 rounded-r-full"
            style={{
              left: `${(5 / maxDisplayDrift) * 100}%`,
              width: `${((maxDisplayDrift - 5) / maxDisplayDrift) * 100}%`,
            }}
          />

          {/* Drift fill */}
          <div
            className={clsx('h-3 rounded-full transition-all duration-500', driftColor)}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Threshold marker */}
        {thresholdPct !== null && (
          <div
            className="absolute top-0 h-3 w-0.5 bg-ink/50"
            style={{ left: `${thresholdPct}%` }}
          >
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="text-sm text-ink-secondary font-medium">
                Auto: {threshold}%
              </span>
            </div>
          </div>
        )}

        {/* Scale labels */}
        <div className="flex justify-between mt-2 text-sm text-ink-secondary">
          <span>0%</span>
          <span>3%</span>
          <span>5%</span>
          <span>10%</span>
          <span>{maxDisplayDrift}%</span>
        </div>
      </div>

      {/* Trigger mode info */}
      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-ink-muted">
          Trigger:{' '}
          <span className="text-ink font-medium">
            {triggerMode.tag === 'Manual'
              ? 'Manual'
              : `Auto at ${triggerMode.value}% drift`}
          </span>
        </span>
        {threshold !== null && drift >= threshold && (
          <span className="text-warning font-medium animate-pulse">
            Rebalance recommended
          </span>
        )}
      </div>
    </div>
  );
}
