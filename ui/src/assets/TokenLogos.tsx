import React from 'react';

/**
 * Local token logo paths from /public/tokens/.
 */
const TOKEN_LOGO_URLS: Record<string, string> = {
  CC: '/tokens/cc.png',
  USDCx: '/tokens/usdcx.png',
  CBTC: '/tokens/cbtc.png',
  ETHx: '/tokens/ethx.png',
  SOLx: '/tokens/solx.png',
  XAUt: '/tokens/xaut.png',
  XAGt: '/tokens/xagt.png',
  USTb: '/tokens/ustb.png',
  MMF: '/tokens/usdcx.png',
};

// Fallback colors and labels for tokens without logos
const FALLBACK_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  CC: { bg: '#2563EB', text: '#fff', label: 'CC' },
  USDCx: { bg: '#2775CA', text: '#fff', label: '$' },
  CBTC: { bg: '#F7931A', text: '#fff', label: '\u20BF' },
  ETHx: { bg: '#627EEA', text: '#fff', label: '\u039E' },
  SOLx: { bg: '#9945FF', text: '#fff', label: 'S' },
  XAUt: { bg: '#D4A017', text: '#fff', label: 'Au' },
  XAGt: { bg: '#A8A9AD', text: '#fff', label: 'Ag' },
  USTb: { bg: '#1E40AF', text: '#fff', label: 'T' },
  MMF: { bg: '#0EA5E9', text: '#fff', label: 'M' },
};

// Canton badge for wrapped tokens
export function CantonBadge({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="7" fill="#2563EB" />
      <circle cx="7" cy="7" r="6" fill="#2563EB" stroke="#fff" strokeWidth="1" />
      <text x="7" y="10" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="bold" fontFamily="Arial">C</text>
    </svg>
  );
}

export const WRAPPED_TOKENS = new Set(['CBTC', 'ETHx', 'SOLx', 'USDCx']);

interface TokenLogoProps {
  symbol: string;
  size?: number;
  className?: string;
  showBadge?: boolean;
}

export default function TokenLogo({ symbol, size = 36, className, showBadge = true }: TokenLogoProps) {
  const logoUrl = TOKEN_LOGO_URLS[symbol];
  const fallback = FALLBACK_STYLES[symbol] || { bg: '#6B7280', text: '#fff', label: symbol.charAt(0) };
  const [imgError, setImgError] = React.useState(false);

  const renderFallback = () => (
    <div
      style={{ width: size, height: size, backgroundColor: fallback.bg, color: fallback.text, fontSize: size * 0.35 }}
      className="rounded-full flex items-center justify-center font-bold shrink-0"
    >
      {fallback.label}
    </div>
  );

  return (
    <div className={`relative shrink-0 ${className || ''}`} style={{ width: size, height: size }}>
      {logoUrl && !imgError ? (
        <img
          src={logoUrl}
          alt={symbol}
          width={size}
          height={size}
          className="rounded-full ring-1 ring-surface-border object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        renderFallback()
      )}
      {showBadge && WRAPPED_TOKENS.has(symbol) && (
        <div className="absolute -bottom-0.5 -right-0.5">
          <CantonBadge size={Math.max(12, size * 0.35)} />
        </div>
      )}
    </div>
  );
}
