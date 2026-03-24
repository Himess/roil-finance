// ---------------------------------------------------------------------------
// PostgreSQL database layer for Roil Finance
// ---------------------------------------------------------------------------
//
// Provides persistent storage for performance snapshots, compound configs,
// price history, and activity logs.
//
// Graceful fallback: if DATABASE_URL is not set, all functions silently
// return empty results and writes are no-ops. This allows the rest of the
// backend to use in-memory stores as before.
// ---------------------------------------------------------------------------

import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';

// ---------------------------------------------------------------------------
// Dynamic pg import
// ---------------------------------------------------------------------------
// We import `pg` dynamically so the module does not hard-crash when the
// pg package is not installed (e.g., in local dev without Postgres).
// ---------------------------------------------------------------------------

type PgPool = import('pg').Pool;

let pool: PgPool | null = null;
let _poolReady = false;

/** Whether the database layer is available. */
export function isDbAvailable(): boolean {
  return _poolReady;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the connection pool and create tables if they do not exist.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initDb(): Promise<void> {
  if (_poolReady || !config.databaseUrl) return;

  try {
    const pg = await import('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // Verify connectivity
    const client = await pool.connect();
    client.release();

    await createTablesIfNotExist();
    _poolReady = true;
    logger.info('PostgreSQL database connected', { component: 'db' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`PostgreSQL unavailable, using in-memory fallback: ${message}`, { component: 'db' });
    pool = null;
    _poolReady = false;
  }
}

/**
 * Gracefully close the connection pool.
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    _poolReady = false;
    logger.info('PostgreSQL connection pool closed', { component: 'db' });
  }
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

async function createTablesIfNotExist(): Promise<void> {
  if (!pool) return;

  const sql = `
    CREATE TABLE IF NOT EXISTS performance_snapshots (
      id            BIGSERIAL PRIMARY KEY,
      party         TEXT        NOT NULL,
      portfolio_id  TEXT        NOT NULL DEFAULT '',
      total_value   DOUBLE PRECISION NOT NULL,
      drift         DOUBLE PRECISION NOT NULL DEFAULT 0,
      holdings_json JSONB       NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_perf_party_created
      ON performance_snapshots (party, created_at DESC);

    CREATE TABLE IF NOT EXISTS compound_config (
      id                 BIGSERIAL PRIMARY KEY,
      party              TEXT    NOT NULL UNIQUE,
      enabled            BOOLEAN NOT NULL DEFAULT FALSE,
      min_amount         DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      frequency          TEXT    NOT NULL DEFAULT 'daily',
      reinvest_strategy  TEXT    NOT NULL DEFAULT 'portfolio-targets',
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_compound_party
      ON compound_config (party);

    CREATE TABLE IF NOT EXISTS price_history (
      id         BIGSERIAL PRIMARY KEY,
      asset      TEXT             NOT NULL,
      price      DOUBLE PRECISION NOT NULL,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      source     TEXT             NOT NULL DEFAULT 'cantex',
      created_at TIMESTAMPTZ      NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_price_asset_created
      ON price_history (asset, created_at DESC);

    CREATE TABLE IF NOT EXISTS activity_log (
      id            BIGSERIAL PRIMARY KEY,
      type          TEXT        NOT NULL,
      party         TEXT        NOT NULL DEFAULT '',
      description   TEXT        NOT NULL DEFAULT '',
      metadata_json JSONB       NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_activity_party_created
      ON activity_log (party, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_activity_type
      ON activity_log (type);
  `;

  await pool.query(sql);
}

// ---------------------------------------------------------------------------
// Performance snapshots
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  party: string;
  portfolio_id: string;
  total_value: number;
  drift: number;
  holdings: Array<{ asset: string; amount: number; valueCc: number }>;
  created_at: string;
}

export async function insertSnapshot(
  party: string,
  totalValue: number,
  holdings: Array<{ asset: string; amount: number; valueCc: number }>,
  portfolioId = '',
  drift = 0,
): Promise<void> {
  if (!pool || !_poolReady) return;

  try {
    await pool.query(
      `INSERT INTO performance_snapshots (party, portfolio_id, total_value, drift, holdings_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [party, portfolioId, totalValue, drift, JSON.stringify(holdings)],
    );
  } catch (err) {
    logger.warn('Failed to insert performance snapshot', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getSnapshots(
  party: string,
  sinceMs?: number,
  limit = 720,
): Promise<SnapshotRow[]> {
  if (!pool || !_poolReady) return [];

  try {
    let sql = `SELECT party, portfolio_id, total_value, drift, holdings_json, created_at
               FROM performance_snapshots
               WHERE party = $1`;
    const params: unknown[] = [party];

    if (sinceMs) {
      sql += ` AND created_at >= to_timestamp($2 / 1000.0)`;
      params.push(sinceMs);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    return result.rows.map((row: any) => ({
      party: row.party,
      portfolio_id: row.portfolio_id,
      total_value: Number(row.total_value),
      drift: Number(row.drift),
      holdings: typeof row.holdings_json === 'string'
        ? JSON.parse(row.holdings_json)
        : row.holdings_json,
      created_at: new Date(row.created_at).toISOString(),
    }));
  } catch (err) {
    logger.warn('Failed to query performance snapshots', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compound config
// ---------------------------------------------------------------------------

export interface CompoundConfigRow {
  party: string;
  enabled: boolean;
  min_amount: number;
  frequency: string;
  reinvest_strategy: string;
  updated_at: string;
}

export async function upsertCompoundConfig(
  party: string,
  enabled: boolean,
  minAmount: number,
  frequency: string,
  reinvestStrategy: string,
): Promise<void> {
  if (!pool || !_poolReady) return;

  try {
    await pool.query(
      `INSERT INTO compound_config (party, enabled, min_amount, frequency, reinvest_strategy, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (party) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         min_amount = EXCLUDED.min_amount,
         frequency = EXCLUDED.frequency,
         reinvest_strategy = EXCLUDED.reinvest_strategy,
         updated_at = NOW()`,
      [party, enabled, minAmount, frequency, reinvestStrategy],
    );
  } catch (err) {
    logger.warn('Failed to upsert compound config', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCompoundConfig(party: string): Promise<CompoundConfigRow | null> {
  if (!pool || !_poolReady) return null;

  try {
    const result = await pool.query(
      `SELECT party, enabled, min_amount, frequency, reinvest_strategy, updated_at
       FROM compound_config WHERE party = $1`,
      [party],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      party: row.party,
      enabled: Boolean(row.enabled),
      min_amount: Number(row.min_amount),
      frequency: row.frequency,
      reinvest_strategy: row.reinvest_strategy,
      updated_at: new Date(row.updated_at).toISOString(),
    };
  } catch (err) {
    logger.warn('Failed to query compound config', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function getAllCompoundConfigs(): Promise<CompoundConfigRow[]> {
  if (!pool || !_poolReady) return [];

  try {
    const result = await pool.query(
      `SELECT party, enabled, min_amount, frequency, reinvest_strategy, updated_at
       FROM compound_config`,
    );

    return result.rows.map((row: any) => ({
      party: row.party,
      enabled: Boolean(row.enabled),
      min_amount: Number(row.min_amount),
      frequency: row.frequency,
      reinvest_strategy: row.reinvest_strategy,
      updated_at: new Date(row.updated_at).toISOString(),
    }));
  } catch (err) {
    logger.warn('Failed to query all compound configs', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------

export interface PriceHistoryRow {
  asset: string;
  price: number;
  confidence: number;
  source: string;
  created_at: string;
}

export async function insertPriceHistory(
  asset: string,
  price: number,
  confidence = 1.0,
  source = 'cantex',
): Promise<void> {
  if (!pool || !_poolReady) return;

  try {
    await pool.query(
      `INSERT INTO price_history (asset, price, confidence, source) VALUES ($1, $2, $3, $4)`,
      [asset, price, confidence, source],
    );
  } catch (err) {
    logger.warn('Failed to insert price history', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getPriceHistory(
  asset: string,
  sinceMs?: number,
  limit = 1000,
): Promise<PriceHistoryRow[]> {
  if (!pool || !_poolReady) return [];

  try {
    let sql = `SELECT asset, price, confidence, source, created_at
               FROM price_history WHERE asset = $1`;
    const params: unknown[] = [asset];

    if (sinceMs) {
      sql += ` AND created_at >= to_timestamp($2 / 1000.0)`;
      params.push(sinceMs);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    return result.rows.map((row: any) => ({
      asset: row.asset,
      price: Number(row.price),
      confidence: Number(row.confidence),
      source: row.source,
      created_at: new Date(row.created_at).toISOString(),
    }));
  } catch (err) {
    logger.warn('Failed to query price history', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export interface ActivityLogRow {
  type: string;
  party: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function insertActivity(
  type: string,
  party: string,
  description: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!pool || !_poolReady) return;

  try {
    await pool.query(
      `INSERT INTO activity_log (type, party, description, metadata_json)
       VALUES ($1, $2, $3, $4)`,
      [type, party, description, JSON.stringify(metadata)],
    );
  } catch (err) {
    logger.warn('Failed to insert activity log', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getActivities(
  party?: string,
  type?: string,
  sinceMs?: number,
  limit = 100,
): Promise<ActivityLogRow[]> {
  if (!pool || !_poolReady) return [];

  try {
    let sql = `SELECT type, party, description, metadata_json, created_at FROM activity_log WHERE 1=1`;
    const params: unknown[] = [];

    if (party) {
      params.push(party);
      sql += ` AND party = $${params.length}`;
    }

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }

    if (sinceMs) {
      params.push(sinceMs);
      sql += ` AND created_at >= to_timestamp($${params.length} / 1000.0)`;
    }

    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await pool.query(sql, params);

    return result.rows.map((row: any) => ({
      type: row.type,
      party: row.party,
      description: row.description,
      metadata: typeof row.metadata_json === 'string'
        ? JSON.parse(row.metadata_json)
        : row.metadata_json,
      created_at: new Date(row.created_at).toISOString(),
    }));
  } catch (err) {
    logger.warn('Failed to query activity log', {
      component: 'db',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
