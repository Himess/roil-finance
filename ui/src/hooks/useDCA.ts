import { useMemo } from 'react';
import { useQuery, useMutation } from './useApi';
import type {
  DCASchedule,
  DCALog,
  AssetId,
  DCAFrequency,
  ActivityEntry,
} from '@/types';

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_SCHEDULES: DCASchedule[] = [
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    amountPerBuy: 100,
    frequency: 'Weekly',
    totalExecutions: 12,
    isActive: true,
    createdAt: '2025-12-01T00:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CC', admin: 'Canton::Admin' },
    amountPerBuy: 50,
    frequency: 'Daily',
    totalExecutions: 68,
    isActive: true,
    createdAt: '2026-01-15T00:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'CC', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    amountPerBuy: 200,
    frequency: 'Monthly',
    totalExecutions: 3,
    isActive: false,
    createdAt: '2025-11-01T00:00:00Z',
  },
];

const DEMO_DCA_LOGS: DCALog[] = [
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    sourceAmount: 100,
    targetAmount: 0.0024,
    executionNumber: 12,
    timestamp: '2026-03-14T12:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CC', admin: 'Canton::Admin' },
    sourceAmount: 50,
    targetAmount: 50,
    executionNumber: 68,
    timestamp: '2026-03-15T00:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    sourceAmount: 100,
    targetAmount: 0.0025,
    executionNumber: 11,
    timestamp: '2026-03-07T12:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'USDCx', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    sourceAmount: 100,
    targetAmount: 0.0023,
    executionNumber: 10,
    timestamp: '2026-02-28T12:00:00Z',
  },
  {
    platform: 'Canton::Platform',
    user: 'Canton::Alice',
    sourceAsset: { symbol: 'CC', admin: 'Canton::Admin' },
    targetAsset: { symbol: 'CBTC', admin: 'Canton::Admin' },
    sourceAmount: 200,
    targetAmount: 0.005,
    executionNumber: 3,
    timestamp: '2026-02-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch all DCA schedules for a party.
 * GET /api/dca/:party
 */
export function useDCASchedules(party?: string) {
  const path = party ? `/api/dca/${encodeURIComponent(party)}` : null;
  const query = useQuery<DCASchedule[]>(path, [party]);

  const schedules = query.data ?? DEMO_SCHEDULES;
  return {
    schedules,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isFromBackend: query.isFromBackend,
  };
}

/**
 * Create a new DCA schedule.
 * POST /api/dca  { user, sourceAsset, targetAsset, amountPerBuy, frequency }
 */
export function useCreateDCA() {
  return useMutation<
    {
      party: string;
      sourceAsset: AssetId;
      targetAsset: AssetId;
      amountPerBuy: number;
      frequency: DCAFrequency;
    },
    DCASchedule
  >('/api/dca', 'POST');
}

/**
 * Update DCA amount.
 * PUT /api/dca/:id/amount  { newAmount }
 */
export function useUpdateDCAAmount() {
  return useMutation<
    { id: string; newAmount: number },
    { contractId: string }
  >(
    (input) => `/api/dca/${encodeURIComponent(input.id)}/amount`,
    'PUT',
  );
}

/**
 * Update DCA frequency.
 * PUT /api/dca/:id/frequency  { newFrequency }
 */
export function useUpdateDCAFrequency() {
  return useMutation<
    { id: string; newFrequency: DCAFrequency },
    { contractId: string }
  >(
    (input) => `/api/dca/${encodeURIComponent(input.id)}/frequency`,
    'PUT',
  );
}

/**
 * Pause a DCA schedule.
 * POST /api/dca/:id/pause
 */
export function usePauseDCA() {
  return useMutation<{ id: string }, { contractId: string }>(
    (input) => `/api/dca/${encodeURIComponent(input.id)}/pause`,
    'POST',
  );
}

/**
 * Resume a paused DCA schedule.
 * POST /api/dca/:id/resume
 */
export function useResumeDCA() {
  return useMutation<{ id: string }, { contractId: string }>(
    (input) => `/api/dca/${encodeURIComponent(input.id)}/resume`,
    'POST',
  );
}

/**
 * Cancel (delete) a DCA schedule.
 * DELETE /api/dca/:id
 */
export function useCancelDCA() {
  return useMutation<{ id: string }, { cancelled: boolean }>(
    (input) => `/api/dca/${encodeURIComponent(input.id)}`,
    'DELETE',
  );
}

/**
 * Fetch DCA execution history for a party.
 * GET /api/dca/:id/history
 *
 * The backend expects a schedule ID, but for the overview page we use the
 * party identifier which doubles as the schedule lookup key.
 */
export function useDCAHistory(party?: string) {
  const path = party ? `/api/dca/${encodeURIComponent(party)}/history` : null;
  const query = useQuery<DCALog[]>(path, [party]);

  const logs = query.data ?? DEMO_DCA_LOGS;

  const activities: ActivityEntry[] = useMemo(
    () =>
      logs.map((log, i) => ({
        id: `dca-${i}`,
        type: 'dca' as const,
        timestamp: log.timestamp,
        swapLegs: [
          {
            fromAsset: log.sourceAsset,
            toAsset: log.targetAsset,
            fromAmount: log.sourceAmount,
            toAmount: log.targetAmount,
          },
        ],
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
