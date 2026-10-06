-- Track A: COSSEC registry fields on prospect_institutions for Anejo 9 upsert
ALTER TABLE "prospect_institutions" ADD COLUMN IF NOT EXISTS "member_count" INTEGER;
ALTER TABLE "prospect_institutions" ADD COLUMN IF NOT EXISTS "employee_count" INTEGER;
ALTER TABLE "prospect_institutions" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "prospect_institutions" ADD COLUMN IF NOT EXISTS "icp_tier" TEXT;

-- Unique COSSEC/NCUA charter for idempotent registry upsert (multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_institutions_public_data_identifier_key"
  ON "prospect_institutions" ("public_data_identifier");
