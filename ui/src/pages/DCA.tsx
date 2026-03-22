import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, DollarSign, Repeat, Flame, Pause, Play, X } from 'lucide-react';

interface Schedule {
  id: number;
  from: string;
  to: string;
  toLabel: string;
  toLogoUrl: string;
  amount: number;
  frequency: string;
  dayLabel: string;
  executions: number;
  invested: number;
  status: 'Active' | 'Paused';
}

const SCHEDULES: Schedule[] = [
  {
    id: 1,
    from: 'USDCx',
    to: 'CBTC',
    toLabel: 'CBTC',
    toLogoUrl: '/tokens/cbtc.png',
    amount: 200,
    frequency: 'weekly',
    dayLabel: 'Every Monday',
    executions: 24,
    invested: 4800,
    status: 'Active',
  },
  {
    id: 2,
    from: 'USDCx',
    to: 'ETHx',
    toLabel: 'ETHx',
    toLogoUrl: '/tokens/ethx.png',
    amount: 150,
    frequency: 'weekly',
    dayLabel: 'Every Wednesday',
    executions: 18,
    invested: 2700,
    status: 'Active',
  },
  {
    id: 3,
    from: 'USDCx',
    to: 'SOLx',
    toLabel: 'SOLx',
    toLogoUrl: '/tokens/solx.png',
    amount: 100,
    frequency: 'monthly',
    dayLabel: 'Every 1st',
    executions: 6,
    invested: 600,
    status: 'Paused',
  },
];

export default function DCA() {
  const [schedules, setSchedules] = useState<Schedule[]>(SCHEDULES);

  const toggleStatus = (id: number) => {
    setSchedules((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status: s.status === 'Active' ? 'Paused' : 'Active' }
          : s,
      ),
    );
  };

  const removeSchedule = (id: number) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#1A1A2E]">
          Dollar Cost Averaging
        </h2>
        <Link
          to="/dca/new"
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white font-semibold text-sm"
          style={{
            background: 'linear-gradient(135deg, #059669, #10B981)',
          }}
        >
          <Plus className="w-4 h-4" />
          New Schedule
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Active Schedules */}
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#6B7280]">Active Schedules</p>
              <p className="text-3xl font-bold text-[#1A1A2E] mt-1">7</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#E0F5EA] flex items-center justify-center">
              <Repeat className="w-5 h-5 text-[#059669]" />
            </div>
          </div>
        </div>

        {/* Monthly Volume */}
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#6B7280]">Monthly Volume</p>
              <p className="text-3xl font-bold text-[#1A1A2E] mt-1">$4,200</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#DBEAFE] flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-[#2563EB]" />
            </div>
          </div>
        </div>

        {/* Week Streak */}
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#6B7280]">Week Streak</p>
              <p className="text-3xl font-bold text-[#1A1A2E] mt-1">12</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center">
              <Flame className="w-5 h-5 text-[#D97706]" />
            </div>
          </div>
        </div>
      </div>

      {/* Active Schedules section */}
      <div>
        <h3 className="text-lg font-semibold text-[#1A1A2E] mb-3">
          Active Schedules
        </h3>

        <div className="flex flex-col gap-3">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px] flex items-center justify-between"
            >
              {/* Left: token logo + title/subtitle */}
              <div className="flex items-center gap-3">
                <img
                  src={schedule.toLogoUrl}
                  alt={schedule.toLabel}
                  className="w-9 h-9 rounded-full"
                />
                <div>
                  <p className="text-sm font-semibold text-[#1A1A2E]">
                    USDCx &rarr; {schedule.toLabel}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    ${schedule.amount} {schedule.frequency} &middot;{' '}
                    {schedule.dayLabel}
                  </p>
                </div>
              </div>

              {/* Middle: executions + invested */}
              <div className="hidden sm:block text-center">
                <p className="text-xs text-[#6B7280]">
                  {schedule.executions} executions
                </p>
                <p className="text-sm font-bold text-[#1A1A2E]">
                  ${schedule.invested.toLocaleString()} invested
                </p>
              </div>

              {/* Right: badge + pause/play button */}
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    schedule.status === 'Active'
                      ? 'bg-[#E0F5EA] text-[#059669]'
                      : 'bg-[#FEF3C7] text-[#D97706]'
                  }`}
                >
                  {schedule.status}
                </span>
                <button
                  onClick={() => toggleStatus(schedule.id)}
                  className="w-8 h-8 rounded-full border border-[#D6D9E3] flex items-center justify-center hover:bg-[#E8E9F0] transition-colors"
                >
                  {schedule.status === 'Active' ? (
                    <Pause className="w-4 h-4 text-[#6B7280]" />
                  ) : (
                    <Play className="w-4 h-4 text-[#6B7280]" />
                  )}
                </button>
                <button
                  onClick={() => removeSchedule(schedule.id)}
                  className="w-8 h-8 rounded-full border border-[#D6D9E3] flex items-center justify-center hover:bg-[#FEE2E2] transition-colors"
                >
                  <X className="w-4 h-4 text-[#EF4444]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
