import { useState, useMemo, useCallback } from 'react';
import { Plus, Repeat2 } from 'lucide-react';
import DCACard from '@/components/DCACard';
import SwapHistory from '@/components/SwapHistory';
import {
  useDCASchedules,
  useDCAHistory,
  useCreateDCA,
  usePauseDCA,
  useResumeDCA,
  useCancelDCA,
} from '@/hooks/useDCA';
import { useParty } from '@/context/PartyContext';
import type { AssetId, DCAFrequency } from '@/types';
import { ASSET_COLORS } from '@/config';

const AVAILABLE_ASSETS: AssetId[] = [
  { symbol: 'CC', admin: 'Canton::Admin' },
  { symbol: 'USDCx', admin: 'Canton::Admin' },
  { symbol: 'CBTC', admin: 'Canton::Admin' },
  { symbol: 'ETHx', admin: 'Canton::Admin' },
];

const FREQUENCIES: DCAFrequency[] = ['Hourly', 'Daily', 'Weekly', 'Monthly'];

export default function DCAPage() {
  const { party } = useParty();
  const { schedules } = useDCASchedules(party);
  const { activities } = useDCAHistory(party);
  const createDCA = useCreateDCA();
  const pauseDCA = usePauseDCA();
  const resumeDCA = useResumeDCA();
  const cancelDCA = useCancelDCA();

  const [showForm, setShowForm] = useState(false);
  const [sourceSymbol, setSourceSymbol] = useState('USDCx');
  const [targetSymbol, setTargetSymbol] = useState('CBTC');
  const [amount, setAmount] = useState('100');
  const [frequency, setFrequency] = useState<DCAFrequency>('Weekly');

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
    } catch {
      // error captured in mutation
    }
  }, [sourceSymbol, targetSymbol, amount, frequency, createDCA, party]);

  const getScheduleId = (index: number): string => {
    const schedule = schedules[index];
    // Backend may attach a contractId to the schedule object
    const contractId = (schedule as unknown as { contractId?: string }).contractId;
    return contractId ?? String(index);
  };

  const handlePause = useCallback(
    async (index: number) => {
      try {
        await pauseDCA.mutate({ id: getScheduleId(index) });
      } catch {
        // error captured
      }
    },
    [pauseDCA, schedules],
  );

  const handleResume = useCallback(
    async (index: number) => {
      try {
        await resumeDCA.mutate({ id: getScheduleId(index) });
      } catch {
        // error captured
      }
    },
    [resumeDCA, schedules],
  );

  const handleCancel = useCallback(
    async (index: number) => {
      try {
        await cancelDCA.mutate({ id: getScheduleId(index) });
      } catch {
        // error captured
      }
    },
    [cancelDCA, schedules],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">
            Dollar Cost Averaging
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
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
          <p className="text-xs text-slate-500">Active Schedules</p>
          <p className="text-2xl font-bold text-white mt-1">{activeCount}</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Total Schedules</p>
          <p className="text-2xl font-bold text-white mt-1">
            {schedules.length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-500">Total Executions</p>
          <p className="text-2xl font-bold text-white mt-1">
            {totalExecutions}
          </p>
        </div>
      </div>

      {/* Create DCA form */}
      {showForm && (
        <div className="card border-blue-500/30">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">
            Create New DCA Schedule
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Source asset */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Source Asset
              </label>
              <select
                value={sourceSymbol}
                onChange={(e) => setSourceSymbol(e.target.value)}
                className="input-field w-full"
              >
                {AVAILABLE_ASSETS.map((a) => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol}
                  </option>
                ))}
              </select>
            </div>

            {/* Target asset */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Target Asset
              </label>
              <select
                value={targetSymbol}
                onChange={(e) => setTargetSymbol(e.target.value)}
                className="input-field w-full"
              >
                {AVAILABLE_ASSETS.filter((a) => a.symbol !== sourceSymbol).map(
                  (a) => (
                    <option key={a.symbol} value={a.symbol}>
                      {a.symbol}
                    </option>
                  ),
                )}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
                Amount per Buy
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0.01}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-field w-full pr-14"
                  placeholder="100"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  {sourceSymbol}
                </span>
              </div>
            </div>

            {/* Frequency */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">
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
            <p className="text-xs text-amber-400 mt-3">
              Source and target must be different assets
            </p>
          )}

          {/* Preview */}
          <div className="mt-4 p-3 bg-slate-900 rounded-lg flex items-center gap-3">
            <Repeat2 className="w-4 h-4 text-slate-500 shrink-0" />
            <p className="text-sm text-slate-400">
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
              <span className="text-white font-medium">
                {amount || '0'} {sourceSymbol}
              </span>{' '}
              every{' '}
              <span className="text-white font-medium">
                {frequency.toLowerCase().replace('ly', '').replace('dai', 'day')}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={() => setShowForm(false)}
              className="btn-secondary text-sm"
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
              className="btn-primary text-sm"
            >
              {createDCA.isLoading ? 'Creating...' : 'Create Schedule'}
            </button>
          </div>

          {createDCA.error && (
            <p className="text-xs text-red-400 mt-2">{createDCA.error}</p>
          )}
        </div>
      )}

      {/* DCA schedule cards */}
      {schedules.length === 0 ? (
        <div className="card text-center py-12">
          <Repeat2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No DCA schedules yet</p>
          <p className="text-xs text-slate-600 mt-1">
            Create your first dollar cost averaging schedule above
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {schedules.map((schedule, i) => (
            <DCACard
              key={`${schedule.sourceAsset.symbol}-${schedule.targetAsset.symbol}-${i}`}
              schedule={schedule}
              onPause={() => handlePause(i)}
              onResume={() => handleResume(i)}
              onCancel={() => handleCancel(i)}
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
    </div>
  );
}
