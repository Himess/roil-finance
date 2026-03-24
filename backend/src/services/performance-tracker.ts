import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../monitoring/logger.js';
import * as db from '../db/index.js';

interface PerformanceSnapshot {
  timestamp: string;
  totalValueCc: number;
  holdings: { asset: string; amount: number; valueCc: number }[];
}

// In-memory performance history (per party) — used as fallback when DB is unavailable
const performanceHistory = new Map<string, PerformanceSnapshot[]>();
const MAX_SNAPSHOTS = 720; // ~30 days at 1 per hour

// ---------------------------------------------------------------------------
// File-based persistence — survives process restarts.
// Used only when DATABASE_URL is not configured. When Postgres is available,
// data goes directly to the performance_snapshots table.
// ---------------------------------------------------------------------------

const STATE_PATH = process.env.PERFORMANCE_STATE_PATH
  || (process.platform === 'win32'
    ? path.join(process.env.TEMP || 'C:\\Temp', 'roil-finance-performance.json')
    : '/tmp/roil-finance-performance.json');

async function savePerformanceState(): Promise<void> {
  if (db.isDbAvailable()) return; // Postgres handles persistence
  try {
    const state: Record<string, PerformanceSnapshot[]> = {};
    for (const [party, history] of performanceHistory) {
      state[party] = history;
    }
    await writeFile(STATE_PATH, JSON.stringify(state), 'utf-8');
  } catch { /* best effort */ }
}

async function loadPerformanceState(): Promise<void> {
  if (db.isDbAvailable()) return; // Will read from Postgres instead
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
  // Write to Postgres if available
  if (db.isDbAvailable()) {
    void db.insertSnapshot(party, totalValueCc, holdings).catch(() => {
      // Fallback to in-memory on write failure
      recordSnapshotInMemory(party, totalValueCc, holdings);
    });
    // Also keep latest in memory for fast reads
    recordSnapshotInMemory(party, totalValueCc, holdings);
    return;
  }

  // In-memory fallback
  recordSnapshotInMemory(party, totalValueCc, holdings);
}

function recordSnapshotInMemory(party: string, totalValueCc: number, holdings: { asset: string; amount: number; valueCc: number }[]): void {
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

export async function getPerformance(party: string, window?: '1h' | '24h' | '7d' | '30d'): Promise<PerformanceSnapshot[]> {
  const windowMs: Record<string, number> = {
    '1h': 3600000,
    '24h': 86400000,
    '7d': 604800000,
    '30d': 2592000000,
  };
  const sinceMs = window ? Date.now() - (windowMs[window] || 86400000) : undefined;

  // Try Postgres first
  if (db.isDbAvailable()) {
    const rows = await db.getSnapshots(party, sinceMs, MAX_SNAPSHOTS);
    if (rows.length > 0) {
      return rows.map(r => ({
        timestamp: r.created_at,
        totalValueCc: r.total_value,
        holdings: r.holdings,
      })).reverse(); // DB returns DESC, we want ASC
    }
  }

  // In-memory fallback
  const history = performanceHistory.get(party) || [];
  if (!window) return history;

  const cutoff = Date.now() - (windowMs[window] || 86400000);
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
  // Use in-memory data for summary (fast, synchronous)
  // The in-memory store is always populated alongside Postgres writes.
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

  const last30d = all.filter(s => new Date(s.timestamp).getTime() >= Date.now() - 2592000000);
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
