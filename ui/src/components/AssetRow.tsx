import React from 'react';
import { ASSET_COLORS } from '@/config';
import clsx from 'clsx';
import TokenIcon from '@/components/TokenIcon';

interface AssetRowProps {
  symbol: string;
  currentPct: number;
  targetPct: number;
  valueCc: number;
  holding?: { amount: number; valueCc: number };
  priceUsd?: number;
  onTargetChange: (newPct: number) => void;
  editable?: boolean;
}

function AssetRow({
  symbol,
  currentPct,
  targetPct,
  valueCc,
  holding,
  priceUsd,
  onTargetChange,
  editable = true,
}: AssetRowProps) {
  const color = ASSET_COLORS[symbol] ?? '#6B7280';
  const drift = Math.abs(currentPct - targetPct);
  const driftColor =
    drift > 5 ? 'text-negative' : drift > 3 ? 'text-warning' : 'text-positive';

  return (
    <div className="flex items-center gap-4 py-3 px-4 rounded-lg hover:bg-surface-hover transition-colors">
      {/* Asset icon */}
      <TokenIcon symbol={symbol} size={40} />

      {/* Asset name + current % */}
      <div className="min-w-[100px]">
        <p className="text-base font-semibold text-ink">{symbol}</p>
        <p className="text-sm text-ink-secondary">
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
          aria-label={`Target allocation for ${symbol}`}
          className={clsx(
            'flex-1 h-1.5 rounded-full appearance-none cursor-pointer',
            'bg-surface-border',
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
          className="input-field w-20 text-center text-base"
        />
        <span className="text-sm text-ink-muted">%</span>
      </div>

      {/* Value */}
      <div className="text-right min-w-[90px] shrink-0">
        <p className="text-base font-medium text-ink">
          {valueCc.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-sm text-ink-muted">CC</p>
        {holding && (
          <div className="flex justify-between text-sm text-ink-secondary mt-1">
            <span>{holding.amount.toLocaleString()} {symbol}</span>
            <span className="text-ink-muted">
              {priceUsd ? ` ($${(holding.amount * priceUsd).toLocaleString()})` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(AssetRow);
