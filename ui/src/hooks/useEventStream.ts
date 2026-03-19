import { useEffect, useRef } from 'react';
import { config } from '@/config';
import { useToast } from '@/components/Toast';

type EventHandler = (data: any) => void;

interface UseEventStreamOptions {
  party?: string;
  onRebalance?: EventHandler;
  onDCA?: EventHandler;
  onPortfolioUpdate?: EventHandler;
  enabled?: boolean;
}

/**
 * Subscribe to real-time Server-Sent Events from the Canton transaction stream.
 * Events are pushed when contracts are created/archived on the ledger.
 */
export function useEventStream({
  party,
  onRebalance,
  onDCA,
  onPortfolioUpdate,
  enabled = true,
}: UseEventStreamOptions) {
  const { addToast } = useToast();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!party || !enabled) return;

    const url = `${config.backendUrl}/api/portfolio/${encodeURIComponent(party)}/events`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      // Connected
    };

    source.addEventListener('rebalance', (e) => {
      try {
        const data = JSON.parse(e.data);
        onRebalance?.(data);
        // Check if notifications are enabled (from localStorage)
        const notificationsEnabled = localStorage.getItem('notifications') !== 'false';
        if (notificationsEnabled) {
          addToast('success', 'Portfolio rebalanced — ledger updated');
        }
      } catch { /* ignore parse errors */ }
    });

    source.addEventListener('dca', (e) => {
      try {
        const data = JSON.parse(e.data);
        onDCA?.(data);
        const notificationsEnabled = localStorage.getItem('notifications') !== 'false';
        if (notificationsEnabled) {
          addToast('info', 'DCA execution completed');
        }
      } catch { /* ignore */ }
    });

    source.addEventListener('portfolio', (e) => {
      try {
        const data = JSON.parse(e.data);
        onPortfolioUpdate?.(data);
      } catch { /* ignore */ }
    });

    source.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [party, enabled]); // Intentionally exclude callbacks to avoid reconnects
}
