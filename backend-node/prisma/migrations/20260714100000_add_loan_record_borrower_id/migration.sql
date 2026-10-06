-- W2.2 — single-borrower concentration prerequisite.
-- Adds an optional borrower/relationship key to loan_records so multiple loans
-- can aggregate to one obligor. Nullable and NEVER imputed (a null borrower is
-- excluded from single-borrower aggregation, not treated as its own borrower —
-- which would understate concentration). Append-only, idempotent — never edit
-- after apply.

ALTER TABLE "loan_records" ADD COLUMN IF NOT EXISTS "borrower_id" TEXT;

CREATE INDEX IF NOT EXISTS "loan_records_institution_id_as_of_date_borrower_id_idx"
  ON "loan_records"("institution_id", "as_of_date", "borrower_id");
