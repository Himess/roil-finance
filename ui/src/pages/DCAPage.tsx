import { useState, useMemo, useCallback, useEffect } from 'react';
import { Plus, Repeat2 } from 'lucide-react';
import DCACard from '@/components/DCACard';
import SwapHistory from '@/components/SwapHistory';
import ConfirmDialog from '@/components/ConfirmDialog';
import TokenSelect from '@/components/TokenSelect';
import TokenIcon from '@/components/TokenIcon';
import {
  useDCASchedules,
  useDCAHistory,
  useCreateDCA,
  usePauseDCA,
  useResumeDCA,
  useCancelDCA,
} from '@/hooks/useDCA';
import { useParty } from '@/context/PartyContext';
import { useToast } from '@/components/Toast';
import type { DCAFrequency } from '@/types';
import { ASSET_COLORS, AVAILABLE_ASSETS } from '@/config';

const FREQUENCIES: DCAFrequency[] = ['Hourly', 'Daily', 'Weekly', 'Monthly'];

const frequencyLabels: Record<string, string> = { Hourly: 'hour', Daily: 'day', Weekly: 'week', Monthly: 'month' };

export default function DCAPage() {
  const { party } = useParty();
  const { schedules, isLoading, error, refetch: refetchSchedules } = useDCASchedules(party);
  const { activities } = useDCAHistory(party);
  const createDCA = useCreateDCA();
  const pauseDCA = usePauseDCA();
  const resumeDCA = useResumeDCA();
  const cancelDCA = useCancelDCA();
  const { addToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [sourceSymbol, setSourceSymbol] = useState('USDCx');
  const [targetSymbol, setTargetSymbol] = useState('CBTC');
  const [amount, setAmount] = useState('100');
  const [frequency, setFrequency] = useState<DCAFrequency>('Weekly');
  const [cancelConfirm, setCancelConfirm] = useState<{ isOpen: boolean; index: number }>({ isOpen: false, index: -1 });

  // Reset target when it collides with source
  useEffect(() => {
    if (sourceSymbol === targetSymbol) {
      const firstAvailable = AVAILABLE_ASSETS.find(a => a.symbol !== sourceSymbol);
      if (firstAvailable) setTargetSymbol(firstAvailable.symbol);
    }
  }, [sourceSymbol, targetSymbol]);

  const activeCount = useMemo(
    () => schedules.filter((s) => s.isActive).length,
    [schedules],
  );

  const totalExecutions = useMemo(
    () => schedules.reduce((acc, s) => acc + s.totalExecutions, 0),
    [schedules],
  );

  const handleCreate = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (sourceSymbol === targetSymbol) return;

    try {
      await createDCA.mutate({
        party,
        sourceAsset: { symbol: sourceSymbol, admin: 'Canton::Admin' },
        targetAsset: { symbol: targetSymbol, admin: 'Canton::Admin' },
        amountPerBuy: parseFloat(amount),
        frequency,
      });
      setShowForm(false);
      setAmount('100');
      refetchSchedules();
      addToast('success', 'DCA schedule created');
    } catch {
      // error captured in mutation
    }
  }, [sourceSymbol, targetSymbol, amount, frequency, createDCA, party, refetchSchedules, addToast]);

  const getScheduleId = useCallback((index: number): string => {
    const schedule = schedules[index];
    // Backend may attach a contractId to the schedule object
    const contractId = (schedule as unknown as { contractId?: string })?.contractId;
    return contractId ?? String(index);
  }, [schedules]);

  const handlePause = useCallback(
    async (index: number) => {
      try {
        await pauseDCA.mutate({ id: getScheduleId(index) });
        refetchSchedules();
        addToast('info', 'DCA schedule paused');
      } catch {
        // error captured
      }
    },
    [pauseDCA, getScheduleId, refetchSchedules, addToast],
  );

  const handleResume = useCallback(
    async (index: number) => {
      try {
        await resumeDCA.mutate({ id: getScheduleId(index) });
        refetchSchedules();
      } catch {
        // error captured
      }
    },
    [resumeDCA, getScheduleId, refetchSchedules],
  );

  const handleCancel = useCallback(
    async (index: number) => {
      try {
        await cancelDCA.mutate({ id: getScheduleId(index) });
        refetchSchedules();
        addToast('info', 'DCA schedule cancelled');
      } catch {
        // error captured
      }
    },
    [cancelDCA, getScheduleId, refetchSchedules, addToast],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-muted rounded w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-surface-muted rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 bg-surface-muted rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-base text-amber-700">
            Using demo data — backend unavailable: {error}
          </p>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink">
            Dollar Cost Averaging
          </h2>
          <p className="text-base text-ink-muted mt-0.5">
            Automated recurring purchases on Canton Network
          </p>
        </div>

        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New DCA
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-ink-muted">Active Schedules</p>
          <p className="text-3xl font-bold text-ink mt-1">{activeCount}</p>
        </div>
        <div className="card">
          <p className="text-sm text-ink-muted">Total Schedules</p>
          <p className="text-3xl font-bold text-ink mt-1">
            {schedules.length}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-ink-muted">Total Executions</p>
          <p className="text-3xl font-bold text-ink mt-1">
            {totalExecutions}
          </p>
        </div>
      </div>

      {/* Create DCA form */}
      {showForm && (
        <div className="card border-accent/30">
          <h3 className="text-lg font-semibold text-ink mb-4">
            Create New DCA Schedule
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Source asset */}
            <div>
              <TokenSelect
                value={sourceSymbol}
                onChange={setSourceSymbol}
                tokens={AVAILABLE_ASSETS}
                label="Source Asset"
              />
            </div>

            {/* Target asset */}
            <div>
              <TokenSelect
                value={targetSymbol}
                onChange={setTargetSymbol}
                tokens={AVAILABLE_ASSETS}
                excludeSymbol={sourceSymbol}
                label="Target Asset"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm text-ink-muted mb-1.5">
                Amount per Buy
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0.01}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-field w-full pr-20"
                  placeholder="100"
                />
                <div className="flex items-center gap-1.5 absolute right-3 top-1/2 -translate-y-1/2">
                  <TokenIcon symbol={sourceSymbol} size={18} showBadge={false} />
                  <span className="text-sm text-ink-muted">
                    {sourceSymbol}
                  </span>
                </div>
              </div>
            </div>

            {/* Frequency */}
            <div>
              <label className="block text-sm text-ink-muted mb-1.5">
                Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as DCAFrequency)
                }
                className="input-field w-full"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Validation */}
          {sourceSymbol === targetSymbol && (
            <p className="text-sm text-warning mt-3">
              Source and target must be different assets
            </p>
          )}

          {/* Preview */}
          <div className="mt-4 p-3 bg-surface-muted rounded-lg flex items-center gap-3">
            <Repeat2 className="w-4 h-4 text-ink-muted shrink-0" />
            <p className="text-base text-ink-secondary">
              Buy{' '}
              <span
                className="font-medium"
                style={{
                  color: ASSET_COLORS[targetSymbol] ?? '#9CA3AF',
                }}
              >
                {targetSymbol}
              </span>{' '}
              with{' '}
              <span className="text-ink font-medium">
                {amount || '0'} {sourceSymbol}
              </span>{' '}
              every{' '}
              <span className="text-ink font-medium">
                {frequencyLabels[frequency] ?? frequency.toLowerCase()}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={() => setShowForm(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={
                createDCA.isLoading ||
                sourceSymbol === targetSymbol ||
                !amount ||
                parseFloat(amount) <= 0
              }
              className="btn-primary"
            >
              {createDCA.isLoading ? 'Creating...' : 'Create Schedule'}
            </button>
          </div>

          {createDCA.error && (
            <p className="text-sm text-negative mt-2">{createDCA.error}</p>
          )}
        </div>
      )}

      {/* DCA schedule cards */}
      {schedules.length === 0 ? (
        <div className="card text-center py-12">
          <Repeat2 className="w-10 h-10 text-ink-faint mx-auto mb-3" />
          <p className="text-base text-ink-secondary">No DCA schedules yet</p>
          <p className="text-base text-ink-muted mt-1">
            Create your first dollar cost averaging schedule
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 mt-4 btn-primary text-base"
          >
            <Plus className="w-3 h-3" />
            Create First DCA
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {schedules.map((schedule, i) => (
            <DCACard
              key={`${schedule.sourceAsset.symbol}-${schedule.targetAsset.symbol}-${i}`}
              schedule={schedule}
              onPause={() => handlePause(i)}
              onResume={() => handleResume(i)}
              onCancel={() => setCancelConfirm({ isOpen: true, index: i })}
            />
          ))}
        </div>
      )}

      {/* DCA execution history */}
      <SwapHistory
        activities={activities}
        showType={false}
        limit={10}
      />

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        isOpen={cancelConfirm.isOpen}
        title="Cancel DCA Schedule"
        message="This will permanently cancel this DCA schedule. Any pending executions will not be processed. Are you sure?"
        confirmLabel="Cancel Schedule"
        variant="danger"
        onConfirm={() => {
          handleCancel(cancelConfirm.index);
          setCancelConfirm({ isOpen: false, index: -1 });
        }}
        onCancel={() => setCancelConfirm({ isOpen: false, index: -1 })}
      />
    </div>
  );
}
