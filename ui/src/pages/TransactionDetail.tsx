import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, ArrowRightLeft, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '@/hooks/useApi';
import { useParty } from '@/context/PartyContext';

interface SwapLeg {
  fromAsset: { symbol: string; admin: string };
  toAsset: { symbol: string; admin: string };
  fromAmount: string;
  toAmount: string;
}

interface RebalanceDetail {
  id: string;
  type: string;
  status: string;
  timestamp: string;
  swapLegs: SwapLeg[];
  driftBefore: number;
  driftAfter: number;
  user?: string;
  currentHoldings?: unknown[];
  targetAllocations?: unknown[];
}

export default function TransactionDetail() {
  const { id } = useParams();
  const { party } = useParty();

  const { data, isLoading, error } = useQuery<RebalanceDetail>(
    id ? `/api/portfolio/${encodeURIComponent(id)}/rebalance-detail` : null,
    [id],
  );

  const statusIcon = (status: string) => {
    switch (status) {
      case 'Completed': return <CheckCircle className="w-5 h-5 text-positive" />;
      case 'Failed': return <XCircle className="w-5 h-5 text-negative" />;
      default: return <Clock className="w-5 h-5 text-warning" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-ink-secondary hover:text-ink transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-2xl font-bold text-ink">Transaction Detail</h2>
        </div>
        <div className="card p-6 flex items-center justify-center gap-3 text-ink-secondary">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading transaction details...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-ink-secondary hover:text-ink transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-2xl font-bold text-ink">Transaction Detail</h2>
        </div>
        <div className="card p-6 text-center">
          <p className="text-ink-secondary">
            {error ? `Error: ${error}` : 'Transaction data unavailable'}
          </p>
          <p className="text-base text-ink-secondary mt-2">Contract ID: {id}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-ink-secondary hover:text-ink transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-xl font-bold text-ink">Transaction Detail</h2>
      </div>

      {/* Summary card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {statusIcon(data.status)}
            <div>
              <h3 className="text-xl font-semibold text-ink">{data.type}</h3>
              <p className="text-sm text-ink-muted">
                {data.timestamp ? new Date(data.timestamp).toLocaleString() : 'N/A'}
              </p>
            </div>
          </div>
          <span className={clsx('px-3 py-1 rounded-full text-sm font-medium',
            data.status === 'Completed' ? 'bg-emerald-50 text-positive' :
            data.status === 'Failed' ? 'bg-red-50 text-negative' :
            'bg-amber-50 text-warning'
          )}>
            {data.status}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-sm text-ink-muted">Drift Before</p>
            <p className="text-xl font-semibold text-negative">{data.driftBefore.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-sm text-ink-muted">Drift After</p>
            <p className="text-xl font-semibold text-positive">{data.driftAfter.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-sm text-ink-muted">Swap Legs</p>
            <p className="text-xl font-semibold text-ink">{data.swapLegs.length}</p>
          </div>
          <div>
            <p className="text-sm text-ink-muted">Status</p>
            <p className="text-xl font-semibold text-ink">{data.status}</p>
          </div>
        </div>

        {data.swapLegs.length > 0 && (
          <>
            <h4 className="text-base font-medium text-ink-secondary mb-3">Swap Legs</h4>
            <div className="space-y-3">
              {data.swapLegs.map((leg, i) => (
                <div key={i} className="flex items-center gap-4 p-3 bg-surface-muted rounded-lg">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-base font-medium text-ink">
                      {parseFloat(String(leg.fromAmount)).toLocaleString()} {leg.fromAsset?.symbol || '?'}
                    </span>
                    <ArrowRightLeft className="w-4 h-4 text-ink-muted" />
                    <span className="text-base font-medium text-ink">
                      {parseFloat(String(leg.toAmount)).toLocaleString()} {leg.toAsset?.symbol || '?'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-sm text-ink-secondary text-center">
        Contract ID: {data.id}
      </p>
    </div>
  );
}
