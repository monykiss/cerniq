-- Demo → paid conversion attribution columns
-- Set by billing.service.closeConvertedDemoProspect when a demo user pays.
-- Powers DemoSeatAnalyticsService funnel metrics and the admin revenue view.

ALTER TABLE "prospect_institutions"
  ADD COLUMN IF NOT EXISTS "demo_converted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "demo_converted_amount_usd" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "demo_converted_to_tier" TEXT;

CREATE INDEX IF NOT EXISTS "prospect_institutions_demo_converted_at_idx"
  ON "prospect_institutions" ("demo_converted_at");
