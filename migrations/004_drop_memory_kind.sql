-- How a memory came to be held stopped distinguishing anything once the CLI derived it rather than
-- storing it, so the column and the index that served its filter go with it. Apply only after the
-- deploy that stopped writing the column.
DROP INDEX IF EXISTS idx_memories_kind;

ALTER TABLE memories DROP COLUMN IF EXISTS kind;
ALTER TABLE memory_archive DROP COLUMN IF EXISTS kind;
