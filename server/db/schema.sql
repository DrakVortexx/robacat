-- Example PostgreSQL schema for Rob a Cat player data
-- Matches PlayerDocument / toSqlRows() in schema.js

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  username VARCHAR(20) NOT NULL UNIQUE,
  money BIGINT NOT NULL DEFAULT 0,
  rebirth INT NOT NULL DEFAULT 0,
  slot_count INT NOT NULL DEFAULT 8,
  active_server_id VARCHAR(64),
  data_version INT NOT NULL DEFAULT 1,
  position_x REAL,
  position_z REAL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS account_slots (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot_index SMALLINT NOT NULL,
  cat_type VARCHAR(32),
  cat_rebirth INT NOT NULL DEFAULT 0,
  pad_balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, slot_index)
);

CREATE TABLE IF NOT EXISTS account_cosmetics (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cosmetic_id VARCHAR(64) NOT NULL,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  acquired_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, cosmetic_id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts (LOWER(username));
