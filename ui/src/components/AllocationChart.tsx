import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import type { Holding, TargetAllocation } from '@/types';
import { ASSET_COLORS } from '@/config';

interface AllocationChartProps {
  holdings: Holding[];
  targets: TargetAllocation[];
}

function getColor(symbol: string): string {
  return ASSET_COLORS[symbol] ?? '#6B7280';
}

interface ChartEntry {
  name: string;
  value: number;
  fill: string;
}

export default function AllocationChart({
  holdings,
  targets,
}: AllocationChartProps) {
  const totalValue = holdings.reduce((acc, h) => acc + h.valueCc, 0);

  // Current allocations (inner ring)
  const currentData: ChartEntry[] = holdings.map((h) => ({
    name: h.asset.symbol,
    value: totalValue > 0 ? Math.round((h.valueCc / totalValue) * 10000) / 100 : 0,
    fill: getColor(h.asset.symbol),
  }));

  // Target allocations (outer ring)
  const targetData: ChartEntry[] = targets.map((t) => ({
    name: t.asset.symbol,
    value: t.targetPct,
    fill: getColor(t.asset.symbol),
  }));

  const renderCustomLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    value,
  }: {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    value: number;
  }) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (value < 10) return null;

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-xs font-medium"
      >
        {value}%
      </text>
    );
  };

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; payload: ChartEntry }>;
  }) => {
    if (!active || !payload || !payload.length) return null;
    const entry = payload[0];
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-sm font-medium text-white">{entry.name}</p>
        <p className="text-xs text-slate-400">{entry.value}%</p>
      </div>
    );
  };

  const renderLegend = () => {
    const allSymbols = new Set([
      ...holdings.map((h) => h.asset.symbol),
      ...targets.map((t) => t.asset.symbol),
    ]);

    return (
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-2">
        {Array.from(allSymbols).map((symbol) => {
          const current = currentData.find((d) => d.name === symbol);
          const target = targetData.find((d) => d.name === symbol);
          return (
            <div key={symbol} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getColor(symbol) }}
              />
              <span className="text-xs text-slate-300 font-medium">
                {symbol}
              </span>
              <span className="text-xs text-slate-500">
                {current?.value ?? 0}% / {target?.value ?? 0}%
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300">
          Portfolio Allocation
        </h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-slate-400" />
            Current
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Target
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          {/* Inner ring — Current allocations */}
          <Pie
            data={currentData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
            label={renderCustomLabel}
            labelLine={false}
          >
            {currentData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} opacity={0.85} />
            ))}
          </Pie>

          {/* Outer ring — Target allocations */}
          <Pie
            data={targetData}
            cx="50%"
            cy="50%"
            innerRadius={92}
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {targetData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} opacity={0.45} />
            ))}
          </Pie>

          <Tooltip content={<CustomTooltip />} />
          <Legend content={renderLegend} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
