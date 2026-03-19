import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../monitoring/logger.js';

interface PerformanceSnapshot {
  timestamp: string;
  totalValueCc: number;
  holdings: { asset: string; amount: number; valueCc: number }[];
}

// In-memory performance history (per party)
const performanceHistory = new Map<string, PerformanceSnapshot[]>();
const MAX_SNAPSHOTS = 720; // ~30 days at 1 per hour

// ---------------------------------------------------------------------------
// File-based persistence — survives process restarts.
// Loaded on module init, saved after each snapshot recording.
// ---------------------------------------------------------------------------

const STATE_PATH = process.env.PERFORMANCE_STATE_PATH
  || (process.platform === 'win32'
    ? path.join(process.env.TEMP || 'C:\\Temp', 'roil-finance-performance.json')
    : '/tmp/roil-finance-performance.json');

async function savePerformanceState(): Promise<void> {
  try {
    const state: Record<string, PerformanceSnapshot[]> = {};
    for (const [party, history] of performanceHistory) {
      state[party] = history;
    }
    await writeFile(STATE_PATH, JSON.stringify(state), 'utf-8');
  } catch { /* best effort */ }
}

async function loadPerformanceState(): Promise<void> {
  try {
    const data = await readFile(STATE_PATH, 'utf-8');
    const state = JSON.parse(data) as Record<string, PerformanceSnapshot[]>;
    for (const [party, history] of Object.entries(state)) {
      performanceHistory.set(party, history);
    }
    logger.info(`Loaded performance state: ${performanceHistory.size} parties`, { component: 'performance-tracker' });
  } catch { /* file may not exist yet */ }
}

// Load on module init
void loadPerformanceState();

export function recordSnapshot(party: string, totalValueCc: number, holdings: { asset: string; amount: number; valueCc: number }[]): void {
  if (!performanceHistory.has(party)) {
    performanceHistory.set(party, []);
  }
  const history = performanceHistory.get(party)!;
  history.push({
    timestamp: new Date().toISOString(),
    totalValueCc,
    holdings,
  });
  // Trim old entries
  if (history.length > MAX_SNAPSHOTS) {
    history.splice(0, history.length - MAX_SNAPSHOTS);
  }
  logger.info('Performance snapshot recorded', { party, totalValueCc, snapshotCount: history.length });
  void savePerformanceState();
}

export function getPerformance(party: string, window?: '1h' | '24h' | '7d' | '30d'): PerformanceSnapshot[] {
  const history = performanceHistory.get(party) || [];
  if (!window) return history;

  const now = Date.now();
  const windowMs: Record<string, number> = {
    '1h': 3600000,
    '24h': 86400000,
    '7d': 604800000,
    '30d': 2592000000,
  };
  const cutoff = now - (windowMs[window] || 86400000);
  return history.filter(s => new Date(s.timestamp).getTime() >= cutoff);
}

export function getPerformanceSummary(party: string): {
  current: number;
  change24h: number;
  change7d: number;
  change30d: number;
  high30d: number;
  low30d: number;
} {
  const all = performanceHistory.get(party) || [];
  const current = all.length > 0 ? all[all.length - 1].totalValueCc : 0;

  const getValueAt = (msAgo: number): number => {
    const cutoff = Date.now() - msAgo;
    const older = all.filter(s => new Date(s.timestamp).getTime() <= cutoff);
    return older.length > 0 ? older[older.length - 1].totalValueCc : current;
  };

  const val24h = getValueAt(86400000);
  const val7d = getValueAt(604800000);
  const val30d = getValueAt(2592000000);

  const last30d = getPerformance(party, '30d');
  const values30d = last30d.map(s => s.totalValueCc);

  return {
    current,
    change24h: val24h > 0 ? ((current - val24h) / val24h) * 100 : 0,
    change7d: val7d > 0 ? ((current - val7d) / val7d) * 100 : 0,
    change30d: val30d > 0 ? ((current - val30d) / val30d) * 100 : 0,
    high30d: values30d.length > 0 ? Math.max(...values30d) : current,
    low30d: values30d.length > 0 ? Math.min(...values30d) : current,
  };
}
