import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Scale,
  SlidersHorizontal,
  Coins,
  Settings2,
  ClipboardCheck,
  AlertCircle,
  LayoutGrid,
  ExternalLink,
  Pencil,
} from 'lucide-react';
import clsx from 'clsx';
import { AVAILABLE_ASSETS, ASSET_COLORS, PORTFOLIO_TEMPLATES } from '@/config';
import { useParty } from '@/context/PartyContext';
import { useCreatePortfolio } from '@/hooks/usePortfolio';
import { useToast } from '@/components/Toast';
import TokenIcon from '@/components/TokenIcon';
import WizardSummary from '@/components/WizardSummary';
import { TOKEN_MARKET_DATA, getTokenExplorerUrl, getInstrumentId } from '@/lib/tokenPrices';
import type { TargetAllocation, TriggerMode } from '@/types';

// ---------------------------------------------------------------------------
// Token metadata
// ---------------------------------------------------------------------------

const TOKEN_INFO: Record<string, { name: string; category: string }> = {
  CC: { name: 'Canton Coin', category: 'Crypto' },
  USDCx: { name: 'USD Coin', category: 'Stablecoin' },
  CBTC: { name: 'Canton BTC', category: 'Crypto' },
  ETHx: { name: 'Canton ETH', category: 'Crypto' },
  SOLx: { name: 'Canton SOL', category: 'Crypto' },
  XAUt: { name: 'Tokenized Gold', category: 'RWA' },
  XAGt: { name: 'Tokenized Silver', category: 'RWA' },
  USTb: { name: 'US Treasury Bond', category: 'RWA' },
  MMF: { name: 'Money Market Fund', category: 'RWA' },
};

const CATEGORY_ORDER = ['Stablecoin', 'Crypto', 'RWA'];

type WeightMode = 'equal' | 'custom';
type TriggerSelection = 'Manual' | 'DriftThreshold' | 'PriceCondition';

const STEPS = [
  { label: 'Choose', icon: LayoutGrid },
  { label: 'Weight Mode', icon: Scale },
  { label: 'Select Tokens', icon: Coins },
  { label: 'Allocations', icon: SlidersHorizontal },
  { label: 'Configure', icon: Settings2 },
  { label: 'Review', icon: ClipboardCheck },
];


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreatePortfolio() {
  const navigate = useNavigate();
  const { party } = useParty();
  const createPortfolio = useCreatePortfolio();
  const { addToast } = useToast();

  // Step state (0 = Choose, 1 = Weight Mode, 2 = Select Tokens, 3 = Allocations, 4 = Configure, 5 = Review)
  const [step, setStep] = useState(0);

  // Step 1: Weight mode
  const [weightMode, setWeightMode] = useState<WeightMode | null>(null);

  // Step 2: Selected tokens
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // Step 3: Allocations (custom mode)
  const [customAllocations, setCustomAllocations] = useState<Record<string, number>>({});

  // Step 4: Configuration
  const [triggerSelection, setTriggerSelection] = useState<TriggerSelection>('DriftThreshold');
  const [driftThreshold, setDriftThreshold] = useState(5);
  const [portfolioName, setPortfolioName] = useState('');

  // Inline editing in Review step
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editingTrigger, setEditingTrigger] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [hasEdited, setHasEdited] = useState(false);

  // Whether we came from a template (skip straight to review)
  const [fromTemplate, setFromTemplate] = useState(false);

  // Track the selected template for the summary panel
  const [selectedTemplate, setSelectedTemplate] = useState<typeof PORTFOLIO_TEMPLATES[number] | null>(null);

  // Derived
  const tokenCount = selectedTokens.size;

  const allocations = useMemo(() => {
    if (weightMode === 'equal') {
      const base = Math.floor((100 / tokenCount) * 100) / 100;
      const tokens = Array.from(selectedTokens);
      const result: Record<string, number> = {};
      let remaining = 100;
      tokens.forEach((t, i) => {
        if (i === tokens.length - 1) {
          result[t] = Math.round(remaining * 100) / 100;
        } else {
          result[t] = base;
          remaining -= base;
        }
      });
      return result;
    }
    return customAllocations;
  }, [weightMode, selectedTokens, tokenCount, customAllocations]);

  const totalPct = useMemo(
    () => Object.values(allocations).reduce((a, b) => a + b, 0),
    [allocations],
  );

  const isAllocationValid = totalPct >= 99.9 && totalPct <= 100.1;

  // Handlers
  const toggleToken = useCallback((symbol: string) => {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
    setCustomAllocations((prev) => {
      const copy = { ...prev };
      if (copy[symbol] !== undefined) {
        delete copy[symbol];
      } else {
        copy[symbol] = 0;
      }
      return copy;
    });
  }, []);

  const setAllocation = useCallback((symbol: string, value: number) => {
    setCustomAllocations((prev) => ({ ...prev, [symbol]: value }));
  }, []);

  const distributeEvenly = useCallback(() => {
    const tokens = Array.from(selectedTokens);
    const base = Math.floor((100 / tokens.length) * 100) / 100;
    const result: Record<string, number> = {};
    let remaining = 100;
    tokens.forEach((t, i) => {
      if (i === tokens.length - 1) {
        result[t] = Math.round(remaining * 100) / 100;
      } else {
        result[t] = base;
        remaining -= base;
      }
    });
    setCustomAllocations(result);
  }, [selectedTokens]);

  // Handle inline allocation edit
  const handleAllocationEdit = useCallback((symbol: string, newValue: number) => {
    const clamped = Math.min(100, Math.max(0, newValue));
    setCustomAllocations(prev => ({ ...prev, [symbol]: clamped }));
    setHasEdited(true);
    if (weightMode === 'equal') {
      // Switch to custom if user edits from equal mode
      setWeightMode('custom');
    }
  }, [weightMode]);

  // Handle trigger edit
  const handleTriggerEdit = useCallback((newThreshold: number) => {
    setDriftThreshold(Math.min(20, Math.max(1, newThreshold)));
    setHasEdited(true);
  }, []);

  // Reset to template
  const handleResetToTemplate = useCallback(() => {
    if (!selectedTemplate) return;
    const newAllocs: Record<string, number> = {};
    selectedTemplate.targets.forEach(t => {
      newAllocs[t.asset.symbol] = t.targetPct;
    });
    setCustomAllocations(newAllocs);
    setDriftThreshold(Number(selectedTemplate.triggerMode.value) || 5);
    setHasEdited(false);
  }, [selectedTemplate]);

  // Compute total for review step validation
  const allocationTotal = useMemo(() => {
    return Array.from(selectedTokens).reduce((sum, s) => sum + (customAllocations[s] || 0), 0);
  }, [selectedTokens, customAllocations]);

  const isValidTotal = allocationTotal >= 99.9 && allocationTotal <= 100.1;

  const handleSelectTemplate = useCallback((template: typeof PORTFOLIO_TEMPLATES[number]) => {
    // Fill in all state from the template
    setSelectedTemplate(template);
    setWeightMode('custom');
    const tokens = new Set(template.targets.map((t) => t.asset.symbol));
    setSelectedTokens(tokens);
    const allocs: Record<string, number> = {};
    template.targets.forEach((t) => {
      allocs[t.asset.symbol] = t.targetPct;
    });
    setCustomAllocations(allocs);
    setPortfolioName(template.name);
    if (template.triggerMode.tag === 'DriftThreshold') {
      setTriggerSelection('DriftThreshold');
      setDriftThreshold(template.triggerMode.value as number);
    } else {
      setTriggerSelection('Manual');
    }
    setFromTemplate(true);
    setStep(5); // Jump to review
  }, []);

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return true; // user must pick template or click Build Custom
      case 1:
        return weightMode !== null;
      case 2:
        return tokenCount >= 2;
      case 3:
        return isAllocationValid;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  }, [step, weightMode, tokenCount, isAllocationValid]);

  const goNext = () => {
    if (step < 5 && canProceed) setStep(step + 1);
  };

  const goBack = () => {
    if (fromTemplate && step === 5) {
      // Going back from review when template was selected - go back to Choose
      setFromTemplate(false);
      setStep(0);
      return;
    }
    if (step > 0) setStep(step - 1);
  };

  const buildTargets = (): TargetAllocation[] =>
    Array.from(selectedTokens).map((symbol) => ({
      asset: { symbol, admin: 'Canton::Admin' },
      targetPct: allocations[symbol] ?? 0,
    }));

  const buildTriggerMode = (): TriggerMode => {
    if (triggerSelection === 'DriftThreshold') {
      return { tag: 'DriftThreshold', value: driftThreshold };
    }
    return { tag: 'Manual' };
  };

  const handleCreate = async () => {
    const targets = buildTargets();
    const mode = buildTriggerMode();
    try {
      await createPortfolio.mutate({
        user: party,
        targets,
        triggerMode: mode,
      });
      addToast('success', 'Portfolio created successfully');
      navigate('/');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to create portfolio: ${message}`);
    }
  };

  // Group tokens by category for the selection grid
  const tokensByCategory = useMemo(() => {
    const groups: Record<string, typeof AVAILABLE_ASSETS> = {};
    for (const cat of CATEGORY_ORDER) groups[cat] = [];
    for (const a of AVAILABLE_ASSETS) {
      const info = TOKEN_INFO[a.symbol];
      const cat = info?.category ?? 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(a);
    }
    return groups;
  }, []);

  return (
    <div className="h-full flex flex-col px-2">
      {/* Header — shrink-0 so it doesn't collapse */}
      <div className="shrink-0 flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-5xl font-extrabold text-ink">Create Portfolio</h2>
          <p className="text-xl text-ink-secondary mt-0.5">
            Build a custom portfolio in a few steps
          </p>
        </div>
      </div>

      {/* Step indicator — shrink-0 */}
      <div className="shrink-0 flex items-center mb-5">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isCompleted = i < step;
          const isCurrent = i === step;
          return (
            <div key={s.label} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => {
                  if (i < step) {
                    if (fromTemplate && i < 5) {
                      setFromTemplate(false);
                    }
                    setStep(i);
                  }
                }}
                disabled={i > step}
                className={clsx(
                  'flex items-center gap-2 transition-colors',
                  isCurrent && 'text-accent',
                  isCompleted && 'text-accent cursor-pointer',
                  !isCurrent && !isCompleted && 'text-ink-muted',
                )}
              >
                <div
                  className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 transition-colors',
                    isCompleted && 'bg-accent text-white',
                    isCurrent && 'bg-accent-light text-accent border border-accent',
                    !isCurrent && !isCompleted && 'bg-surface-muted text-ink-muted',
                  )}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className="text-base font-medium hidden lg:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={clsx(
                    'flex-1 h-0.5 mx-3',
                    i < step ? 'bg-accent' : 'bg-surface-border',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content + Summary panel — flex-1 fills remaining viewport */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
      <div className="flex flex-col min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        {/* ----------------------------------------------------------------- */}
        {/* STEP 0: Choose (Templates or Custom) */}
        {/* ----------------------------------------------------------------- */}
        {step === 0 && (
          <div className="step-animate flex flex-col flex-1 min-h-0">
            <div className="shrink-0">
              <h3 className="text-3xl font-bold text-ink mb-1">
                Choose a Strategy
              </h3>
              <p className="text-lg text-ink-secondary mb-4">
                Pick a pre-built template to get started quickly, or build your own from scratch.
              </p>
            </div>

            {/* Template cards — fill remaining viewport height */}
            <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto">
              {PORTFOLIO_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className={clsx(
                    'flex-1 flex items-center justify-between py-4 px-8 gap-8 rounded-xl border-2 transition-all duration-200 cursor-pointer',
                    'hover:shadow-md hover:-translate-y-0.5',
                    'border-surface-border hover:border-ink-faint',
                    'bg-surface-card',
                  )}
                >
                  {/* Left: Name + Description (text-left) */}
                  <div className="flex-1 min-w-0 text-left flex flex-col justify-center">
                    <h4 className="text-2xl font-bold text-ink">{template.name}</h4>
                    <p className="text-lg text-ink-secondary mt-2">{template.description}</p>
                  </div>

                  {/* Right: Tokens + Badge top, CTA bottom */}
                  <div className="flex flex-col items-end justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {template.targets.map((t) => (
                          <TokenIcon key={t.asset.symbol} symbol={t.asset.symbol} size={40} showBadge={false} />
                        ))}
                      </div>
                    </div>
                    <span className="text-lg font-semibold text-accent whitespace-nowrap mt-3">
                      Use This Strategy →
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 my-8">
              <div className="flex-1 h-px bg-surface-border" />
              <span className="text-sm text-ink-muted">or build your own</span>
              <div className="flex-1 h-px bg-surface-border" />
            </div>

            {/* Build Custom button */}
            <div className="flex justify-center">
              <button
                onClick={() => setStep(1)}
                className="btn-primary flex items-center gap-2 px-6"
              >
                Build Custom
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 1: Weight Mode */}
        {/* ----------------------------------------------------------------- */}
        {step === 1 && (
          <div className="step-animate">
            <h3 className="text-xl font-semibold text-ink mb-1">
              Choose Weight Mode
            </h3>
            <p className="text-base text-ink-secondary mb-6">
              How should assets be weighted in your portfolio?
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Equal weight card */}
              <button
                onClick={() => setWeightMode('equal')}
                className={clsx(
                  'text-left rounded-xl border-2 p-6 transition-all',
                  weightMode === 'equal'
                    ? 'border-accent bg-accent-light'
                    : 'border-surface-border bg-surface-card hover:border-ink-faint',
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={clsx(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      weightMode === 'equal'
                        ? 'bg-accent text-white'
                        : 'bg-surface-muted text-ink-secondary',
                    )}
                  >
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-semibold text-ink text-base block">
                      Equal Weight
                    </span>
                    {weightMode === 'equal' && (
                      <span className="text-sm text-accent font-medium">Selected</span>
                    )}
                  </div>
                </div>
                <p className="text-base text-ink-secondary leading-relaxed">
                  All selected tokens receive an equal percentage of your portfolio. Simple and balanced.
                </p>
              </button>

              {/* Custom weight card */}
              <button
                onClick={() => setWeightMode('custom')}
                className={clsx(
                  'text-left rounded-xl border-2 p-6 transition-all',
                  weightMode === 'custom'
                    ? 'border-accent bg-accent-light'
                    : 'border-surface-border bg-surface-card hover:border-ink-faint',
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={clsx(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      weightMode === 'custom'
                        ? 'bg-accent text-white'
                        : 'bg-surface-muted text-ink-secondary',
                    )}
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-semibold text-ink text-base block">
                      Custom Weight
                    </span>
                    {weightMode === 'custom' && (
                      <span className="text-sm text-accent font-medium">Selected</span>
                    )}
                  </div>
                </div>
                <p className="text-base text-ink-secondary leading-relaxed">
                  Set a specific percentage for each token. Full control over your allocation.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 2: Select Tokens */}
        {/* ----------------------------------------------------------------- */}
        {step === 2 && (
          <div className="step-animate">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-ink mb-1">
                  Select Tokens
                </h3>
                <p className="text-base text-ink-secondary">
                  Choose which assets to include in your portfolio
                </p>
              </div>
              <span
                className={clsx(
                  'text-sm font-medium px-3 py-1.5 rounded-full',
                  tokenCount >= 2
                    ? 'bg-accent-light text-accent'
                    : 'bg-surface-muted text-ink-muted',
                )}
              >
                {tokenCount} of {AVAILABLE_ASSETS.length} selected
              </span>
            </div>

            {tokenCount < 2 && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm text-amber-700">
                  Select at least 2 tokens to continue
                </span>
              </div>
            )}

            <div className="space-y-6">
              {CATEGORY_ORDER.map((cat) => {
                const tokens = tokensByCategory[cat];
                if (!tokens || tokens.length === 0) return null;
                return (
                  <div key={cat}>
                    <h4 className="text-base font-medium text-ink-muted uppercase tracking-wider mb-3">
                      {cat}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {tokens.map((asset) => {
                        const info = TOKEN_INFO[asset.symbol];
                        const isSelected = selectedTokens.has(asset.symbol);
                        const marketData = TOKEN_MARKET_DATA[asset.symbol];
                        return (
                          <button
                            key={asset.symbol}
                            onClick={() => toggleToken(asset.symbol)}
                            className={clsx(
                              'relative rounded-xl border-2 p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
                              isSelected
                                ? 'border-accent bg-accent-light'
                                : 'border-surface-border bg-surface-card hover:border-ink-faint',
                            )}
                          >
                            {isSelected && (
                              <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <TokenIcon symbol={asset.symbol} size={40} />
                                <div>
                                  <p className="text-lg font-semibold text-ink">{asset.symbol}</p>
                                  <p className="text-sm text-ink-muted leading-snug">{info?.name ?? asset.symbol}</p>
                                </div>
                              </div>
                              {marketData && (
                                <div className="text-right">
                                  <p className="text-base font-semibold text-ink">${marketData.price.toLocaleString()}</p>
                                  <p className={`text-sm ${marketData.change24h >= 0 ? 'text-positive' : 'text-negative'}`}>
                                    {marketData.change24h >= 0 ? '+' : ''}{marketData.change24h}%
                                  </p>
                                  <p className="text-sm text-ink-muted">{marketData.marketCap}</p>
                                </div>
                              )}
                            </div>
                            {marketData && (
                              <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-sm text-ink-muted">{marketData.standard}</span>
                                <span className="text-ink-faint">·</span>
                                <a
                                  href={getTokenExplorerUrl(asset.symbol)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-ink-muted hover:text-accent flex items-center gap-1 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  title={getInstrumentId(asset.symbol)}
                                >
                                  {asset.symbol === 'CC' ? 'CC Explorer' : 'CantonScan'}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 3: Set Allocations */}
        {/* ----------------------------------------------------------------- */}
        {step === 3 && (
          <div className="step-animate">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-ink mb-1">
                  Set Allocations
                </h3>
                <p className="text-base text-ink-secondary">
                  {weightMode === 'equal'
                    ? 'Each token receives an equal share of 100%'
                    : 'Drag the sliders to set each token\'s target percentage'}
                </p>
              </div>
              {weightMode === 'custom' && (
                <button
                  onClick={distributeEvenly}
                  className="text-sm text-accent hover:text-accent-hover font-medium"
                >
                  Distribute evenly
                </button>
              )}
            </div>

            {/* Allocation bar */}
            <div className="mb-6">
              <div className="h-3 rounded-full overflow-hidden flex bg-surface-muted">
                {Array.from(selectedTokens).map((symbol) => {
                  const pct = allocations[symbol] ?? 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={symbol}
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: ASSET_COLORS[symbol] ?? '#888',
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Array.from(selectedTokens).map((symbol) => (
                    <div key={symbol} className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: ASSET_COLORS[symbol] ?? '#888' }}
                      />
                      <span className="text-sm text-ink-secondary">
                        {symbol} {(allocations[symbol] ?? 0).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
                <span
                  className={clsx(
                    'text-sm font-medium',
                    isAllocationValid ? 'text-positive' : 'text-warning',
                  )}
                >
                  {totalPct.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Token allocation rows */}
            <div className="space-y-1">
              {Array.from(selectedTokens).map((symbol) => {
                const info = TOKEN_INFO[symbol];
                const pct = allocations[symbol] ?? 0;
                return (
                  <div
                    key={symbol}
                    className="flex items-center gap-4 rounded-lg px-4 py-3 bg-surface-card border border-surface-border"
                  >
                    <TokenIcon symbol={symbol} size={28} />
                    <div className="w-20 shrink-0">
                      <div className="text-base font-medium text-ink">{symbol}</div>
                      <div className="text-sm text-ink-muted">{info?.name}</div>
                    </div>
                    {weightMode === 'custom' ? (
                      <>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={0.5}
                          value={pct}
                          onChange={(e) =>
                            setAllocation(symbol, parseFloat(e.target.value))
                          }
                          className="flex-1"
                        />
                        <div className="w-16 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={pct === 0 ? '' : pct}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/^0+(?=\d)/, '');
                              const val = Math.min(100, Math.max(0, parseFloat(raw) || 0));
                              setAllocation(symbol, val);
                            }}
                            className="input-field w-full text-center text-base py-1.5"
                          />
                        </div>
                        <span className="text-base text-ink-muted w-4">%</span>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: ASSET_COLORS[symbol] ?? '#888',
                              }}
                            />
                          </div>
                        </div>
                        <span className="text-base font-medium text-ink w-16 text-right">
                          {pct.toFixed(1)}%
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Validation message for custom */}
            {weightMode === 'custom' && !isAllocationValid && (
              <div className="flex items-center gap-2 mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm text-amber-700">
                  {totalPct < 99.9
                    ? `Allocations total ${totalPct.toFixed(1)}% \u2014 ${(100 - totalPct).toFixed(1)}% remaining`
                    : `Allocations total ${totalPct.toFixed(1)}% \u2014 reduce by ${(totalPct - 100).toFixed(1)}%`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 4: Configure Rebalancing */}
        {/* ----------------------------------------------------------------- */}
        {step === 4 && (
          <div className="step-animate">
            <h3 className="text-xl font-semibold text-ink mb-1">
              Configure Rebalancing
            </h3>
            <p className="text-base text-ink-secondary mb-6">
              Set how and when your portfolio should rebalance
            </p>

            {/* Portfolio name */}
            <div className="mb-8">
              <label
                htmlFor="portfolio-name"
                className="block text-base font-medium text-ink mb-2"
              >
                Portfolio Name
                <span className="text-ink-muted font-normal ml-1">(optional)</span>
              </label>
              <input
                id="portfolio-name"
                type="text"
                value={portfolioName}
                onChange={(e) => setPortfolioName(e.target.value)}
                placeholder="e.g. My Growth Portfolio"
                className="input-field w-full max-w-sm"
              />
            </div>

            {/* Trigger mode */}
            <div>
              <label className="block text-base font-medium text-ink mb-3">
                Trigger Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => setTriggerSelection('Manual')}
                  className={clsx(
                    'rounded-xl border-2 p-4 text-left transition-all',
                    triggerSelection === 'Manual'
                      ? 'border-accent bg-accent-light'
                      : 'border-surface-border bg-surface-card hover:border-ink-faint',
                  )}
                >
                  <div className="text-base font-semibold text-ink mb-1">Manual</div>
                  <p className="text-base text-ink-muted leading-relaxed">
                    Rebalance only when you choose to trigger it manually.
                  </p>
                </button>

                <button
                  onClick={() => setTriggerSelection('DriftThreshold')}
                  className={clsx(
                    'rounded-xl border-2 p-4 text-left transition-all',
                    triggerSelection === 'DriftThreshold'
                      ? 'border-accent bg-accent-light'
                      : 'border-surface-border bg-surface-card hover:border-ink-faint',
                  )}
                >
                  <div className="text-base font-semibold text-ink mb-1">
                    Auto (Drift)
                  </div>
                  <p className="text-base text-ink-muted leading-relaxed">
                    Automatically rebalance when drift exceeds a threshold.
                  </p>
                </button>

                <button
                  onClick={() => setTriggerSelection('PriceCondition')}
                  className={clsx(
                    'rounded-xl border-2 p-4 text-left transition-all',
                    triggerSelection === 'PriceCondition'
                      ? 'border-accent bg-accent-light'
                      : 'border-surface-border bg-surface-card hover:border-ink-faint',
                  )}
                >
                  <div className="text-base font-semibold text-ink mb-1">
                    Price Condition
                  </div>
                  <p className="text-base text-ink-muted leading-relaxed">
                    Trigger based on price movements of a specific asset.
                  </p>
                </button>
              </div>

              {/* Drift threshold slider */}
              {triggerSelection === 'DriftThreshold' && (
                <div className="mt-5 p-4 bg-surface-card border border-surface-border rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-base text-ink font-medium">
                      Drift Threshold
                    </label>
                    <span className="text-base font-semibold text-accent">
                      {driftThreshold}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={driftThreshold}
                    onChange={(e) => setDriftThreshold(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-sm text-ink-muted">1% (tight)</span>
                    <span className="text-sm text-ink-muted">20% (loose)</span>
                  </div>
                  <p className="text-base text-ink-secondary mt-3">
                    When any asset drifts more than {driftThreshold}% from its target, a rebalance will trigger automatically.
                  </p>
                </div>
              )}

              {/* Price condition note */}
              {triggerSelection === 'PriceCondition' && (
                <div className="mt-5 p-4 bg-surface-card border border-surface-border rounded-xl">
                  <p className="text-base text-ink-secondary">
                    Price-based triggers can be configured after portfolio creation from the Dashboard.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* STEP 5: Review & Create */}
        {/* ----------------------------------------------------------------- */}
        {step === 5 && (
          <div className="step-animate">
            <h3 className="text-2xl font-semibold text-ink mb-1">
              Review & Create
            </h3>
            <p className="text-base text-ink-secondary mb-6">
              Confirm your portfolio configuration before creating
            </p>

            <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
              {/* Summary header */}
              <div className="px-5 py-4 border-b border-surface-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-ink">
                      {portfolioName || 'New Portfolio'}
                    </h4>
                    <p className="text-sm text-ink-muted mt-0.5">
                      {tokenCount} assets &middot;{' '}
                      {weightMode === 'equal' ? 'Equal weight' : 'Custom weight'} &middot;{' '}
                      {triggerSelection === 'Manual'
                        ? 'Manual rebalance'
                        : triggerSelection === 'DriftThreshold'
                          ? `Auto at ${driftThreshold}% drift`
                          : 'Price condition'}
                    </p>
                  </div>
                  {hasEdited && selectedTemplate && (
                    <button
                      onClick={handleResetToTemplate}
                      className="text-base text-accent hover:underline cursor-pointer"
                    >
                      Reset to Template
                    </button>
                  )}
                </div>
              </div>

              {/* Allocation bar */}
              <div className="px-5 py-4 border-b border-surface-border">
                <div className="h-4 rounded-full overflow-hidden flex bg-surface-muted">
                  {Array.from(selectedTokens).map((symbol) => {
                    const pct = allocations[symbol] ?? 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={symbol}
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: ASSET_COLORS[symbol] ?? '#888',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Token list (inline editable) */}
              <div className="px-5 py-2">
                {Array.from(selectedTokens).map((s) => {
                  const info = TOKEN_INFO[s];
                  const pct = customAllocations[s] || 0;
                  const isEditing = editingToken === s;

                  return (
                    <div
                      key={s}
                      className="flex items-center justify-between py-3 border-b border-surface-border last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <TokenIcon symbol={s} size={32} />
                        <div>
                          <p className="text-lg font-semibold text-ink">{s}</p>
                          <p className="text-base text-ink-secondary">{info?.name || s}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={pct === 0 ? '' : pct}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/^0+(?=\d)/, '');
                              handleAllocationEdit(s, parseFloat(raw) || 0);
                            }}
                            onBlur={() => setEditingToken(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setEditingToken(null);
                              if (e.key === 'Escape') {
                                setEditingToken(null);
                              }
                              if (e.key === 'Tab') {
                                e.preventDefault();
                                const tokens = Array.from(selectedTokens);
                                const idx = tokens.indexOf(s);
                                const next = tokens[(idx + 1) % tokens.length];
                                setEditingToken(next);
                              }
                            }}
                            autoFocus
                            className="w-24 text-right text-lg font-semibold text-ink border border-surface-border rounded-lg px-2 py-1 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingToken(s)}
                            className="flex items-center gap-2 hover:bg-surface-hover rounded-lg px-3 py-1 cursor-pointer transition-colors"
                          >
                            <span className="text-lg font-semibold text-ink">{pct.toFixed(1)}%</span>
                            <Pencil className="w-4 h-4 text-ink-muted hover:text-accent" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Total allocation validation */}
                <div className="flex items-center justify-between pt-3 border-t border-surface-border mt-2">
                  <span className="text-base font-medium text-ink">Total</span>
                  <span className={clsx('text-lg font-bold', isValidTotal ? 'text-positive' : 'text-negative')}>
                    {allocationTotal.toFixed(1)}%
                  </span>
                </div>
                {!isValidTotal && (
                  <p className="text-base text-negative mt-1">Allocations must total 100%</p>
                )}
              </div>

              {/* Config summary */}
              <div className="px-5 py-4 bg-surface-muted border-t border-surface-border">
                <div className="grid grid-cols-2 gap-4 text-base">
                  <div>
                    <span className="text-ink-muted block text-base mb-0.5">
                      Weight Mode
                    </span>
                    <span className="text-ink font-medium capitalize">
                      {weightMode}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base text-ink-secondary">Trigger</span>
                    {editingTrigger ? (
                      <div className="flex items-center gap-2">
                        <span className="text-base text-ink">Drift &gt;</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          step={1}
                          value={driftThreshold}
                          onChange={(e) => handleTriggerEdit(parseInt(e.target.value) || 5)}
                          onBlur={() => setEditingTrigger(false)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingTrigger(false);
                          }}
                          autoFocus
                          className="w-16 text-right text-lg font-semibold text-ink border border-surface-border rounded-lg px-2 py-1 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                        <span className="text-base text-ink">%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingTrigger(true)}
                        className="flex items-center gap-2 hover:bg-surface-hover rounded-lg px-3 py-1 cursor-pointer transition-colors"
                      >
                        <span className="text-lg font-semibold text-ink">
                          {triggerSelection === 'DriftThreshold' ? `Drift > ${driftThreshold}%` : triggerSelection === 'PriceCondition' ? 'Price Condition' : 'Manual'}
                        </span>
                        <Pencil className="w-4 h-4 text-ink-muted" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation footer */}
      <div className="flex items-center justify-between mt-10 pt-6 border-t border-surface-border">
        <button
          onClick={step === 0 ? () => navigate('/') : goBack}
          className="flex items-center gap-2 text-base text-ink-secondary hover:text-ink transition-colors font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {step === 0 ? (
          /* Step 0 has no "Continue" -- user picks template or clicks Build Custom above */
          <div />
        ) : step < 5 ? (
          <button
            onClick={goNext}
            disabled={!canProceed}
            className="btn-primary flex items-center gap-2"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={createPortfolio.isLoading || !isValidTotal}
            className={clsx(
              'btn-primary flex items-center gap-2 text-lg px-6 py-3',
              (!isValidTotal) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {createPortfolio.isLoading ? (
              <>Creating...</>
            ) : (
              <>
                Create Portfolio
                <Check className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </div>

      {createPortfolio.error && (
        <div className="mt-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-base text-red-700">{createPortfolio.error}</p>
        </div>
      )}
      </div>

      {/* Right side: Summary panel */}
      <div>
        <WizardSummary
          step={step}
          templateName={selectedTemplate?.name}
          selectedTokens={Array.from(selectedTokens)}
          allocations={allocations}
          weightMode={weightMode || 'equal'}
          triggerMode={triggerSelection === 'DriftThreshold' ? `Auto at ${driftThreshold}%` : triggerSelection === 'PriceCondition' ? 'Price Condition' : 'Manual'}
          portfolioName={portfolioName}
        />
      </div>
      </div>
    </div>
  );
}
