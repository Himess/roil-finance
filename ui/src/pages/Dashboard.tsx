import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, Trophy, Activity, Repeat2,
} from 'lucide-react';
import {
  ResponsiveContainer, Tooltip, Area, AreaChart, XAxis, YAxis,
  CartesianGrid, BarChart, Bar, Cell,
} from 'recharts';
import { TOKEN_LOGOS } from '@/config';

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const performanceData = [
  { day: 'Mon', value: 232 },
  { day: 'Tue', value: 245 },
  { day: 'Wed', value: 238 },
  { day: 'Thu', value: 260 },
  { day: 'Fri', value: 275 },
  { day: 'Sat', value: 290 },
  { day: 'Sun', value: 302 },
];

const volumeData = [
  { day: 'Mon', vol: 40 },
  { day: 'Tue', vol: 55 },
  { day: 'Wed', vol: 35 },
  { day: 'Thu', vol: 65 },
  { day: 'Fri', vol: 50 },
  { day: 'Sat', vol: 70 },
  { day: 'Sun', vol: 85 },
];

const allocationSegments = [
  { token: 'CBTC', pct: 35, color: '#059669', amount: '1,250 CBTC', usd: '$45,200' },
  { token: 'ETHx', pct: 25, color: '#06B6D4', amount: '12.5 ETHx', usd: '$32,300' },
  { token: 'CC', pct: 20, color: '#6366F1', amount: '5,800 CC', usd: '$25,840' },
  { token: 'XAUt', pct: 15, color: '#D97706', amount: '8.2 XAUt', usd: '$19,360' },
  { token: 'USDCx', pct: 5, color: '#EC4899', amount: '6,450 USDCx', usd: '$6,450' },
];

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type TimeTab = '1W' | '1M' | '1Y' | 'ALL';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TimeTab>('1W');
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5 h-full font-['DM_Sans']">
      {/* ---- Header row ---- */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-bold text-[#111827] leading-tight">
            Portfolio Overview
          </h1>
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold text-sm bg-gradient-to-r from-[#059669] to-[#10B981] hover:opacity-90 transition-opacity shadow-md">
          <RefreshCw className="w-4 h-4" />
          Rebalance Now
        </button>
      </div>

      {/* ---- 4 Stat cards ---- */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total Value"
          value="$284,392"
          sub={<span className="text-sm font-semibold text-[#059669]">+$2,148.30 (24h)</span>}
          icon={<TrendingUp className="w-5 h-5 text-[#059669]" />}
          iconBg="bg-[#E0F5EA]"
        />
        <StatCard
          label="Active DCA"
          value="7"
          sub={
            <div>
              <span className="text-sm text-[#6B7280]">schedules</span>
              <div className="mt-1">
                <Link to="/dca" className="text-sm font-semibold text-[#059669] hover:underline">
                  View all &rarr;
                </Link>
              </div>
            </div>
          }
          icon={<Repeat2 className="w-5 h-5 text-[#6366F1]" />}
          iconBg="bg-[#E0E7FF]"
        />
        <StatCard
          label="Reward Tier"
          value={<span className="text-[#D97706]">GOLD</span>}
          sub={
            <div>
              <span className="text-sm text-[#6B7280]">2% rebate</span>
              <div className="mt-1">
                <Link to="/rewards" className="text-sm font-semibold text-[#D97706] hover:underline">
                  View rewards &rarr;
                </Link>
              </div>
            </div>
          }
          icon={<Trophy className="w-5 h-5 text-[#D97706]" />}
          iconBg="bg-[#FEF3C7]"
        />
        <StatCard
          label="Portfolio Drift"
          value="3.2%"
          sub={
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              Near threshold
            </span>
          }
          icon={<Activity className="w-5 h-5 text-[#E11D48]" />}
          iconBg="bg-[#FFE4E6]"
        />
      </div>

      {/* ---- Content row: chart + allocation ---- */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* Performance chart */}
        <div className="flex-1 bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] shadow-[0_2px_8px_#0000000A] p-5 flex flex-col">
          {/* Chart header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#111827]">Performance</h2>
            <div className="flex items-center gap-1 bg-white rounded-lg p-1">
              {(['1W', '1M', '1Y', 'ALL'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    activeTab === tab
                      ? 'bg-[#059669] text-white'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Area chart */}
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="perfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.20} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#DDDEE6" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: '#9CA3AF' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#9CA3AF' }}
                  axisLine={false}
                  tickLine={false}
                  domain={['dataMin - 10', 'dataMax + 10']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #D6D9E3',
                    borderRadius: '10px',
                    fontSize: '13px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}k`, 'Value']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#059669"
                  strokeWidth={2.5}
                  fill="url(#perfGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#059669', strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Volume bars */}
          <div className="h-[50px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="day" tick={false} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Bar dataKey="vol" radius={[3, 3, 0, 0]}>
                  {volumeData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === volumeData.length - 1 ? '#059669' : '#D1D5DB'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Allocation panel */}
        <div className="w-[360px] bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] shadow-[0_2px_8px_#0000000A] p-5 flex flex-col">
          <h2 className="text-lg font-bold text-[#111827] mb-4">Allocation</h2>

          {/* Donut chart — interactive hover */}
          <div className="flex justify-center mb-5">
            <div className="relative w-[170px] h-[170px]">
              <div
                className="w-full h-full rounded-full transition-all duration-200"
                style={{
                  background: (() => {
                    let cursor = 0;
                    return `conic-gradient(${allocationSegments.map((a) => {
                      const start = cursor;
                      cursor += a.pct;
                      if (hoveredToken && hoveredToken !== a.token) {
                        const r = parseInt(a.color.slice(1, 3), 16);
                        const g = parseInt(a.color.slice(3, 5), 16);
                        const b = parseInt(a.color.slice(5, 7), 16);
                        return `rgba(${r},${g},${b},0.3) ${start}% ${cursor}%`;
                      }
                      return `${a.color} ${start}% ${cursor}%`;
                    }).join(', ')})`;
                  })(),
                }}
              />
              {/* Mouse angle detection overlay */}
              <div
                className="absolute inset-0 rounded-full cursor-pointer"
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left - rect.width / 2;
                  const y = e.clientY - rect.top - rect.height / 2;
                  const dist = Math.sqrt(x * x + y * y);
                  if (dist < 50 || dist > rect.width / 2) { setHoveredToken(null); return; }
                  let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
                  if (angle < 0) angle += 360;
                  let cum = 0;
                  for (const seg of allocationSegments) {
                    cum += seg.pct;
                    if ((angle / 360) * 100 <= cum) { setHoveredToken(seg.token); return; }
                  }
                }}
                onMouseLeave={() => setHoveredToken(null)}
              />
              {/* Center hole */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[100px] h-[100px] rounded-full bg-[#F3F4F9] flex flex-col items-center justify-center">
                  {hoveredToken ? (
                    <>
                      <span className="text-[22px] font-[800] text-[#111827] leading-none">
                        {allocationSegments.find((s) => s.token === hoveredToken)?.pct}%
                      </span>
                      <span className="text-[11px] text-[#6B7280] mt-0.5">{hoveredToken}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[28px] font-[800] text-[#111827] leading-none">9</span>
                      <span className="text-xs text-[#6B7280]">Assets</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Asset list */}
          <div className="flex flex-col gap-2.5 mt-1">
            {allocationSegments.map((a) => (
              <div
                key={a.token}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
                style={{ backgroundColor: hoveredToken === a.token ? '#E8EBF2' : 'transparent' }}
                onMouseEnter={() => setHoveredToken(a.token)}
                onMouseLeave={() => setHoveredToken(null)}
              >
                <div className="flex items-center gap-2">
                  <img
                    src={TOKEN_LOGOS[a.token]}
                    alt={a.token}
                    className="w-[16px] h-[16px] rounded-full object-cover"
                  />
                  <span className="text-sm font-medium text-[#111827]">
                    {a.token}
                  </span>
                  <span className="text-xs text-[#6B7280]">
                    {a.amount} &middot; {a.usd}
                  </span>
                </div>
                <span
                  className="text-sm font-bold"
                  style={{ color: a.color }}
                >
                  {a.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat Card                                                           */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  icon: React.ReactNode;
  iconBg: string;
}

function StatCard({ label, value, sub, icon, iconBg }: StatCardProps) {
  return (
    <div className="relative bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] shadow-[0_2px_8px_#0000000A] p-5">
      {/* Icon — top-right */}
      <div
        className={`absolute top-4 right-4 w-[42px] h-[42px] rounded-[10px] flex items-center justify-center ${iconBg}`}
      >
        {icon}
      </div>

      <p className="text-sm text-[#6B7280] mb-1">{label}</p>
      <p className="text-[28px] font-[800] text-[#111827] leading-tight">{value}</p>
      <div className="mt-1">{sub}</div>
    </div>
  );
}
