CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id               TEXT NOT NULL,
  owner_id         TEXT NOT NULL,
  scope_key        TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('observation', 'stored')),
  content          TEXT NOT NULL,
  token_estimate   INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_recalled_at TIMESTAMPTZ,
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories (owner_id, scope_key);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories (owner_id, kind);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id        TEXT NOT NULL,
  owner_id  TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  embedding vector(1536),
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_scope ON memory_embeddings (owner_id, scope_key);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT NOT NULL,
  owner_id         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  model            TEXT NOT NULL,
  title            TEXT NOT NULL DEFAULT '',
  workspace        TEXT,
  workspace_name   TEXT,
  workspace_branch TEXT,
  messages         JSONB NOT NULL DEFAULT '[]',
  token_usage      JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS active_sessions (
  owner_id   TEXT PRIMARY KEY,
  session_id TEXT
);
