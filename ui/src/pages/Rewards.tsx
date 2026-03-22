import { Share2, Award, Crown, Gem } from 'lucide-react';

const TIER_DATA = [
  {
    name: 'Bronze',
    icon: Award,
    txReq: '0+',
    rebate: '0.5%',
    iconBg: 'bg-[#FEF3C7]',
    iconColor: 'text-[#92400E]',
    cardBg: 'bg-[#F3F4F9]',
    active: false,
  },
  {
    name: 'Silver',
    icon: Award,
    txReq: '50+',
    rebate: '1.0%',
    iconBg: 'bg-[#F1F5F9]',
    iconColor: 'text-[#64748B]',
    cardBg: 'bg-[#F3F4F9]',
    active: false,
  },
  {
    name: 'Gold',
    icon: Crown,
    txReq: '200+',
    rebate: '2.0%',
    iconBg: 'bg-[#FEF3C7]',
    iconColor: 'text-[#D97706]',
    cardBg: 'bg-[#FFFBEB]',
    active: true,
  },
  {
    name: 'Platinum',
    icon: Gem,
    txReq: '500+',
    rebate: '3.0%',
    iconBg: 'bg-[#EDE9FE]',
    iconColor: 'text-[#7C3AED]',
    cardBg: 'bg-[#F3F4F9]',
    active: false,
  },
] as const;

const PAYOUT_HISTORY = [
  { date: 'Mar 18, 2026', amount: '$643.40', type: 'Fee Rebate' },
  { date: 'Mar 2, 2025', amount: '$148.20', type: 'Fee Rebate' },
] as const;


export default function Rewards() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[26px] font-bold text-ink">Rewards</h2>
          <p className="text-base text-ink-muted mt-0.5">
            Earn fee rebates based on your transaction activity
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-ink/20 text-ink font-medium text-sm hover:bg-surface-hover transition-colors">
          <Share2 className="w-4 h-4" />
          Invite and Earn
        </button>
      </div>

      {/* Gold Hero Card */}
      <div className="bg-gradient-to-br from-[#D97706] to-[#F59E0B] rounded-2xl p-6 shadow flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="inline-block px-3 py-1 rounded-full bg-white/30 text-white text-xs font-medium">
            Current Tier
          </span>
          <h3 className="text-[36px] font-[800] text-white mt-2 leading-tight">GOLD</h3>
          <p className="text-white/80 text-sm mt-1">2.0% fee rebate</p>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white text-sm font-medium">312/500 transactions</span>
              <span className="text-white text-sm">Next: Platinum</span>
            </div>
            <div className="h-2 rounded-full bg-white/30 overflow-hidden">
              <div className="h-full rounded-full bg-white" style={{ width: '62%' }} />
            </div>
          </div>
        </div>

        <div className="text-right ml-8 shrink-0">
          <p className="text-[32px] font-[800] text-white">$1,248</p>
          <p className="text-white/80 text-sm">Lifetime Earnings</p>
        </div>
      </div>

      {/* 4 Tier Cards */}
      <div className="grid grid-cols-4 gap-3.5">
        {TIER_DATA.map((tier) => {
          const Icon = tier.icon;
          return (
            <div
              key={tier.name}
              className={`rounded-xl p-4 relative ${tier.cardBg} ${
                tier.active
                  ? 'border-2 border-[#F59E0B] shadow'
                  : tier.name === 'Platinum'
                    ? 'opacity-60'
                    : ''
              }`}
            >
              <div className={`w-10 h-10 rounded-lg ${tier.iconBg} flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${tier.iconColor}`} />
              </div>
              <h4 className="text-base font-semibold text-ink">{tier.name}</h4>
              <p className="text-sm text-ink-muted mt-0.5">{tier.txReq} txs</p>
              <p className="text-[18px] font-bold text-ink mt-2">{tier.rebate}</p>
              {tier.active && (
                <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-[#D97706] text-white text-xs font-medium">
                  You are here
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Payout History */}
      <div className="bg-[#F3F4F9] border border-[#D6D9E3] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-ink">Payout History</h3>
          <button className="text-sm font-medium text-accent hover:underline">
            View All
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-sm text-ink-muted border-b border-surface-border">
                <th className="text-left font-medium pb-2 pr-4">Date</th>
                <th className="text-left font-medium pb-2 pr-4">Amount</th>
                <th className="text-left font-medium pb-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {PAYOUT_HISTORY.map((row) => (
                <tr
                  key={row.date}
                  className="border-b border-surface-border/50 last:border-0 hover:bg-surface-hover transition-colors"
                >
                  <td className="py-3 pr-4">
                    <span className="text-sm text-ink">{row.date}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-sm font-semibold text-[#059669]">{row.amount}</span>
                  </td>
                  <td className="py-3">
                    <span className="text-sm text-ink-secondary">{row.type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
