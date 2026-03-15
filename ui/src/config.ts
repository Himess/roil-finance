export const config = {
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
  ledgerUrl: import.meta.env.VITE_LEDGER_URL || 'http://localhost:7575',
};

/** Asset color map for consistent chart / UI coloring */
export const ASSET_COLORS: Record<string, string> = {
  CC: '#3B82F6',
  USDCx: '#10B981',
  CBTC: '#F59E0B',
  ETHx: '#8B5CF6',
  SOLx: '#EC4899',
};

/** Tier thresholds matching Daml getTier function */
export const TIER_THRESHOLDS = {
  Bronze: { min: 0, max: 50 },
  Silver: { min: 51, max: 200 },
  Gold: { min: 201, max: 500 },
  Platinum: { min: 501, max: Infinity },
} as const;

/** Fee rebate percentages matching Daml getFeeRebatePct */
export const FEE_REBATE_PCT: Record<string, number> = {
  Bronze: 0.5,
  Silver: 1.0,
  Gold: 2.0,
  Platinum: 3.0,
};
