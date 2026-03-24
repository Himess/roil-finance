-- ---------------------------------------------------------------------------
-- Roil Finance — PostgreSQL schema
-- ---------------------------------------------------------------------------
-- Run once on a fresh database, or use the auto-migration in db/index.ts
-- which calls CREATE TABLE IF NOT EXISTS on startup.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------

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
