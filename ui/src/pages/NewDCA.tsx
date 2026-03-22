import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Calendar, Check } from 'lucide-react';

type Frequency = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly';
type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';

const QUICK_AMOUNTS = [50, 100, 200, 500];
const FREQUENCIES: Frequency[] = ['Hourly', 'Daily', 'Weekly', 'Monthly'];
const DAYS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TOKEN_LOGOS: Record<string, string> = {
  USDCx: '/tokens/usdcx.png',
  CBTC: '/tokens/cbtc.png',
  ETHx: '/tokens/ethx.png',
  SOLx: '/tokens/solx.png',
};

const TOKEN_PRICES: Record<string, string> = {
  CBTC: '$87,432.10',
  ETHx: '$2,048.55',
  SOLx: '$142.30',
};

function getProjected(amount: number, frequency: Frequency) {
  const perWeek =
    frequency === 'Hourly'
      ? amount * 168
      : frequency === 'Daily'
        ? amount * 7
        : frequency === 'Weekly'
          ? amount
          : amount / 4.33;

  const monthly = perWeek * 4.33;
  const threeMonth = monthly * 3;
  const yearly = monthly * 12;

  return {
    oneMonth: Math.round(monthly),
    threeMonth: Math.round(threeMonth),
    oneYear: Math.round(yearly),
  };
}

function getFirstExecutionDate(day: DayOfWeek): string {
  const dayMap: Record<DayOfWeek, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
  };
  const today = new Date();
  const targetDay = dayMap[day];
  const currentDay = today.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  const nextDate = new Date(today);
  nextDate.setDate(today.getDate() + diff);
  return nextDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function NewDCA() {
  const navigate = useNavigate();

  const [fromToken] = useState('USDCx');
  const [toToken] = useState('CBTC');
  const [amount, setAmount] = useState(200);
  const [frequency, setFrequency] = useState<Frequency>('Weekly');
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('Mon');
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);

  const projected = getProjected(amount, frequency);
  const firstExecution = getFirstExecutionDate(selectedDay);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[#1A1A2E]">
          Create DCA Schedule
        </h2>
        <p className="text-sm text-[#6B7280] mt-1">
          Set up automated recurring purchases on Canton Network
        </p>
      </div>

      {/* Two column layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT: Form card */}
        <div className="flex-1 bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px]">
          {/* From dropdown */}
          <div className="mb-4">
            <label className="block text-xs text-[#6B7280] mb-1.5">From</label>
            <div className="relative">
              <button
                onClick={() => setShowFromDropdown(!showFromDropdown)}
                className="w-full flex items-center justify-between bg-white border border-[#D6D9E3] rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={TOKEN_LOGOS[fromToken]}
                    alt={fromToken}
                    className="w-8 h-8 rounded-full"
                  />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-[#1A1A2E]">
                      {fromToken}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      Balance: $12,450
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[#6B7280]" />
              </button>
              {showFromDropdown && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-[#D6D9E3] rounded-xl shadow-lg overflow-hidden">
                  {Object.keys(TOKEN_LOGOS).map((token) => (
                    <button
                      key={token}
                      onClick={() => setShowFromDropdown(false)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F3F4F9] transition-colors"
                    >
                      <img
                        src={TOKEN_LOGOS[token]}
                        alt={token}
                        className="w-6 h-6 rounded-full"
                      />
                      <span className="text-sm text-[#1A1A2E]">{token}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* To dropdown */}
          <div className="mb-4">
            <label className="block text-xs text-[#6B7280] mb-1.5">To</label>
            <div className="relative">
              <button
                onClick={() => setShowToDropdown(!showToDropdown)}
                className="w-full flex items-center justify-between bg-white border border-[#D6D9E3] rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={TOKEN_LOGOS[toToken]}
                    alt={toToken}
                    className="w-8 h-8 rounded-full"
                  />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-[#1A1A2E]">
                      {toToken}
                    </p>
                    <p className="text-xs text-[#6B7280]">
                      {TOKEN_PRICES[toToken]}
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[#6B7280]" />
              </button>
              {showToDropdown && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-[#D6D9E3] rounded-xl shadow-lg overflow-hidden">
                  {Object.entries(TOKEN_PRICES).map(([token, price]) => (
                    <button
                      key={token}
                      onClick={() => setShowToDropdown(false)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F3F4F9] transition-colors"
                    >
                      <img
                        src={TOKEN_LOGOS[token]}
                        alt={token}
                        className="w-6 h-6 rounded-full"
                      />
                      <div className="text-left">
                        <span className="text-sm text-[#1A1A2E]">{token}</span>
                        <span className="text-xs text-[#6B7280] ml-2">
                          {price}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#D6D9E3] my-5" />

          {/* Amount input */}
          <div className="mb-4">
            <label className="block text-xs text-[#6B7280] mb-1.5">
              Amount per purchase
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1A1A2E] font-semibold">
                $
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                className="w-full bg-white border border-[#D6D9E3] rounded-xl pl-8 pr-4 py-3 text-sm font-semibold text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#059669]/30 focus:border-[#059669]"
              />
            </div>

            {/* Quick select amounts */}
            <div className="flex gap-2 mt-3">
              {QUICK_AMOUNTS.map((qa) => (
                <button
                  key={qa}
                  onClick={() => setAmount(qa)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    amount === qa
                      ? 'bg-[#059669] text-white'
                      : 'bg-white border border-[#D6D9E3] text-[#6B7280] hover:border-[#059669] hover:text-[#059669]'
                  }`}
                >
                  ${qa}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#D6D9E3] my-5" />

          {/* Frequency */}
          <div className="mb-4">
            <label className="block text-xs text-[#6B7280] mb-1.5">
              Frequency
            </label>
            <div className="flex gap-2">
              {FREQUENCIES.map((f) => (
                <button
                  key={f}
                  onClick={() => setFrequency(f)}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    frequency === f
                      ? 'bg-[#059669] text-white'
                      : 'bg-white border border-[#D6D9E3] text-[#6B7280] hover:border-[#059669] hover:text-[#059669]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Day of week */}
          <div className="mb-6">
            <label className="block text-xs text-[#6B7280] mb-1.5">
              Day of Week
            </label>
            <div className="flex gap-2">
              {DAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDay(d)}
                  className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedDay === d
                      ? 'bg-[#059669] text-white'
                      : 'bg-white border border-[#D6D9E3] text-[#6B7280] hover:border-[#059669] hover:text-[#059669]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/dca')}
              className="flex-1 py-3 rounded-xl border border-[#D6D9E3] text-sm font-medium text-[#6B7280] hover:bg-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => navigate('/dca')}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{
                background: 'linear-gradient(135deg, #059669, #10B981)',
              }}
            >
              Create Schedule
            </button>
          </div>
        </div>

        {/* RIGHT: Summary card */}
        <div className="w-full lg:w-[360px] shrink-0">
          <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-[18px_22px]">
            <h3 className="text-sm font-semibold text-[#1A1A2E] mb-4">
              Schedule Summary
            </h3>

            {/* From / To */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">From</span>
                <div className="flex items-center gap-2">
                  <img
                    src={TOKEN_LOGOS[fromToken]}
                    alt={fromToken}
                    className="w-5 h-5 rounded-full"
                  />
                  <span className="text-sm font-medium text-[#1A1A2E]">
                    {fromToken}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">To</span>
                <div className="flex items-center gap-2">
                  <img
                    src={TOKEN_LOGOS[toToken]}
                    alt={toToken}
                    className="w-5 h-5 rounded-full"
                  />
                  <span className="text-sm font-medium text-[#1A1A2E]">
                    {toToken}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">Amount</span>
                <span className="text-sm font-semibold text-[#1A1A2E]">
                  ${amount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">Frequency</span>
                <span className="text-sm font-medium text-[#059669]">
                  {frequency} ({selectedDay})
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[#D6D9E3] my-4" />

            {/* Projected */}
            <div>
              <p className="text-xs text-[#6B7280] mb-3">Projected Investment</p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6B7280]">1 Month</span>
                  <span className="text-sm font-semibold text-[#059669]">
                    ${projected.oneMonth.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6B7280]">3 Months</span>
                  <span className="text-sm font-semibold text-[#059669]">
                    ${projected.threeMonth.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6B7280]">1 Year</span>
                  <span className="text-sm font-semibold text-[#059669]">
                    ${projected.oneYear.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[#D6D9E3] my-4" />

            {/* First Execution */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#6B7280]" />
                <span className="text-xs text-[#6B7280]">First Execution</span>
              </div>
              <span className="text-sm font-medium text-[#059669]">
                {firstExecution}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
