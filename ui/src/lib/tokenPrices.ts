/**
 * Canton Network Explorer URLs.
 *
 * Canton has multiple explorers:
 * - CC Explorer (ccexplorer.io) — real-time CC tracking by Proof Group
 * - CantonScan (cantonscan.com) — general-purpose explorer
 * - Canton Scan API (scan.sv-1.*.sync.global) — programmatic API
 * - Canton Analytics (canton.thetie.io) — analytics by The Tie
 *
 * Canton tokens don't have EVM-style contract addresses.
 * They're identified by Daml template ID + instrument ID + admin party.
 */
const CANTON_EXPLORERS: Record<string, { scan: string; ccExplorer: string; analytics: string }> = {
  localnet: {
    scan: 'http://scan.localhost:4000',
    ccExplorer: 'https://ccexplorer.io',
    analytics: 'https://canton.thetie.io',
  },
  devnet: {
    scan: 'https://scan.sv-1.devnet.sync.global',
    ccExplorer: 'https://ccexplorer.io',
    analytics: 'https://canton.thetie.io',
  },
  testnet: {
    scan: 'https://scan.sv-1.testnet.sync.global',
    ccExplorer: 'https://ccexplorer.io',
    analytics: 'https://canton.thetie.io',
  },
  mainnet: {
    scan: 'https://scan.sv-1.sync.global',
    ccExplorer: 'https://ccexplorer.io',
    analytics: 'https://canton.thetie.io',
  },
};

/** CIP-0056 instrument identifiers on Canton Network */
const TOKEN_INSTRUMENT_IDS: Record<string, string> = {
  CC: 'splice-api-token-holding-v1:CC',
  USDCx: 'splice-api-token-holding-v1:USDCx',
  CBTC: 'splice-api-token-holding-v1:CBTC',
  ETHx: 'splice-api-token-holding-v1:ETHx',
  SOLx: 'splice-api-token-holding-v1:SOLx',
  XAUt: 'splice-api-token-holding-v1:XAUt',
  XAGt: 'splice-api-token-holding-v1:XAGt',
  USTb: 'splice-api-token-holding-v1:USTb',
  MMF: 'splice-api-token-holding-v1:MMF',
};

/** Get the Canton Scan API base URL for the current network */
export function getCantonScanUrl(): string {
  const network = import.meta.env.VITE_CANTON_NETWORK || 'devnet';
  return CANTON_EXPLORERS[network]?.scan || CANTON_EXPLORERS.devnet.scan;
}

/** Get the CC Explorer URL (real-time Canton Coin explorer by Proof Group) */
export function getCCExplorerUrl(): string {
  return 'https://ccexplorer.io';
}

/** Get the Canton Analytics URL (by The Tie) */
export function getAnalyticsUrl(): string {
  return 'https://canton.thetie.io';
}

/** Get the best explorer link for a specific token */
export function getTokenExplorerUrl(symbol: string): string {
  if (symbol === 'CC') {
    // CC has its own dedicated explorer
    return 'https://ccexplorer.io';
  }
  // For other tokens, link to Canton Scan with the instrument context
  const scanBase = getCantonScanUrl();
  // Canton Scan API uses /v0/holdings/summary for holdings data
  // The UI explorer (cantonscan.com) may have token pages
  return `https://www.cantonscan.com`;
}

/** Get the CIP-0056 instrument ID for display */
export function getInstrumentId(symbol: string): string {
  return TOKEN_INSTRUMENT_IDS[symbol] || `splice-api-token-holding-v1:${symbol}`;
}

export const TOKEN_MARKET_DATA: Record<string, { price: number; change24h: number; marketCap: string; standard: string }> = {
  CC: { price: 1.00, change24h: 2.4, marketCap: '500M', standard: 'CIP-0056 · Native' },
  USDCx: { price: 1.00, change24h: 0.01, marketCap: '32B', standard: 'CIP-0056 · Stablecoin' },
  CBTC: { price: 73281, change24h: -1.2, marketCap: '1.4T', standard: 'CIP-0056 · Wrapped' },
  ETHx: { price: 2283, change24h: 3.1, marketCap: '274B', standard: 'CIP-0056 · Wrapped' },
  SOLx: { price: 142, change24h: 5.7, marketCap: '62B', standard: 'CIP-0056 · Wrapped' },
  XAUt: { price: 2650, change24h: 0.3, marketCap: '1.2B', standard: 'CIP-0056 · RWA' },
  XAGt: { price: 31.2, change24h: -0.5, marketCap: '180M', standard: 'CIP-0056 · RWA' },
  USTb: { price: 100.5, change24h: 0.02, marketCap: '8B', standard: 'CIP-0056 · RWA' },
  MMF: { price: 1.00, change24h: 0.0, marketCap: '2.5B', standard: 'CIP-0056 · RWA' },
};
