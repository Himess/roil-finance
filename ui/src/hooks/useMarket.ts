import { useMemo } from 'react';
import { useQuery } from './useApi';
import type { MarketPrice, Pool } from '@/types';

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_PRICES: MarketPrice[] = [
  { symbol: 'CC', priceUsd: 1.0, change24h: 0.0 },
  { symbol: 'USDCx', priceUsd: 1.0, change24h: 0.01 },
  { symbol: 'CBTC', priceUsd: 42150.0, change24h: 2.34 },
  { symbol: 'ETHx', priceUsd: 2580.0, change24h: -1.12 },
];

const DEMO_POOLS: Pool[] = [
  {
    id: 'pool-cc-usdcx',
    assetA: { symbol: 'CC', admin: 'Canton::Admin' },
    assetB: { symbol: 'USDCx', admin: 'Canton::Admin' },
    reserveA: 500000,
    reserveB: 500000,
    feePct: 0.3,
  },
  {
    id: 'pool-cc-cbtc',
    assetA: { symbol: 'CC', admin: 'Canton::Admin' },
    assetB: { symbol: 'CBTC', admin: 'Canton::Admin' },
    reserveA: 1000000,
    reserveB: 23.75,
    feePct: 0.3,
  },
  {
    id: 'pool-usdcx-cbtc',
    assetA: { symbol: 'USDCx', admin: 'Canton::Admin' },
    assetB: { symbol: 'CBTC', admin: 'Canton::Admin' },
    reserveA: 800000,
    reserveB: 19.0,
    feePct: 0.3,
  },
];

// ---------------------------------------------------------------------------
// Backend response shapes (the envelope data payload)
// ---------------------------------------------------------------------------

interface PricesResponse {
  prices: MarketPrice[];
  timestamp: string;
  source: string;
}

interface PoolsResponse {
  pools: Pool[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch market prices.
 * GET /api/market/prices -> { prices, timestamp, source }
 */
export function useMarketPrices() {
  const query = useQuery<PricesResponse>('/api/market/prices');

  const prices = Array.isArray(query.data?.prices) ? query.data.prices : DEMO_PRICES;

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    if (Array.isArray(prices)) {
      for (const p of prices) {
        m.set(p.symbol, p.priceUsd);
      }
    }
    return m;
  }, [prices]);

  return {
    prices,
    priceMap,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isFromBackend: query.isFromBackend,
  };
}

/**
 * Fetch liquidity pools.
 * GET /api/market/pools -> { pools, timestamp }
 */
export function usePools() {
  const query = useQuery<PoolsResponse>('/api/market/pools');

  const pools = query.data?.pools ?? DEMO_POOLS;
  return {
    pools,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isFromBackend: query.isFromBackend,
  };
}
