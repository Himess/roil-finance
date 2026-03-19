import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Holding, TargetAllocation } from '@/types';
import { ASSET_COLORS } from '@/config';
import TokenIcon from '@/components/TokenIcon';

interface AllocationChartProps {
  holdings: Holding[];
  targets: TargetAllocation[];
}

export default function AllocationChart({
  holdings,
  targets,
}: AllocationChartProps) {
  if (!holdings || holdings.length === 0) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <p className="text-base text-ink-muted">No holdings to display</p>
      </div>
    );
  }

  const totalValue = holdings.reduce((acc, h) => acc + h.valueCc, 0);

  const chartData = useMemo(() => {
    return targets.map(target => {
      const holding = holdings.find(h => h.asset.symbol === target.asset.symbol);
      const currentPct = totalValue > 0 && holding ? (holding.valueCc / totalValue) * 100 : 0;
      return {
        asset: target.asset.symbol,
        current: Math.round(currentPct * 10) / 10,
        target: target.targetPct,
        color: ASSET_COLORS[target.asset.symbol] || '#6B7280',
      };
    });
  }, [targets, holdings, totalValue]);

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number }>;
    label?: string;
  }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-white border border-surface-border rounded-lg px-3 py-2 shadow-lg">
        <p className="text-base font-medium text-ink mb-1">{label}</p>
        {payload.map((entry) => (
          <p key={entry.name} className="text-sm text-ink-secondary">
            {entry.name}: {entry.value}%
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-ink">
          Portfolio Allocation
        </h3>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-accent" />
            Current
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-accent/25 border border-accent border-dashed" />
            Target
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={targets.length * 60 + 40}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 13, fill: '#6B6B6B' }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="asset"
            tick={(props: { x: number; y: number; payload: { value: string } }) => {
              const { x, y, payload } = props;
              return (
                <g transform={`translate(${x},${y})`}>
                  <foreignObject x={-60} y={-12} width={56} height={24}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <TokenIcon symbol={payload.value} size={18} showBadge={false} />
                      <span style={{ fontSize: 13, fill: '#1A1A1A', fontWeight: 500, color: '#1A1A1A' }}>{payload.value}</span>
                    </div>
                  </foreignObject>
                </g>
              );
            }}
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="current" name="Current" radius={[0, 4, 4, 0]} barSize={16}>
            {chartData.map((entry, idx) => (
              <Cell key={`current-${idx}`} fill={entry.color} />
            ))}
          </Bar>
          <Bar dataKey="target" name="Target" radius={[0, 4, 4, 0]} barSize={16} strokeDasharray="3 3">
            {chartData.map((entry, idx) => (
              <Cell key={`target-${idx}`} fill={entry.color} fillOpacity={0.2} stroke={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
