import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, X, Plus, Sparkles } from 'lucide-react';
import TokenLogo from '@/assets/TokenLogos';
import { ASSET_COLORS } from '@/config';

/* ------------------------------------------------------------------ */
/* Progress bar                                                        */
/* ------------------------------------------------------------------ */
function ProgressBar({ filled }: { filled: number }) {
  return (
    <div className="flex gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex-1 h-1.5 rounded-full"
          style={{
            backgroundColor: i < filled ? undefined : '#D6D9E3',
            background: i < filled ? 'linear-gradient(90deg, #059669, #10B981)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Token metadata                                                      */
/* ------------------------------------------------------------------ */
const ALL_TOKENS: { symbol: string; name: string; subtitle: string }[] = [
  { symbol: 'CC', name: 'Canton Coin', subtitle: 'Platform Token' },
  { symbol: 'USDCx', name: 'USD Coin', subtitle: 'Stablecoin' },
  { symbol: 'CBTC', name: 'Canton BTC', subtitle: 'Wrapped Bitcoin' },
  { symbol: 'ETHx', name: 'Canton ETH', subtitle: 'Wrapped Ethereum' },
  { symbol: 'SOLx', name: 'Canton SOL', subtitle: 'Wrapped Solana' },
  { symbol: 'XAUt', name: 'Tokenized Gold', subtitle: 'Real World Asset' },
  { symbol: 'XAGt', name: 'Tokenized Silver', subtitle: 'Real World Asset' },
  { symbol: 'USTb', name: 'US Treasury', subtitle: 'Bond Token' },
  { symbol: 'MMF', name: 'Money Market', subtitle: 'Yield Fund' },
];

const TOKEN_MAP = Object.fromEntries(ALL_TOKENS.map((t) => [t.symbol, t]));

const TOKEN_ACCENT: Record<string, string> = {
  CC: '#059669',
  USDCx: '#2563EB',
  CBTC: '#F59E0B',
  ETHx: '#8B5CF6',
  SOLx: '#14F195',
  XAUt: '#D97706',
  XAGt: '#A8A9AD',
  USTb: '#1E40AF',
  MMF: '#0EA5E9',
};

const DEFAULT_ALLOCATIONS: { symbol: string; pct: number }[] = [
  { symbol: 'CBTC', pct: 35 },
  { symbol: 'ETHx', pct: 25 },
  { symbol: 'CC', pct: 20 },
  { symbol: 'XAUt', pct: 15 },
  { symbol: 'USDCx', pct: 5 },
];

/* ------------------------------------------------------------------ */
/* Colored Slider                                                      */
/* ------------------------------------------------------------------ */
function ColoredSlider({
  value,
  color,
  onChange,
}: {
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const calcValue = useCallback((clientX: number) => {
    if (!trackRef.current) return value;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    return pct;
  }, [value]);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(calcValue(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onChange(calcValue(e.clientX));
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={trackRef}
      className="relative h-[10px] rounded-full cursor-pointer flex-1"
      style={{ backgroundColor: '#E5E7EB' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Filled track */}
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75"
        style={{ width: `${value}%`, backgroundColor: color }}
      />
      {/* Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-white border-[2.5px] shadow-md transition-[left] duration-75"
        style={{ left: `calc(${value}% - 9px)`, borderColor: color }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editable Percentage Input                                           */
/* ------------------------------------------------------------------ */
function PctInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const num = parseInt(draft, 10);
    if (!isNaN(num)) onChange(Math.max(0, Math.min(100, num)));
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-[56px] h-[38px] flex items-center justify-center border border-[#D6D9E3] rounded-lg bg-white text-[15px] font-bold text-[#111827] shrink-0 hover:border-[#059669] transition-colors cursor-text"
      >
        {value}%
      </button>
    );
  }

  return (
    <div className="relative w-[56px] h-[38px] shrink-0">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        className="w-full h-full text-center border-2 border-[#059669] rounded-lg bg-white text-[15px] font-bold text-[#111827] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive Donut chart with hover                                   */
/* ------------------------------------------------------------------ */
function DonutChart({
  allocations,
  hoveredToken,
  onHover,
}: {
  allocations: { symbol: string; pct: number }[];
  hoveredToken: string | null;
  onHover: (symbol: string | null) => void;
}) {
  // Build SVG arcs for each segment
  const segments = useMemo(() => {
    const total = allocations.reduce((s, a) => s + a.pct, 0);
    if (total === 0) return [];
    let cursor = 0;
    return allocations.map((a) => {
      const startAngle = (cursor / total) * 360 - 90;
      cursor += a.pct;
      const endAngle = (cursor / total) * 360 - 90;
      return { ...a, startAngle, endAngle, color: TOKEN_ACCENT[a.symbol] || '#6B7280' };
    });
  }, [allocations]);

  const cx = 100, cy = 100, r = 85, innerR = 55;

  function arcPath(startDeg: number, endDeg: number, outerR: number, innerRad: number) {
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = (endDeg * Math.PI) / 180;
    const x1 = cx + outerR * Math.cos(startRad);
    const y1 = cy + outerR * Math.sin(startRad);
    const x2 = cx + outerR * Math.cos(endRad);
    const y2 = cy + outerR * Math.sin(endRad);
    const x3 = cx + innerRad * Math.cos(endRad);
    const y3 = cy + innerRad * Math.sin(endRad);
    const x4 = cx + innerRad * Math.cos(startRad);
    const y4 = cy + innerRad * Math.sin(startRad);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerRad},${innerRad} 0 ${largeArc} 0 ${x4},${y4} Z`;
  }

  return (
    <div className="relative w-[200px] h-[200px] mx-auto">
      <svg viewBox="0 0 200 200" width="200" height="200">
        {segments.map((seg) => {
          const isHovered = hoveredToken === seg.symbol;
          const scale = isHovered ? 1.06 : 1;
          return (
            <path
              key={seg.symbol}
              d={arcPath(seg.startAngle, seg.endAngle, r, innerR)}
              fill={seg.color}
              opacity={hoveredToken && !isHovered ? 0.4 : 1}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: '100px 100px',
                transition: 'transform 0.2s, opacity 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={() => onHover(seg.symbol)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
      </svg>
      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {hoveredToken ? (
          <div className="text-center">
            <span className="text-[22px] font-bold text-[#111827]">
              {allocations.find((a) => a.symbol === hoveredToken)?.pct}%
            </span>
            <p className="text-[11px] text-[#6B7280] -mt-0.5">{hoveredToken}</p>
          </div>
        ) : (
          <div className="text-center">
            <span className="text-[28px] font-bold text-[#111827]">{allocations.length}</span>
            <p className="text-[12px] text-[#6B7280] -mt-0.5">Tokens</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Balance to 100% utility                                             */
/* ------------------------------------------------------------------ */
function balanceTo100(allocs: { symbol: string; pct: number }[]): { symbol: string; pct: number }[] {
  if (allocs.length === 0) return allocs;
  const total = allocs.reduce((s, a) => s + a.pct, 0);
  if (total === 100) return allocs;
  if (total === 0) {
    // Equal distribution
    const each = Math.floor(100 / allocs.length);
    const remainder = 100 - each * allocs.length;
    return allocs.map((a, i) => ({ ...a, pct: each + (i === 0 ? remainder : 0) }));
  }
  // Proportional scaling
  const factor = 100 / total;
  const scaled = allocs.map((a) => ({ ...a, pct: Math.round(a.pct * factor) }));
  // Fix rounding error — add/subtract from largest
  const newTotal = scaled.reduce((s, a) => s + a.pct, 0);
  const diff = 100 - newTotal;
  if (diff !== 0) {
    const idx = scaled.reduce((maxI, a, i, arr) => (a.pct > arr[maxI].pct ? i : maxI), 0);
    scaled[idx].pct += diff;
  }
  return scaled;
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */
export default function BuildYourOwn() {
  const navigate = useNavigate();
  const location = useLocation();

  const routeState = location.state as {
    allocations?: { symbol: string; pct: number }[];
    templateName?: string;
  } | null;

  const [allocations, setAllocations] = useState<{ symbol: string; pct: number }[]>(
    routeState?.allocations ?? DEFAULT_ALLOCATIONS,
  );
  const [driftThreshold, setDriftThreshold] = useState(5);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);

  useEffect(() => {
    if (routeState?.allocations) setAllocations(routeState.allocations);
  }, [routeState]);

  const totalPct = useMemo(() => allocations.reduce((s, a) => s + a.pct, 0), [allocations]);
  const isValid = totalPct === 100 && allocations.length >= 2;
  const availableTokens = ALL_TOKENS.filter((t) => !allocations.some((a) => a.symbol === t.symbol));

  const updatePct = (symbol: string, pct: number) => {
    setAllocations((prev) => prev.map((a) => (a.symbol === symbol ? { ...a, pct } : a)));
  };
  const removeToken = (symbol: string) => {
    setAllocations((prev) => prev.filter((a) => a.symbol !== symbol));
  };
  const addToken = (symbol: string) => {
    setAllocations((prev) => [...prev, { symbol, pct: 0 }]);
    setShowAddMenu(false);
  };
  const handleBalance = () => {
    setAllocations((prev) => balanceTo100(prev));
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="mb-5">
        <p className="text-[14px] font-semibold text-[#059669] mb-1">Step 2 of 5</p>
        <h1 className="text-[30px] font-bold text-[#111827] leading-tight">
          Configure Your Portfolio
        </h1>
        <p className="text-[15px] text-[#6B7280] mt-1">
          {routeState?.templateName
            ? `Starting from "${routeState.templateName}" template. Adjust allocations to your preference.`
            : 'Set token weights and drift threshold for automatic rebalancing.'}
        </p>
      </div>

      <ProgressBar filled={2} />

      {/* Two-column layout */}
      <div className="flex gap-6 mt-6 flex-1 min-h-0">
        {/* LEFT column */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Token Allocations card */}
          <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-6 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[20px] font-bold text-[#111827]">Token Allocations</h2>
              <div className="flex items-center gap-3">
                {/* Balance button */}
                {totalPct !== 100 && allocations.length > 0 && (
                  <button
                    type="button"
                    onClick={handleBalance}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-gradient-to-r from-[#059669] to-[#10B981] text-white hover:opacity-90 transition-opacity shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Balance to 100%
                  </button>
                )}
                <span
                  className={`text-[15px] font-bold ${
                    totalPct === 100 ? 'text-[#059669]' : 'text-[#DC2626]'
                  }`}
                >
                  Total: {totalPct}%
                </span>
              </div>
            </div>

            {/* Token rows */}
            <div className="space-y-5">
              {allocations.map((a) => {
                const info = TOKEN_MAP[a.symbol];
                const accent = TOKEN_ACCENT[a.symbol] || '#6B7280';
                return (
                  <div key={a.symbol} className="flex items-center gap-4">
                    <TokenLogo symbol={a.symbol} size={36} showBadge={false} />
                    <div className="w-[80px] shrink-0">
                      <p className="text-[15px] font-semibold text-[#111827] leading-tight">
                        {a.symbol}
                      </p>
                    </div>

                    <ColoredSlider
                      value={a.pct}
                      color={accent}
                      onChange={(v) => updatePct(a.symbol, v)}
                    />

                    <PctInput value={a.pct} onChange={(v) => updatePct(a.symbol, v)} />

                    <button
                      type="button"
                      onClick={() => removeToken(a.symbol)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#FEE2E2] transition-colors shrink-0"
                    >
                      <X className="w-4 h-4 text-[#9CA3AF] hover:text-[#EF4444]" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add Token */}
            {availableTokens.length > 0 && (
              <div className="relative mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddMenu((v) => !v)}
                  className="w-full border-2 border-dashed border-[#D6D9E3] rounded-xl py-3 text-[14px] font-semibold text-[#6B7280]
                             hover:border-[#059669] hover:text-[#059669] transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Token
                </button>
                {showAddMenu && (
                  <div className="absolute left-0 right-0 mt-2 bg-white border border-[#D6D9E3] rounded-xl shadow-lg z-10 max-h-[240px] overflow-y-auto">
                    {availableTokens.map((t) => (
                      <button
                        key={t.symbol}
                        type="button"
                        onClick={() => addToken(t.symbol)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F3F4F9] transition-colors text-left"
                      >
                        <TokenLogo symbol={t.symbol} size={28} showBadge={false} />
                        <div>
                          <p className="text-[14px] font-medium text-[#111827]">{t.name}</p>
                          <p className="text-[11px] text-[#9CA3AF]">{t.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drift Threshold */}
          <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[18px] font-bold text-[#111827]">Drift Threshold</h2>
              <span className="px-3 py-1 rounded-full bg-[#E0F5EA] text-[#059669] text-[14px] font-semibold">
                {driftThreshold.toFixed(1)}%
              </span>
            </div>
            <p className="text-[13px] text-[#6B7280] mb-4">
              Rebalancing triggers when any token drifts beyond this threshold from its target.
            </p>
            <ColoredSlider
              value={Math.round(((driftThreshold - 1) / 19) * 100)}
              color="#059669"
              onChange={(v) => setDriftThreshold(Math.round((1 + (v / 100) * 19) * 2) / 2)}
            />
            <div className="flex justify-between text-[12px] text-[#9CA3AF] mt-2">
              <span>1%</span>
              <span>20%</span>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3 pt-1">
            <Link
              to={routeState?.templateName ? '/create/templates' : '/create'}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-[14px]
                         border border-[#D6D9E3] text-[#111827] hover:bg-[#ECEEF4] transition-colors"
            >
              Back
            </Link>
            <button
              type="button"
              disabled={!isValid}
              onClick={() => navigate('/create', { state: { allocations, driftThreshold, fromBuild: true } })}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-xl text-white font-semibold text-[14px]
                         bg-gradient-to-br from-[#059669] to-[#10B981] hover:opacity-90 transition-opacity
                         disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Continue
            </button>
            {!isValid && (
              <span className="text-[13px] text-[#DC2626]">
                {totalPct !== 100
                  ? `Allocations must total 100% (currently ${totalPct}%)`
                  : 'Add at least 2 tokens'}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT column — Portfolio Preview */}
        <div className="w-[360px] shrink-0">
          <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-6 sticky top-8">
            <h2 className="text-[20px] font-bold text-[#111827] mb-5">Portfolio Preview</h2>

            <DonutChart allocations={allocations} hoveredToken={hoveredToken} onHover={setHoveredToken} />

            <div className="mt-6 space-y-3">
              {allocations.map((a) => (
                <div
                  key={a.symbol}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
                  style={{ backgroundColor: hoveredToken === a.symbol ? '#E8EBF2' : 'transparent' }}
                  onMouseEnter={() => setHoveredToken(a.symbol)}
                  onMouseLeave={() => setHoveredToken(null)}
                >
                  <TokenLogo symbol={a.symbol} size={22} showBadge={false} />
                  <span
                    className="text-[14px] flex-1 transition-colors"
                    style={{ color: hoveredToken === a.symbol ? TOKEN_ACCENT[a.symbol] || '#111827' : '#111827' }}
                  >
                    {a.symbol} <span className="text-[#9CA3AF] font-normal">{TOKEN_MAP[a.symbol]?.name || ''}</span>
                  </span>
                  <span
                    className="text-[14px] font-bold transition-colors"
                    style={{ color: hoveredToken === a.symbol ? TOKEN_ACCENT[a.symbol] || '#111827' : '#111827' }}
                  >
                    {a.pct}%
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-[#D6D9E3] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-[#6B7280]">Drift Threshold</span>
                <span className="text-[14px] font-semibold text-[#059669]">
                  {driftThreshold.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-[#6B7280]">Auto-Rebalance</span>
                <span className="px-2.5 py-0.5 rounded-full bg-[#E0F5EA] text-[#059669] text-[12px] font-semibold">
                  Enabled
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
