import { useMemo } from 'react';
import { useQuery, useMutation } from './useApi';
import type {
  Portfolio,
  TargetAllocation,
  TriggerMode,
  RebalanceLog,
  ActivityEntry,
} from '@/types';

// ---------------------------------------------------------------------------
// Demo data — used when the backend is not yet connected
// ---------------------------------------------------------------------------

const DEMO_PORTFOLIO: Portfolio = {
  platform: 'Canton::Platform',
  user: 'Canton::Alice',
  targets: [
    { asset: { symbol: 'CC', admin: 'Canton::Admin' }, targetPct: 50 },
    { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, targetPct: 30 },
    { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, targetPct: 20 },
  ],
  holdings: [
    { asset: { symbol: 'CC', admin: 'Canton::Admin' }, amount: 5200, valueCc: 5200 },
    { asset: { symbol: 'USDCx', admin: 'Canton::Admin' }, amount: 2800, valueCc: 2800 },
    { asset: { symbol: 'CBTC', admin: 'Canton::Admin' }, amount: 2000, valueCc: 2000 },
  ],
  triggerMode: { tag: 'DriftThreshold', value: 5 },
  totalRebalances: 14,
  isActive: true,
};

const DEMO_LOGS: RebalanceLog[] = [
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    swapLegs: [
      {
        fromAsset: { symbol: 'CC', admin: 'Canton::Admin' },
        toAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
        fromAmount: 320,
        toAmount: 320,
      },
    ],
    driftBefore: 6.4,
    timestamp: '2026-03-15T10:30:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    swapLegs: [
      {
        fromAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
        toAsset: { symbol: 'CC', admin: 'Canton::Admin' },
        fromAmount: 0.012,
        toAmount: 450,
      },
      {
        fromAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
        toAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
        fromAmount: 150,
        toAmount: 0.004,
      },
    ],
    driftBefore: 7.1,
    timestamp: '2026-03-13T14:15:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    swapLegs: [
      {
        fromAsset: { symbol: 'CC', admin: 'Canton::Admin' },
        toAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
        fromAmount: 200,
        toAmount: 0.005,
      },
    ],
    driftBefore: 5.3,
    timestamp: '2026-03-10T09:45:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    swapLegs: [
      {
        fromAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
        toAsset: { symbol: 'CC', admin: 'Canton::Admin' },
        fromAmount: 500,
        toAmount: 500,
      },
    ],
    driftBefore: 8.2,
    timestamp: '2026-03-07T16:20:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    swapLegs: [
      {
        fromAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
        toAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
        fromAmount: 0.008,
        toAmount: 280,
      },
    ],
    driftBefore: 4.9,
    timestamp: '2026-03-04T11:10:00Z',
  },
];

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch the user's portfolio.
 * GET /api/portfolio/:party -> returns array; we take the first one.
 */
export function usePortfolio(party?: string) {
  const path = party ? `/api/portfolio/${encodeURIComponent(party)}` : null;
  const query = useQuery<Portfolio[]>(path, [party]);

  // Backend returns an array of portfolios; take the first.
  // Fall back to demo data when backend is unavailable.
  const portfolio = useMemo(() => {
    if (query.data && Array.isArray(query.data) && query.data.length > 0) {
      return query.data[0];
    }
    return DEMO_PORTFOLIO;
  }, [query.data]);

  return {
    portfolio,
    /** All portfolios returned by the backend for this party */
    portfolios: query.data ?? [DEMO_PORTFOLIO],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isFromBackend: query.isFromBackend,
  };
}

/**
 * Create a new portfolio.
 * POST /api/portfolio  { user, targets, triggerMode }
 */
export function useCreatePortfolio() {
  return useMutation<
    { user: string; targets: TargetAllocation[]; triggerMode: TriggerMode | 'Manual' },
    Portfolio
  >('/api/portfolio', 'POST');
}

/**
 * Update target allocations for a specific portfolio.
 * PUT /api/portfolio/:id/targets  { newTargets }
 */
export function useUpdateTargets() {
  return useMutation<
    { id: string; newTargets: TargetAllocation[] },
    { contractId: string }
  >(
    (input) => `/api/portfolio/${encodeURIComponent(input.id)}/targets`,
    'PUT',
  );
}

/**
 * Trigger a manual rebalance for a specific portfolio.
 * POST /api/portfolio/:id/rebalance
 */
export function useRebalance() {
  return useMutation<{ id: string }, { success: boolean; error?: string }>(
    (input) => `/api/portfolio/${encodeURIComponent(input.id)}/rebalance`,
    'POST',
  );
}

/**
 * Calculate current drift for a specific portfolio.
 * GET /api/portfolio/:id/drift
 */
export function useDrift(party?: string) {
  // We first need the portfolio to get both the local calculation and, if available,
  // the portfolio ID for a server-side drift check. For now, compute client-side
  // from the portfolio data (same as before) so this works with or without backend.
  const { portfolio } = usePortfolio(party);

  const drift = useMemo(() => {
    if (!portfolio) return 0;
    const { targets, holdings } = portfolio;
    const totalValue = holdings.reduce((acc, h) => acc + h.valueCc, 0);
    if (totalValue === 0) return 0;

    let maxDrift = 0;
    for (const t of targets) {
      const holding = holdings.find((h) => h.asset.symbol === t.asset.symbol);
      const currentPct = holding ? (holding.valueCc / totalValue) * 100 : 0;
      const diff = Math.abs(currentPct - t.targetPct);
      if (diff > maxDrift) maxDrift = diff;
    }
    return Math.round(maxDrift * 100) / 100;
  }, [portfolio]);

  return { drift, isLoading: false };
}

/**
 * Fetch rebalance history for a party.
 * GET /api/portfolio/:id/history
 *
 * Since the backend route expects a portfolio contract ID (not a party name),
 * but the frontend only knows the party, we use the party-based query that the
 * backend resolves to the correct portfolio internally.
 */
export function useRebalanceHistory(party?: string) {
  const path = party
    ? `/api/portfolio/${encodeURIComponent(party)}/history`
    : null;
  const query = useQuery<RebalanceLog[]>(path, [party]);

  const logs = query.data ?? DEMO_LOGS;

  const activities: ActivityEntry[] = useMemo(
    () =>
      logs.map((log, i) => ({
        id: `rebal-${i}`,
        type: 'rebalance' as const,
        timestamp: log.timestamp,
        swapLegs: log.swapLegs,
        driftBefore: log.driftBefore,
        status: 'completed' as const,
      })),
    [logs],
  );

  return {
    logs,
    activities,
    isLoading: query.isLoading,
    error: query.error,
    isFromBackend: query.isFromBackend,
  };
}
