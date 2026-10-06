-- Demo seat provisioning: lets sales spin up a portal experience for a prospect
-- using only public NCUA / COSSEC data, with a 14-day TTL.

-- 1. Add 'demo' tier to the SubscriptionTier enum (positioned between 'free' and 'one_time'
--    in the schema, but in Postgres enums we just append for backwards compat).
ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'demo';

-- 2. Extend prospect_institutions with demo provisioning columns.
ALTER TABLE "prospect_institutions"
  ADD COLUMN IF NOT EXISTS "public_data_identifier" TEXT,
  ADD COLUMN IF NOT EXISTS "demo_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "demo_report_job_id" TEXT,
  ADD COLUMN IF NOT EXISTS "demo_magic_link_url" TEXT,
  ADD COLUMN IF NOT EXISTS "demo_provisioned_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "demo_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "demo_last_viewed_at" TIMESTAMP(3);

-- 3. Indexes for demo-seat lookups (admin filtering, expiry sweeps).
CREATE INDEX IF NOT EXISTS "prospect_institutions_demo_user_id_idx"
  ON "prospect_institutions" ("demo_user_id");

CREATE INDEX IF NOT EXISTS "prospect_institutions_demo_expires_at_idx"
  ON "prospect_institutions" ("demo_expires_at");
