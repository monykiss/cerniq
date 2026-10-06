-- Idempotent institution seeding: stable key for the fixture-based seed pipeline.
-- Real-world institutions leave seed_key NULL; only the seeder populates it. The unique
-- constraint lets `POST /institutions/seed` re-run safely between sessions and produce
-- the same institution row instead of duplicating.

-- 1. Add the nullable seed_key column.
ALTER TABLE "institutions"
  ADD COLUMN IF NOT EXISTS "seed_key" TEXT;

-- 2. Composite uniqueness on (workspace_id, seed_key). Postgres treats NULLs as distinct
--    by default, so non-seeded institutions remain unconstrained — only seeded rows
--    collide on re-seed and trigger the upsert path.
CREATE UNIQUE INDEX IF NOT EXISTS "institutions_workspace_id_seed_key_key"
  ON "institutions" ("workspace_id", "seed_key");
