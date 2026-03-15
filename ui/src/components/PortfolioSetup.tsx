import { useState, useMemo, useCallback } from 'react';
import { Plus, AlertCircle, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import AssetRow from './AssetRow';
import type { TargetAllocation, TriggerMode, AssetId, Holding } from '@/types';

interface PortfolioSetupProps {
  initialTargets: TargetAllocation[];
  holdings: Holding[];
  triggerMode: TriggerMode;
  onSave?: (targets: TargetAllocation[], mode: TriggerMode) => void;
  className?: string;
}

const AVAILABLE_ASSETS: AssetId[] = [
  { symbol: 'CC', admin: 'Canton::Admin' },
  { symbol: 'USDCx', admin: 'Canton::Admin' },
  { symbol: 'CBTC', admin: 'Canton::Admin' },
  { symbol: 'ETHx', admin: 'Canton::Admin' },
  { symbol: 'SOLx', admin: 'Canton::Admin' },
];

export default function PortfolioSetup({
  initialTargets,
  holdings,
  triggerMode: initialTriggerMode,
  onSave,
  className,
}: PortfolioSetupProps) {
  const [targets, setTargets] = useState<TargetAllocation[]>(initialTargets);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>(initialTriggerMode);
  const [driftThreshold, setDriftThreshold] = useState(
    initialTriggerMode.tag === 'DriftThreshold' ? initialTriggerMode.value : 5,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [showAssetSelector, setShowAssetSelector] = useState(false);

  const totalPct = useMemo(
    () => targets.reduce((acc, t) => acc + t.targetPct, 0),
    [targets],
  );

  const isValid = totalPct >= 99.9 && totalPct <= 100.1 && targets.length >= 2;
  const totalValue = holdings.reduce((acc, h) => acc + h.valueCc, 0);

  const handleTargetChange = useCallback(
    (symbol: string, newPct: number) => {
      setTargets((prev) =>
        prev.map((t) =>
          t.asset.symbol === symbol ? { ...t, targetPct: newPct } : t,
        ),
      );
    },
    [],
  );

  const addAsset = useCallback((asset: AssetId) => {
    setTargets((prev) => {
      if (prev.find((t) => t.asset.symbol === asset.symbol)) return prev;
      return [...prev, { asset, targetPct: 0 }];
    });
    setShowAssetSelector(false);
  }, []);

  const removeAsset = useCallback((symbol: string) => {
    setTargets((prev) => prev.filter((t) => t.asset.symbol !== symbol));
  }, []);

  const handleSave = useCallback(() => {
    if (!isValid || !onSave) return;
    const mode: TriggerMode =
      triggerMode.tag === 'DriftThreshold'
        ? { tag: 'DriftThreshold', value: driftThreshold }
        : { tag: 'Manual' };
    onSave(targets, mode);
    setIsEditing(false);
  }, [isValid, onSave, targets, triggerMode, driftThreshold]);

  const availableToAdd = AVAILABLE_ASSETS.filter(
    (a) => !targets.find((t) => t.asset.symbol === a.symbol),
  );

  return (
    <div className={clsx('card', className)}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-slate-300">
          Target Allocations
        </h3>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  setTargets(initialTargets);
                  setTriggerMode(initialTriggerMode);
                  setIsEditing(false);
                }}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!isValid}
                className="btn-primary text-xs py-1.5 px-3"
              >
                <Check className="w-3.5 h-3.5 inline mr-1" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Asset rows */}
      <div className="space-y-1">
        {targets.map((t) => {
          const holding = holdings.find(
            (h) => h.asset.symbol === t.asset.symbol,
          );
          const currentPct =
            totalValue > 0 && holding
              ? (holding.valueCc / totalValue) * 100
              : 0;

          return (
            <div key={t.asset.symbol} className="relative group">
              <AssetRow
                symbol={t.asset.symbol}
                currentPct={currentPct}
                targetPct={t.targetPct}
                valueCc={holding?.valueCc ?? 0}
                onTargetChange={(pct) =>
                  handleTargetChange(t.asset.symbol, pct)
                }
                editable={isEditing}
              />
              {isEditing && targets.length > 2 && (
                <button
                  onClick={() => removeAsset(t.asset.symbol)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition-opacity px-2 py-1"
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Total + validation */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700">
        <div className="flex items-center gap-2">
          {!isValid && isEditing && (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
          <span
            className={clsx(
              'text-sm font-medium',
              isValid ? 'text-slate-400' : 'text-amber-400',
            )}
          >
            Total: {totalPct.toFixed(1)}%
          </span>
          {!isValid && isEditing && (
            <span className="text-xs text-amber-400/70">
              {totalPct < 99.9
                ? `${(100 - totalPct).toFixed(1)}% remaining`
                : 'Exceeds 100%'}
            </span>
          )}
        </div>

        {/* Add asset button */}
        {isEditing && availableToAdd.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowAssetSelector((v) => !v)}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Asset
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAssetSelector && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-10 min-w-[140px]">
                {availableToAdd.map((a) => (
                  <button
                    key={a.symbol}
                    onClick={() => addAsset(a)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    {a.symbol}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trigger mode selector */}
      {isEditing && (
        <div className="mt-5 pt-4 border-t border-slate-700">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-3">
            Trigger Mode
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTriggerMode({ tag: 'Manual' })}
              className={clsx(
                'flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-colors',
                triggerMode.tag === 'Manual'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500',
              )}
            >
              Manual
            </button>
            <button
              onClick={() =>
                setTriggerMode({
                  tag: 'DriftThreshold',
                  value: driftThreshold,
                })
              }
              className={clsx(
                'flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-colors',
                triggerMode.tag === 'DriftThreshold'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500',
              )}
            >
              Auto-Drift
            </button>
          </div>

          {triggerMode.tag === 'DriftThreshold' && (
            <div className="mt-3 flex items-center gap-3">
              <label className="text-xs text-slate-400">Threshold:</label>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={driftThreshold}
                onChange={(e) =>
                  setDriftThreshold(parseFloat(e.target.value) || 5)
                }
                className="input-field w-20 text-center text-sm"
              />
              <span className="text-xs text-slate-500">
                % max drift before auto-rebalance
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
