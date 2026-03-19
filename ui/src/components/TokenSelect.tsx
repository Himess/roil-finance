import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import TokenIcon from './TokenIcon';

const TOKEN_NAMES: Record<string, string> = {
  CC: 'Canton Coin',
  USDCx: 'USD Coin',
  CBTC: 'Canton BTC',
  ETHx: 'Canton ETH',
  SOLx: 'Canton SOL',
  XAUt: 'Tokenized Gold',
  XAGt: 'Tokenized Silver',
  USTb: 'US Treasury Bond',
  MMF: 'Money Market Fund',
};

interface TokenOption {
  symbol: string;
}

interface TokenSelectProps {
  value: string;
  onChange: (symbol: string) => void;
  tokens: TokenOption[];
  excludeSymbol?: string;
  label?: string;
  className?: string;
}

export default function TokenSelect({ value, onChange, tokens, excludeSymbol, label, className }: TokenSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filteredTokens = excludeSymbol
    ? tokens.filter(t => t.symbol !== excludeSymbol)
    : tokens;

  return (
    <div className={clsx('relative', className)} ref={ref}>
      {label && (
        <label className="block text-sm text-ink-muted mb-1.5">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 border border-surface-border rounded-xl px-4 py-3 bg-white w-full text-left hover:border-ink-faint transition-colors"
      >
        <TokenIcon symbol={value} size={24} showBadge={false} />
        <span className="text-lg font-semibold text-ink">{value}</span>
        <span className="text-base text-ink-muted hidden sm:inline">{TOKEN_NAMES[value] || ''}</span>
        <ChevronDown className={clsx('ml-auto w-5 h-5 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-border rounded-xl shadow-lg z-50 max-h-[300px] overflow-y-auto">
          {filteredTokens.map(t => (
            <button
              key={t.symbol}
              type="button"
              onClick={() => { onChange(t.symbol); setOpen(false); }}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-surface-hover cursor-pointer transition-colors',
                t.symbol === value && 'bg-accent-light',
              )}
            >
              <TokenIcon symbol={t.symbol} size={28} showBadge={false} />
              <div>
                <span className="text-lg font-semibold text-ink">{t.symbol}</span>
                <span className="text-base text-ink-muted ml-2">{TOKEN_NAMES[t.symbol] || ''}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
