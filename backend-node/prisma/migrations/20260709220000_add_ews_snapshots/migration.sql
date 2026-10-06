-- W1.3 — Early-Warning System persistence (watchlist: persist + trend + alert).
-- Persists AssetEWSService.computeEWS output: one row per institution per day
-- (idempotent daily capture), carrying the composite, the full indicator set,
-- the D1 gaps, and the trend/alerts vs the prior snapshot. Append-only,
-- idempotent (IF NOT EXISTS / OR REPLACE guards) — safe to re-run; never edit
-- after it is applied.

-- Alert-level enum (mirrors EWSResult.alertLevel including the D1 refusal).
DO $$ BEGIN
  CREATE TYPE "EwsAlertLevel" AS ENUM ('GREEN', 'YELLOW', 'RED', 'DATA_UNAVAILABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ews_snapshots" (
  "id"                TEXT NOT NULL,
  "institution_id"    TEXT NOT NULL,
  "snapshot_date"     DATE NOT NULL,
  "computed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "composite_score"   INTEGER,
  "alert_level"       "EwsAlertLevel" NOT NULL,
  "anomaly_score"     DOUBLE PRECISION,
  "measured_weight"   INTEGER NOT NULL,
  "indicators"        JSONB NOT NULL,
  "gaps"              JSONB,
  "source"            TEXT NOT NULL DEFAULT 'scheduled',
  "prior_snapshot_id" TEXT,
  "composite_delta"   INTEGER,
  "band_transition"   TEXT,
  "alerts_raised"     JSONB,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ews_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ews_snapshots_institution_id_snapshot_date_key"
  ON "ews_snapshots"("institution_id", "snapshot_date");

CREATE INDEX IF NOT EXISTS "ews_snapshots_institution_id_snapshot_date_idx"
  ON "ews_snapshots"("institution_id", "snapshot_date" DESC);

DO $$ BEGIN
  ALTER TABLE "ews_snapshots"
    ADD CONSTRAINT "ews_snapshots_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Row-Level Security — same two-policy pattern as 20260417020000 (Supreme
-- Engineering Bible §11): tenant isolation on institution_id + admin bypass.
-- tenant-context.middleware.ts sets the GUC variables per request.
-- ---------------------------------------------------------------------------
ALTER TABLE "ews_snapshots" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ews_snapshots ON "ews_snapshots";
CREATE POLICY tenant_isolation_ews_snapshots
  ON "ews_snapshots" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_ews_snapshots ON "ews_snapshots";
CREATE POLICY admin_bypass_ews_snapshots
  ON "ews_snapshots" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');
