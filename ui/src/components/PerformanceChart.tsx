import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import clsx from 'clsx';

interface PerformanceSnapshot {
  timestamp: string;
  totalValueCc: number;
}

interface PerformanceChartProps {
  history: PerformanceSnapshot[];
  className?: string;
}

type TimeRange = '1D' | '1W' | '1M' | '3M' | 'ALL';

const RANGE_MS: Record<TimeRange, number | null> = {
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  'ALL': null,
};

const RANGES: TimeRange[] = ['1D', '1W', '1M', '3M', 'ALL'];

export default function PerformanceChart({ history, className }: PerformanceChartProps) {
  const [range, setRange] = useState<TimeRange>('1M');

  const chartData = useMemo(() => {
    const rangeMs = RANGE_MS[range];
    const now = Date.now();
    const filtered = rangeMs
      ? history.filter(s => now - new Date(s.timestamp).getTime() <= rangeMs)
      : history;

    return filtered.map(s => ({
      time: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.round(s.totalValueCc * 100) / 100,
    }));
  }, [history, range]);

  if (!chartData.length) {
    return (
      <div className={clsx('card p-6', className)}>
        <h3 className="text-xl font-semibold text-ink mb-4">Portfolio Performance</h3>
        <div className="relative h-[160px]">
          {/* Placeholder dashed line */}
          <svg width="100%" height="100%" className="absolute inset-0">
            <line x1="0" y1="80" x2="100%" y2="80" stroke="#E8E6E0" strokeWidth="2" strokeDasharray="8,6" />
            <line x1="0" y1="120" x2="100%" y2="120" stroke="#E8E6E0" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
            <line x1="0" y1="40" x2="100%" y2="40" stroke="#E8E6E0" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
          </svg>
          {/* Overlay message */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-base text-ink-muted mb-2">Start trading to see your performance</p>
            <a href="/create" className="text-base text-accent hover:underline">Create your first rebalance &rarr;</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('card p-6', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-ink">Portfolio Performance</h3>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={clsx(
                'px-2 py-1 text-sm rounded font-medium transition-colors',
                r === range
                  ? 'bg-accent text-white'
                  : 'text-ink-secondary hover:text-ink hover:bg-surface-hover',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E0" />
          <XAxis dataKey="time" tick={{ fontSize: 13, fill: '#6B6B6B' }} />
          <YAxis tick={{ fontSize: 13, fill: '#6B6B6B' }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E8E6E0', borderRadius: '8px' }}
            labelStyle={{ color: '#6B6B6B' }}
            itemStyle={{ color: '#2563EB' }}
            formatter={(value: number) => [`${value.toLocaleString()} CC`, 'Value']}
          />
          <Line type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
