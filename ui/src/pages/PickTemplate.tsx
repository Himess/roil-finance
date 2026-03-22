import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { TOKEN_LOGOS } from '@/config';

const TOKEN_COLORS: Record<string, string> = {
  CC: '#059669', USDCx: '#06B6D4', CBTC: '#F59E0B', ETHx: '#6366F1',
  SOLx: '#9333EA', XAUt: '#D97706', XAGt: '#94A3B8', USTb: '#1E3A5F', MMF: '#059669',
};

interface Allocation { symbol: string; pct: number; }
interface Strategy {
  id: string; name: string; description: string; image: string; allocations: Allocation[];
}

const STRATEGIES: Strategy[] = [
  { id: 'conservative', name: 'Conservative', description: 'Low-risk stable portfolio', image: '/strategies/conservative.png',
    allocations: [{ symbol: 'USDCx', pct: 40 }, { symbol: 'XAUt', pct: 30 }, { symbol: 'CC', pct: 20 }, { symbol: 'CBTC', pct: 10 }] },
  { id: 'balanced', name: 'Balanced', description: 'Mix of growth and stability', image: '/strategies/balanced.png',
    allocations: [{ symbol: 'CBTC', pct: 30 }, { symbol: 'CC', pct: 25 }, { symbol: 'USDCx', pct: 20 }, { symbol: 'ETHx', pct: 15 }, { symbol: 'XAUt', pct: 10 }] },
  { id: 'growth', name: 'Growth', description: 'High-growth asset allocation', image: '/strategies/growth.png',
    allocations: [{ symbol: 'CBTC', pct: 35 }, { symbol: 'ETHx', pct: 30 }, { symbol: 'SOLx', pct: 20 }, { symbol: 'CC', pct: 15 }] },
  { id: 'defi-yield', name: 'DeFi Yield', description: 'Maximize DeFi returns', image: '/strategies/defi_yield.png',
    allocations: [{ symbol: 'CC', pct: 30 }, { symbol: 'ETHx', pct: 25 }, { symbol: 'SOLx', pct: 25 }, { symbol: 'USDCx', pct: 20 }] },
  { id: 'stablecoin', name: 'Stablecoin', description: 'Stable value preservation', image: '/strategies/stablecoin.png',
    allocations: [{ symbol: 'USDCx', pct: 50 }, { symbol: 'USTb', pct: 30 }, { symbol: 'MMF', pct: 20 }] },
  { id: 'rwa', name: 'RWA', description: 'Real-world asset exposure', image: '/strategies/rwa.png',
    allocations: [{ symbol: 'XAUt', pct: 40 }, { symbol: 'XAGt', pct: 30 }, { symbol: 'USTb', pct: 20 }, { symbol: 'USDCx', pct: 10 }] },
];

function StrategyCard({ strategy, onSelect }: { strategy: Strategy; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="flex flex-col rounded-[16px] overflow-hidden text-left cursor-pointer transition-all hover:shadow-md"
      style={{ backgroundColor: '#F3F4F9', border: '1px solid #D6D9E3', boxShadow: '0 2px 8px #0000000A' }}
    >
      <div className="w-full h-[130px] flex items-center justify-center" style={{ backgroundColor: '#E8EBF0' }}>
        <img src={strategy.image} alt={strategy.name} className="h-full object-contain" />
      </div>
      <div className="p-4 flex flex-col gap-[6px] flex-1">
        <h3 className="text-[24px] font-bold" style={{ color: '#111827' }}>{strategy.name}</h3>
        <p className="text-[17px]" style={{ color: '#6B7280' }}>{strategy.description}</p>
        <div className="flex flex-col gap-[8px] mt-3">
          {strategy.allocations.map((a) => (
            <div key={a.symbol} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src={TOKEN_LOGOS[a.symbol]} alt={a.symbol} className="w-[22px] h-[22px] rounded-full" />
                <span className="text-[16px] font-medium" style={{ color: '#374151' }}>{a.symbol}</span>
              </div>
              <span className="text-[16px] font-bold" style={{ color: TOKEN_COLORS[a.symbol] || '#111827' }}>{a.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

export default function PickTemplate() {
  const navigate = useNavigate();

  const handleSelect = (strategy: Strategy) => {
    navigate('/create/build', { state: { allocations: strategy.allocations, templateName: strategy.name } });
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-semibold" style={{ color: '#059669' }}>Step 1 of 5</p>
          <h1 className="text-[31px] font-bold" style={{ color: '#111827', letterSpacing: '-1px' }}>Pick a Template</h1>
          <p className="text-[16px]" style={{ color: '#6B7280' }}>Select a pre-built portfolio strategy. You can customize it later.</p>
        </div>
        <Link to="/create" className="flex items-center gap-[6px] px-5 py-[10px] rounded-[10px] border" style={{ borderColor: '#D6D9E3', color: '#6B7280' }}>
          <ArrowLeft size={18} />
          <span className="text-[14px] font-medium">Back</span>
        </Link>
      </div>

      {/* Progress bar */}
      <div className="flex gap-2 mb-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-1 h-1 rounded-full" style={{ backgroundColor: i < 1 ? '#059669' : '#D6D9E3' }} />
        ))}
      </div>

      {/* Strategy grid */}
      <div className="grid grid-cols-3 gap-4 flex-1">
        {STRATEGIES.slice(0, 3).map((s) => (
          <StrategyCard key={s.id} strategy={s} onSelect={() => handleSelect(s)} />
        ))}
        {STRATEGIES.slice(3).map((s) => (
          <StrategyCard key={s.id} strategy={s} onSelect={() => handleSelect(s)} />
        ))}

        {/* Custom card */}
        <button onClick={() => navigate('/create/build')} className="flex flex-col items-center justify-center rounded-[16px] cursor-pointer transition-all hover:shadow-md" style={{ backgroundColor: '#F3F4F9', border: '1px dashed #D6D9E3' }}>
          <div className="w-[54px] h-[54px] rounded-full flex items-center justify-center" style={{ backgroundColor: '#ECFDF5' }}>
            <Plus size={26} style={{ color: '#059669' }} />
          </div>
          <span className="text-[21px] font-bold mt-3" style={{ color: '#111827' }}>Build from scratch</span>
          <span className="text-[16px] text-center px-3" style={{ color: '#9CA3AF' }}>Create your own custom allocation</span>
        </button>
      </div>
    </div>
  );
}
