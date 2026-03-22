import { useState } from 'react';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, Repeat2, RefreshCw, Gift,
  Search, Filter,
} from 'lucide-react';
import { TOKEN_LOGOS } from '@/config';

type TxType = 'Deposit' | 'Withdraw' | 'Swap' | 'DCA Buy' | 'Rebalance' | 'Reward';

interface HistoryEntry {
  id: number;
  type: TxType;
  token: string;
  amount: string;
  usd: string;
  date: string;
  status: 'Completed' | 'Pending';
}

const TX_ICON: Record<TxType, React.ComponentType<{ className?: string; color?: string }>> = {
  'Deposit': ArrowDownLeft,
  'Withdraw': ArrowUpRight,
  'Swap': Repeat,
  'DCA Buy': Repeat2,
  'Rebalance': RefreshCw,
  'Reward': Gift,
};

const TX_COLOR: Record<TxType, { bg: string; text: string }> = {
  'Deposit': { bg: '#E0F5EA', text: '#059669' },
  'Withdraw': { bg: '#FFE4E6', text: '#E11D48' },
  'Swap': { bg: '#DBEAFE', text: '#2563EB' },
  'DCA Buy': { bg: '#E0F5EA', text: '#059669' },
  'Rebalance': { bg: '#FEF3C7', text: '#D97706' },
  'Reward': { bg: '#EDE9FE', text: '#7C3AED' },
};

const ALL_HISTORY: HistoryEntry[] = [
  { id: 1, type: 'DCA Buy', token: 'CBTC', amount: '+0.0023 CBTC', usd: '$200.00', date: 'Mar 22, 2026 09:15', status: 'Completed' },
  { id: 2, type: 'Rebalance', token: 'ETHx → CC', amount: '0.8 ETHx → 412 CC', usd: '$1,840.00', date: 'Mar 21, 2026 14:30', status: 'Completed' },
  { id: 3, type: 'Reward', token: 'USDCx', amount: '+32.10 USDCx', usd: '$32.10', date: 'Mar 20, 2026 00:00', status: 'Completed' },
  { id: 4, type: 'DCA Buy', token: 'ETHx', amount: '+0.073 ETHx', usd: '$150.00', date: 'Mar 19, 2026 09:15', status: 'Completed' },
  { id: 5, type: 'Deposit', token: 'USDCx', amount: '+5,000 USDCx', usd: '$5,000.00', date: 'Mar 18, 2026 11:42', status: 'Completed' },
  { id: 6, type: 'Swap', token: 'USDCx → XAUt', amount: '2,000 USDCx → 0.82 XAUt', usd: '$2,000.00', date: 'Mar 17, 2026 16:05', status: 'Completed' },
  { id: 7, type: 'DCA Buy', token: 'CBTC', amount: '+0.0023 CBTC', usd: '$200.00', date: 'Mar 15, 2026 09:15', status: 'Completed' },
  { id: 8, type: 'Withdraw', token: 'USDCx', amount: '-1,200 USDCx', usd: '$1,200.00', date: 'Mar 14, 2026 10:20', status: 'Completed' },
  { id: 9, type: 'Rebalance', token: 'CBTC → USDCx', amount: '0.015 CBTC → 1,310 USDCx', usd: '$1,310.00', date: 'Mar 12, 2026 14:30', status: 'Completed' },
  { id: 10, type: 'Deposit', token: 'USDCx', amount: '+10,000 USDCx', usd: '$10,000.00', date: 'Mar 10, 2026 08:00', status: 'Completed' },
  { id: 11, type: 'DCA Buy', token: 'SOLx', amount: '+0.71 SOLx', usd: '$100.00', date: 'Mar 8, 2026 09:15', status: 'Completed' },
  { id: 12, type: 'Swap', token: 'CC → ETHx', amount: '500 CC → 0.12 ETHx', usd: '$280.00', date: 'Mar 6, 2026 13:22', status: 'Completed' },
  { id: 13, type: 'Reward', token: 'USDCx', amount: '+28.40 USDCx', usd: '$28.40', date: 'Mar 1, 2026 00:00', status: 'Completed' },
  { id: 14, type: 'DCA Buy', token: 'CBTC', amount: '+0.0022 CBTC', usd: '$200.00', date: 'Feb 28, 2026 09:15', status: 'Completed' },
  { id: 15, type: 'Deposit', token: 'USDCx', amount: '+3,000 USDCx', usd: '$3,000.00', date: 'Feb 25, 2026 14:10', status: 'Completed' },
  { id: 16, type: 'Rebalance', token: 'XAUt → CC', amount: '0.1 XAUt → 580 CC', usd: '$240.00', date: 'Feb 22, 2026 14:30', status: 'Completed' },
  { id: 17, type: 'DCA Buy', token: 'ETHx', amount: '+0.075 ETHx', usd: '$150.00', date: 'Feb 20, 2026 09:15', status: 'Completed' },
  { id: 18, type: 'Withdraw', token: 'CBTC', amount: '-0.05 CBTC', usd: '$4,350.00', date: 'Feb 15, 2026 11:00', status: 'Completed' },
  { id: 19, type: 'Swap', token: 'USDCx → CBTC', amount: '5,000 USDCx → 0.057 CBTC', usd: '$5,000.00', date: 'Feb 10, 2026 10:45', status: 'Completed' },
  { id: 20, type: 'Deposit', token: 'USDCx', amount: '+20,000 USDCx', usd: '$20,000.00', date: 'Feb 1, 2026 09:00', status: 'Completed' },
];

const FILTER_TYPES: TxType[] = ['Deposit', 'Withdraw', 'Swap', 'DCA Buy', 'Rebalance', 'Reward'];

function getTokenLogo(token: string): string | null {
  const symbol = token.split(' → ')[0].split(' ')[0];
  return TOKEN_LOGOS[symbol] || null;
}

export default function History() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<TxType | 'All'>('All');

  const filtered = ALL_HISTORY.filter((tx) => {
    if (activeFilter !== 'All' && tx.type !== activeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        tx.type.toLowerCase().includes(q) ||
        tx.token.toLowerCase().includes(q) ||
        tx.amount.toLowerCase().includes(q) ||
        tx.usd.toLowerCase().includes(q) ||
        tx.date.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Summary stats
  const totalDeposits = ALL_HISTORY.filter((t) => t.type === 'Deposit').length;
  const totalSwaps = ALL_HISTORY.filter((t) => t.type === 'Swap' || t.type === 'DCA Buy').length;
  const totalRewards = ALL_HISTORY.filter((t) => t.type === 'Reward')
    .reduce((s, t) => s + parseFloat(t.usd.replace(/[$,]/g, '')), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-bold text-[#111827]">Wallet History</h1>
        <p className="text-[15px] text-[#6B7280] mt-1">
          All your transactions, swaps, DCA buys, and rewards in one place.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Total Transactions</p>
          <p className="text-[28px] font-bold text-[#111827] mt-1">{ALL_HISTORY.length}</p>
        </div>
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Deposits & Swaps</p>
          <p className="text-[28px] font-bold text-[#111827] mt-1">{totalDeposits + totalSwaps}</p>
        </div>
        <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
          <p className="text-sm text-[#6B7280]">Total Rewards Earned</p>
          <p className="text-[28px] font-bold text-[#059669] mt-1">${totalRewards.toFixed(2)}</p>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-[360px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[#D6D9E3] bg-white py-2.5 pl-10 pr-4 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
          />
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-[#9CA3AF] mr-1" />
          <button
            onClick={() => setActiveFilter('All')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              activeFilter === 'All'
                ? 'bg-[#059669] text-white'
                : 'bg-white border border-[#D6D9E3] text-[#6B7280] hover:border-[#059669]'
            }`}
          >
            All
          </button>
          {FILTER_TYPES.map((type) => {
            const colors = TX_COLOR[type];
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(activeFilter === type ? 'All' : type)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  activeFilter === type
                    ? 'text-white'
                    : 'bg-white border border-[#D6D9E3] text-[#6B7280] hover:border-[#059669]'
                }`}
                style={activeFilter === type ? { backgroundColor: colors.text } : undefined}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Transaction table */}
      <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-[14px] p-5">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[13px] text-[#9CA3AF] border-b border-[#D6D9E3]">
                <th className="text-left font-medium pb-3 pr-4">Type</th>
                <th className="text-left font-medium pb-3 pr-4">Token</th>
                <th className="text-left font-medium pb-3 pr-4">Details</th>
                <th className="text-right font-medium pb-3 pr-4">Amount</th>
                <th className="text-right font-medium pb-3 pr-4">Date</th>
                <th className="text-right font-medium pb-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#9CA3AF] text-sm">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const Icon = TX_ICON[tx.type];
                  const colors = TX_COLOR[tx.type];
                  const logo = getTokenLogo(tx.token);
                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-[#D6D9E3]/50 last:border-0 hover:bg-[#ECEEF4] transition-colors"
                    >
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: colors.bg }}
                          >
                            <Icon className="w-[18px] h-[18px]" color={colors.text} />
                          </div>
                          <span className="text-[14px] font-semibold text-[#111827]">{tx.type}</span>
                        </div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-2">
                          {logo && (
                            <img src={logo} alt={tx.token} className="w-5 h-5 rounded-full object-cover" />
                          )}
                          <span className="text-[13px] font-medium text-[#111827]">{tx.token}</span>
                        </div>
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className="text-[13px] text-[#374151]">{tx.amount}</span>
                      </td>
                      <td className="py-3.5 pr-4 text-right">
                        <span
                          className="text-[14px] font-semibold"
                          style={{
                            color: tx.type === 'Withdraw' ? '#E11D48'
                              : tx.type === 'Deposit' || tx.type === 'Reward' ? '#059669'
                              : '#111827',
                          }}
                        >
                          {tx.type === 'Withdraw' ? '-' : tx.type === 'Deposit' || tx.type === 'Reward' ? '+' : ''}{tx.usd}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 text-right">
                        <span className="text-[13px] text-[#6B7280]">{tx.date}</span>
                      </td>
                      <td className="py-3.5 text-right">
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E0F5EA] text-[#059669]">
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
