import { ASSET_COLORS } from '@/config';
import clsx from 'clsx';

interface AssetRowProps {
  symbol: string;
  currentPct: number;
  targetPct: number;
  valueCc: number;
  onTargetChange: (newPct: number) => void;
  editable?: boolean;
}

function getAssetIcon(symbol: string): string {
  switch (symbol) {
    case 'CC':
      return 'C';
    case 'USDCx':
      return '$';
    case 'CBTC':
      return 'B';
    case 'ETHx':
      return 'E';
    default:
      return symbol.charAt(0);
  }
}

export default function AssetRow({
  symbol,
  currentPct,
  targetPct,
  valueCc,
  onTargetChange,
  editable = true,
}: AssetRowProps) {
  const color = ASSET_COLORS[symbol] ?? '#6B7280';
  const drift = Math.abs(currentPct - targetPct);
  const driftColor =
    drift > 5 ? 'text-red-400' : drift > 3 ? 'text-amber-400' : 'text-green-400';

  return (
    <div className="flex items-center gap-4 py-3 px-4 rounded-lg hover:bg-slate-700/30 transition-colors">
      {/* Asset icon */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
        style={{ backgroundColor: color }}
      >
        {getAssetIcon(symbol)}
      </div>

      {/* Asset name + current % */}
      <div className="min-w-[100px]">
        <p className="text-sm font-semibold text-white">{symbol}</p>
        <p className="text-xs text-slate-400">
          Current:{' '}
          <span className={driftColor}>{currentPct.toFixed(1)}%</span>
        </p>
      </div>

      {/* Slider */}
      <div className="flex-1 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={targetPct}
          onChange={(e) => onTargetChange(parseFloat(e.target.value))}
          disabled={!editable}
          className={clsx(
            'flex-1 h-1.5 rounded-full appearance-none cursor-pointer',
            'bg-slate-600',
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:w-4',
            '[&::-webkit-slider-thumb]:h-4',
            '[&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:cursor-pointer',
            !editable && 'opacity-60 cursor-not-allowed',
          )}
          style={{
            // Use CSS variable for the thumb color
            accentColor: color,
          }}
        />
      </div>

      {/* Target % input */}
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={targetPct}
          onChange={(e) => onTargetChange(parseFloat(e.target.value) || 0)}
          disabled={!editable}
          className="input-field w-20 text-center text-sm"
        />
        <span className="text-xs text-slate-500">%</span>
      </div>

      {/* Value */}
      <div className="text-right min-w-[90px] shrink-0">
        <p className="text-sm font-medium text-white">
          {valueCc.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-xs text-slate-500">CC</p>
      </div>
    </div>
  );
}
