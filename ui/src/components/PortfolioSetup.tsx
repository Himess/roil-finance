import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, AlertCircle, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import AssetRow from './AssetRow';
import TemplateSelector from './TemplateSelector';
import type { TargetAllocation, TriggerMode, Holding, AssetId } from '@/types';
import { AVAILABLE_ASSETS, PORTFOLIO_TEMPLATES } from '@/config';

interface PortfolioSetupProps {
  initialTargets: TargetAllocation[];
  holdings: Holding[];
  triggerMode: TriggerMode;
  priceMap?: Map<string, number>;
  onSave?: (targets: TargetAllocation[], mode: TriggerMode) => void;
  className?: string;
}

export default function PortfolioSetup({
  initialTargets,
  holdings,
  triggerMode: initialTriggerMode,
  priceMap,
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTargets(initialTargets);
  }, [initialTargets]);

  useEffect(() => {
    setTriggerMode(initialTriggerMode);
  }, [initialTriggerMode]);

  useEffect(() => {
    if (!showAssetSelector) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAssetSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAssetSelector]);

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

  const handleTemplateSelect = useCallback(
    (template: typeof PORTFOLIO_TEMPLATES[number]) => {
      const newTargets: TargetAllocation[] = template.targets.map((t) => ({
        asset: t.asset,
        targetPct: t.targetPct,
      }));
      setTargets(newTargets);
      const thresholdVal = Number(template.triggerMode.value) || 5;
      setDriftThreshold(thresholdVal);
      setTriggerMode({ tag: 'DriftThreshold', value: thresholdVal });
      setIsEditing(true);
    },
    [],
  );

  const availableToAdd = AVAILABLE_ASSETS.filter(
    (a) => !targets.find((t) => t.asset.symbol === a.symbol),
  );

  return (
    <div className={clsx('card', className)}>
      {/* Template selector — quick start */}
      {!isEditing && (
        <div className="mb-6">
          <TemplateSelector onSelect={handleTemplateSelect} />
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-ink">
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
                className="btn-secondary text-base py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!isValid}
                className="btn-primary text-base py-1.5 px-3"
              >
                <Check className="w-3.5 h-3.5 inline mr-1" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="btn-secondary text-base py-1.5 px-3"
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
                holding={holding}
                priceUsd={priceMap?.get(t.asset.symbol)}
                onTargetChange={(pct) =>
                  handleTargetChange(t.asset.symbol, pct)
                }
                editable={isEditing}
              />
              {isEditing && targets.length > 2 && (
                <button
                  onClick={() => removeAsset(t.asset.symbol)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-sm text-negative hover:text-red-700 transition-opacity px-2 py-1"
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Total + validation */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-border">
        <div className="flex items-center gap-2">
          {!isValid && isEditing && (
            <AlertCircle className="w-4 h-4 text-warning" />
          )}
          <span
            className={clsx(
              'text-sm font-medium',
              isValid ? 'text-ink-secondary' : 'text-warning',
            )}
          >
            Total: {totalPct.toFixed(1)}%
          </span>
          {!isValid && isEditing && (
            <span className="text-sm text-warning/70">
              {totalPct < 99.9
                ? `${(100 - totalPct).toFixed(1)}% remaining`
                : 'Exceeds 100%'}
            </span>
          )}
        </div>

        {/* Add asset button */}
        {isEditing && availableToAdd.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowAssetSelector((v) => !v)}
              className="btn-secondary text-base py-1.5 px-3 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Asset
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAssetSelector && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-surface-border rounded-lg shadow-lg py-1 z-10 min-w-[140px]">
                {availableToAdd.map((a) => (
                  <button
                    key={a.symbol}
                    onClick={() => addAsset(a)}
                    className="w-full text-left px-3 py-2 text-base text-ink hover:bg-surface-hover transition-colors"
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
        <div className="mt-5 pt-4 border-t border-surface-border">
          <p className="text-sm text-ink-muted uppercase tracking-wider font-medium mb-3">
            Trigger Mode
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTriggerMode({ tag: 'Manual' })}
              className={clsx(
                'flex-1 py-2.5 px-4 rounded-lg text-base font-medium border transition-colors',
                triggerMode.tag === 'Manual'
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-surface-border text-ink-secondary hover:border-ink-faint',
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
                'flex-1 py-2.5 px-4 rounded-lg text-base font-medium border transition-colors',
                triggerMode.tag === 'DriftThreshold'
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-surface-border text-ink-secondary hover:border-ink-faint',
              )}
            >
              Auto-Drift
            </button>
          </div>

          {triggerMode.tag === 'DriftThreshold' && (
            <div className="mt-3 flex items-center gap-3">
              <label className="text-sm text-ink-secondary">Threshold:</label>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={driftThreshold}
                onChange={(e) =>
                  setDriftThreshold(parseFloat(e.target.value) || 5)
                }
                className="input-field w-20 text-center text-base"
              />
              <span className="text-sm text-ink-muted">
                % max drift before auto-rebalance
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
