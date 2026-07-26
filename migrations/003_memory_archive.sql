CREATE TABLE IF NOT EXISTS memory_archive (
  id               TEXT NOT NULL,
  owner_id         TEXT NOT NULL,
  scope_key        TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('observation', 'stored')),
  content          TEXT NOT NULL,
  token_estimate   INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL,
  last_recalled_at TIMESTAMPTZ,
  topic            TEXT,
  retired_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  disposition      TEXT NOT NULL CHECK (disposition IN ('superseded', 'capacity', 'noise')),
  superseded_by    JSONB,
  PRIMARY KEY (owner_id, id),
  CHECK ((disposition = 'superseded') = (superseded_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_memory_archive_scope ON memory_archive (owner_id, scope_key);
CREATE INDEX IF NOT EXISTS idx_memory_archive_disposition ON memory_archive (owner_id, disposition);
