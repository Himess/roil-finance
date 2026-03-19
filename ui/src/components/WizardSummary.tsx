import { useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, Sector, ResponsiveContainer } from 'recharts';
import TokenIcon from './TokenIcon';
import { ASSET_COLORS } from '@/config';
import { Shield } from 'lucide-react';

const TOKEN_NAMES: Record<string, string> = {
  CC: 'Canton Coin', USDCx: 'USD Coin', CBTC: 'Canton BTC',
  ETHx: 'Canton ETH', SOLx: 'Canton SOL', XAUt: 'Tokenized Gold',
  XAGt: 'Tokenized Silver', USTb: 'US Treasury Bond', MMF: 'Money Market Fund',
};

interface ChartEntry {
  symbol: string;
  name: string;
  value: number;
  fill: string;
}

// Custom tooltip with token logo
function ChartTooltip({ active, payload }: any) {
  if (active && payload?.[0]) {
    const { symbol, name, value, fill } = payload[0].payload as ChartEntry;
    return (
      <div className="bg-white rounded-lg shadow-md border border-surface-border px-3 py-2">
        <div className="flex items-center gap-2">
          <TokenIcon symbol={symbol} size={18} showBadge={false} />
          <span className="text-base font-semibold text-ink">{symbol}</span>
          <span className="text-base font-semibold text-ink">{value}%</span>
        </div>
        <div className="text-sm text-ink-muted">{name}</div>
      </div>
    );
  }
  return null;
}

// Active shape — segment grows on hover
function ActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 4}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  );
}

interface WizardSummaryProps {
  step: number;
  templateName?: string;
  selectedTokens: string[];
  allocations: Record<string, number>;
  weightMode: 'equal' | 'custom';
  triggerMode?: string;
  portfolioName?: string;
}

export default function WizardSummary({
  step, templateName, selectedTokens, allocations, weightMode, triggerMode, portfolioName
}: WizardSummaryProps) {
  // Step 0: no preview yet
  if (step === 0) {
    return (
      <div className="card p-6 sticky top-24">
        <h3 className="text-xl font-bold text-ink mb-4">Portfolio Preview</h3>
        <p className="text-base text-ink-muted text-center py-8">Select a strategy to preview</p>
      </div>
    );
  }

  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const onPieEnter = useCallback((_: any, index: number) => setActiveIndex(index), []);
  const onPieLeave = useCallback(() => setActiveIndex(undefined), []);

  const chartData: ChartEntry[] = selectedTokens
    .filter(s => allocations[s] > 0)
    .map(s => ({
      symbol: s,
      name: TOKEN_NAMES[s] || s,
      value: allocations[s],
      fill: ASSET_COLORS[s] || '#6B7280',
    }));

  return (
    <div className="card p-6 sticky top-24 space-y-5">
      <h3 className="text-xl font-bold text-ink">Portfolio Preview</h3>

      {portfolioName && (
        <div>
          <p className="text-sm text-ink-muted uppercase tracking-wider">Name</p>
          <p className="text-lg font-medium text-ink">{portfolioName}</p>
        </div>
      )}

      <div>
        <p className="text-sm text-ink-muted uppercase tracking-wider mb-1">Strategy</p>
        <p className="text-lg text-ink">{templateName || 'Custom'}</p>
      </div>

      <div>
        <p className="text-sm text-ink-muted uppercase tracking-wider mb-1">Weight Mode</p>
        <p className="text-lg text-ink capitalize">{weightMode}</p>
      </div>

      {selectedTokens.length > 0 && (
        <>
          <div>
            <p className="text-sm text-ink-muted uppercase tracking-wider mb-2">
              Allocation ({selectedTokens.length} tokens)
            </p>
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    paddingAngle={2}
                    activeIndex={activeIndex}
                    activeShape={ActiveShape}
                    onMouseEnter={onPieEnter}
                    onMouseLeave={onPieLeave}
                    cursor="pointer"
                  >
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="space-y-2">
            {selectedTokens.map(s => (
              <div key={s} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TokenIcon symbol={s} size={20} />
                  <span className="text-base text-ink">{s}</span>
                </div>
                <span className="text-base font-medium text-ink">{allocations[s] || 0}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {triggerMode && (
        <div>
          <p className="text-sm text-ink-muted uppercase tracking-wider mb-1">Rebalancing</p>
          <p className="text-lg text-ink">{triggerMode}</p>
        </div>
      )}

      <div className="pt-3 border-t border-surface-border flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-sm text-emerald-700">Privacy: Canton Network</span>
      </div>
    </div>
  );
}
