export const config = {
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
};

/** Asset color map for consistent chart / UI coloring */
export const ASSET_COLORS: Record<string, string> = {
  CC: '#3B82F6',
  USDCx: '#10B981',
  CBTC: '#F59E0B',
  ETHx: '#8B5CF6',  // purple
  SOLx: '#14F195',  // solana green
  XAUt: '#D4A017',  // gold
  XAGt: '#A8A9AD',  // silver
  USTb: '#1E40AF',  // navy (bonds)
  MMF: '#0EA5E9',   // sky blue — money market fund
};

/** Tier thresholds matching Daml getTier function */
export const TIER_THRESHOLDS = {
  Bronze: { min: 0, max: 50 },
  Silver: { min: 51, max: 200 },
  Gold: { min: 201, max: 500 },
  Platinum: { min: 501, max: Infinity },
} as const;

/** Shared list of available assets across the UI */
export const AVAILABLE_ASSETS: { symbol: string; admin: string }[] = [
  { symbol: 'CC', admin: 'Canton::Admin' },
  { symbol: 'USDCx', admin: 'Canton::Admin' },
  { symbol: 'CBTC', admin: 'Canton::Admin' },
  { symbol: 'ETHx', admin: 'Canton::Admin' },
  { symbol: 'SOLx', admin: 'Canton::Admin' },
  { symbol: 'XAUt', admin: 'Canton::Admin' },  // Tokenized Gold
  { symbol: 'XAGt', admin: 'Canton::Admin' },  // Tokenized Silver
  { symbol: 'USTb', admin: 'Canton::Admin' },  // US Treasury Bonds
  { symbol: 'MMF', admin: 'Canton::Admin' },   // Money Market Fund
];

/** Pre-built portfolio templates */
export const PORTFOLIO_TEMPLATES = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Heavy stablecoin allocation with bond exposure for stability',
    riskLevel: 'low' as const,
    targets: [
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 40 },
      { asset: { symbol: 'USTb', admin: 'Canton::Admin' }, targetPct: 30 },
      { asset: { symbol: 'XAUt', admin: 'Canton::Admin' }, targetPct: 20 },
      { asset: { symbol: 'CC', admin: 'Canton::Admin' }, targetPct: 10 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 3.0 },
  },
  {
    id: 'balanced',
    name: 'Balanced Growth',
    description: 'Mix of crypto, stablecoins, and real-world assets',
    riskLevel: 'medium' as const,
    targets: [
      { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 25 },
      { asset: { symbol: 'ETHx', admin: 'Canton::Admin' }, targetPct: 20 },
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 25 },
      { asset: { symbol: 'XAUt', admin: 'Canton::Admin' }, targetPct: 15 },
      { asset: { symbol: 'CC', admin: 'Canton::Admin' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 5.0 },
  },
  {
    id: 'btc-eth-maxi',
    name: 'BTC-ETH Maxi',
    description: 'Heavy crypto allocation focused on Bitcoin and Ethereum',
    riskLevel: 'high' as const,
    targets: [
      { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 50 },
      { asset: { symbol: 'ETHx', admin: 'Canton::Admin' }, targetPct: 30 },
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 20 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 7.0 },
  },
  {
    id: 'crypto-basket',
    name: 'Crypto Basket',
    description: 'Diversified across all major crypto assets with stablecoin base',
    riskLevel: 'high' as const,
    targets: [
      { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 30 },
      { asset: { symbol: 'ETHx', admin: 'Canton::Admin' }, targetPct: 25 },
      { asset: { symbol: 'SOLx', admin: 'Canton::Admin' }, targetPct: 15 },
      { asset: { symbol: 'CC', admin: 'Canton::Admin' }, targetPct: 15 },
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 5.0 },
  },
  {
    id: 'precious-metals',
    name: 'Precious Metals',
    description: 'Pure gold and silver allocation — classic safe haven',
    riskLevel: 'low' as const,
    targets: [
      { asset: { symbol: 'XAUt', admin: 'Canton::Admin' }, targetPct: 60 },
      { asset: { symbol: 'XAGt', admin: 'Canton::Admin' }, targetPct: 40 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 3.0 },
  },
  {
    id: 'institutional',
    name: 'Institutional Grade',
    description: 'Treasury bonds core with gold hedge and crypto satellite',
    riskLevel: 'medium' as const,
    targets: [
      { asset: { symbol: 'USTb', admin: 'Canton::Admin' }, targetPct: 40 },
      { asset: { symbol: 'XAUt', admin: 'Canton::Admin' }, targetPct: 25 },
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 20 },
      { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 4.0 },
  },
  {
    id: 'stablecoin-yield',
    name: 'Stablecoin Yield',
    description: 'Capital preservation with CC exposure for platform rewards',
    riskLevel: 'low' as const,
    targets: [
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 70 },
      { asset: { symbol: 'CC', admin: 'Canton::Admin' }, targetPct: 30 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 2.0 },
  },
  {
    id: 'all-weather',
    name: 'All Weather',
    description: 'Ray Dalio inspired — performs in any market condition',
    riskLevel: 'medium' as const,
    targets: [
      { asset: { symbol: 'USTb', admin: 'Canton::Admin' }, targetPct: 30 },
      { asset: { symbol: 'XAUt', admin: 'Canton::Admin' }, targetPct: 20 },
      { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 20 },
      { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 15 },
      { asset: { symbol: 'ETHx', admin: 'Canton::Admin' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: 5.0 },
  },
];

/** Fee rebate percentages matching Daml getFeeRebatePct */
export const FEE_REBATE_PCT: Record<string, number> = {
  Bronze: 0.5,
  Silver: 1.0,
  Gold: 2.0,
  Platinum: 3.0,
};
