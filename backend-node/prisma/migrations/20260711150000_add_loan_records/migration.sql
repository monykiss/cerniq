-- W2.0 Slice 1 — loan-level ingestion (the Wave-2 Tier-B linchpin).
-- One row per loan per tape asOfDate; a tape upload transactionally replaces
-- the institution's records for that date. Every optional column is nullable
-- and nullability IS the missingness record (D1 — never impute; an imputed
-- municipio would silently corrupt W2.2 concentration metrics).
-- Append-only, idempotent (IF NOT EXISTS guards) — never edit after apply.

CREATE TABLE IF NOT EXISTS "loan_records" (
  "id"               TEXT NOT NULL,
  "institution_id"   TEXT NOT NULL,
  "as_of_date"       DATE NOT NULL,
  "external_loan_id" TEXT NOT NULL,
  "segment_name"     TEXT NOT NULL,
  "balance"          DECIMAL(18,2) NOT NULL,
  "rate"             DECIMAL(8,6),
  "origination_date" DATE,
  "maturity_date"    DATE,
  "collateral_type"  TEXT,
  "collateral_value" DECIMAL(18,2),
  "municipio"        TEXT,
  "delinquency_days" INTEGER,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "loan_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "loan_records_institution_id_as_of_date_external_loan_id_key"
  ON "loan_records"("institution_id", "as_of_date", "external_loan_id");

CREATE INDEX IF NOT EXISTS "loan_records_institution_id_as_of_date_idx"
  ON "loan_records"("institution_id", "as_of_date");

CREATE INDEX IF NOT EXISTS "loan_records_institution_id_municipio_idx"
  ON "loan_records"("institution_id", "municipio");

DO $$ BEGIN
  ALTER TABLE "loan_records"
    ADD CONSTRAINT "loan_records_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Row-Level Security — the two-policy pattern every institution-scoped table
-- ships with (20260417020000 / Supreme Engineering Bible §11).
-- ---------------------------------------------------------------------------
ALTER TABLE "loan_records" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_loan_records ON "loan_records";
CREATE POLICY tenant_isolation_loan_records
  ON "loan_records" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_loan_records ON "loan_records";
CREATE POLICY admin_bypass_loan_records
  ON "loan_records" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');
