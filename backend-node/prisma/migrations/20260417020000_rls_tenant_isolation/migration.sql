-- ============================================================================
-- Row-Level Security (RLS) — Multi-Tenant Isolation
-- ============================================================================
-- CERNIQ Supreme Engineering Bible §11: Database-level tenant isolation.
--
-- Every table that carries an institution_id column gets two RLS policies:
--   1. tenant_isolation_*  – rows visible only when app.current_institution_id
--                            matches the row's institution_id.
--   2. admin_bypass_*      – superuser/admin escape hatch controlled by
--                            app.admin_mode session variable.
--
-- The audit_logs table additionally receives RESTRICTIVE policies that block
-- UPDATE and DELETE, enforcing append-only semantics for compliance.
--
-- The middleware (tenant-context.middleware.ts) sets these GUC variables via
-- SET LOCAL inside the transaction opened by Prisma, so they are
-- automatically scoped to the current request and cleared on commit/rollback.
--
-- IDEMPOTENCY: every CREATE POLICY is preceded by DROP POLICY IF EXISTS
-- so re-running this migration against a DB that already has the policies
-- (e.g. an env where SQL was applied manually before Prisma picked it up)
-- will not fail with "policy already exists". ALTER TABLE ... ENABLE RLS is
-- already idempotent in Postgres.
--
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. balance_sheet_items
-- ---------------------------------------------------------------------------
ALTER TABLE "balance_sheet_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_balance_sheet_items ON "balance_sheet_items";
CREATE POLICY tenant_isolation_balance_sheet_items
  ON "balance_sheet_items" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_balance_sheet_items ON "balance_sheet_items";
CREATE POLICY admin_bypass_balance_sheet_items
  ON "balance_sheet_items" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 2. interest_rate_scenarios
-- ---------------------------------------------------------------------------
ALTER TABLE "interest_rate_scenarios" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_interest_rate_scenarios ON "interest_rate_scenarios";
CREATE POLICY tenant_isolation_interest_rate_scenarios
  ON "interest_rate_scenarios" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_interest_rate_scenarios ON "interest_rate_scenarios";
CREATE POLICY admin_bypass_interest_rate_scenarios
  ON "interest_rate_scenarios" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 3. liquidity_positions
-- ---------------------------------------------------------------------------
ALTER TABLE "liquidity_positions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_liquidity_positions ON "liquidity_positions";
CREATE POLICY tenant_isolation_liquidity_positions
  ON "liquidity_positions" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_liquidity_positions ON "liquidity_positions";
CREATE POLICY admin_bypass_liquidity_positions
  ON "liquidity_positions" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 4. saved_scenarios
-- ---------------------------------------------------------------------------
ALTER TABLE "saved_scenarios" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_saved_scenarios ON "saved_scenarios";
CREATE POLICY tenant_isolation_saved_scenarios
  ON "saved_scenarios" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_saved_scenarios ON "saved_scenarios";
CREATE POLICY admin_bypass_saved_scenarios
  ON "saved_scenarios" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 5. yield_curves
-- ---------------------------------------------------------------------------
ALTER TABLE "yield_curves" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_yield_curves ON "yield_curves";
CREATE POLICY tenant_isolation_yield_curves
  ON "yield_curves" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_yield_curves ON "yield_curves";
CREATE POLICY admin_bypass_yield_curves
  ON "yield_curves" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 6. loan_segments
-- ---------------------------------------------------------------------------
ALTER TABLE "loan_segments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_loan_segments ON "loan_segments";
CREATE POLICY tenant_isolation_loan_segments
  ON "loan_segments" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_loan_segments ON "loan_segments";
CREATE POLICY admin_bypass_loan_segments
  ON "loan_segments" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 7. deposit_tiers
-- ---------------------------------------------------------------------------
ALTER TABLE "deposit_tiers" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_deposit_tiers ON "deposit_tiers";
CREATE POLICY tenant_isolation_deposit_tiers
  ON "deposit_tiers" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_deposit_tiers ON "deposit_tiers";
CREATE POLICY admin_bypass_deposit_tiers
  ON "deposit_tiers" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 8. concentration_limits
-- ---------------------------------------------------------------------------
ALTER TABLE "concentration_limits" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_concentration_limits ON "concentration_limits";
CREATE POLICY tenant_isolation_concentration_limits
  ON "concentration_limits" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_concentration_limits ON "concentration_limits";
CREATE POLICY admin_bypass_concentration_limits
  ON "concentration_limits" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 9. loan_cohorts
-- ---------------------------------------------------------------------------
ALTER TABLE "loan_cohorts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_loan_cohorts ON "loan_cohorts";
CREATE POLICY tenant_isolation_loan_cohorts
  ON "loan_cohorts" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_loan_cohorts ON "loan_cohorts";
CREATE POLICY admin_bypass_loan_cohorts
  ON "loan_cohorts" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 10. cecl_vintage_allowances
-- ---------------------------------------------------------------------------
ALTER TABLE "cecl_vintage_allowances" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_cecl_vintage_allowances ON "cecl_vintage_allowances";
CREATE POLICY tenant_isolation_cecl_vintage_allowances
  ON "cecl_vintage_allowances" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_cecl_vintage_allowances ON "cecl_vintage_allowances";
CREATE POLICY admin_bypass_cecl_vintage_allowances
  ON "cecl_vintage_allowances" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 11. irr_policy_limits
-- ---------------------------------------------------------------------------
ALTER TABLE "irr_policy_limits" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_irr_policy_limits ON "irr_policy_limits";
CREATE POLICY tenant_isolation_irr_policy_limits
  ON "irr_policy_limits" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_irr_policy_limits ON "irr_policy_limits";
CREATE POLICY admin_bypass_irr_policy_limits
  ON "irr_policy_limits" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 12. policy_breach_logs
-- ---------------------------------------------------------------------------
ALTER TABLE "policy_breach_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy_breach_logs ON "policy_breach_logs";
CREATE POLICY tenant_isolation_policy_breach_logs
  ON "policy_breach_logs" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_policy_breach_logs ON "policy_breach_logs";
CREATE POLICY admin_bypass_policy_breach_logs
  ON "policy_breach_logs" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 13. column_mapping_memories
-- ---------------------------------------------------------------------------
ALTER TABLE "column_mapping_memories" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_column_mapping_memories ON "column_mapping_memories";
CREATE POLICY tenant_isolation_column_mapping_memories
  ON "column_mapping_memories" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_column_mapping_memories ON "column_mapping_memories";
CREATE POLICY admin_bypass_column_mapping_memories
  ON "column_mapping_memories" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 14. board_reports
-- ---------------------------------------------------------------------------
ALTER TABLE "board_reports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_board_reports ON "board_reports";
CREATE POLICY tenant_isolation_board_reports
  ON "board_reports" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_board_reports ON "board_reports";
CREATE POLICY admin_bypass_board_reports
  ON "board_reports" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 15. analysis_runs
-- ---------------------------------------------------------------------------
ALTER TABLE "analysis_runs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_analysis_runs ON "analysis_runs";
CREATE POLICY tenant_isolation_analysis_runs
  ON "analysis_runs" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_analysis_runs ON "analysis_runs";
CREATE POLICY admin_bypass_analysis_runs
  ON "analysis_runs" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 16. ingestion_logs (institution_id is nullable — NULL rows visible only to admins)
-- ---------------------------------------------------------------------------
ALTER TABLE "ingestion_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ingestion_logs ON "ingestion_logs";
CREATE POLICY tenant_isolation_ingestion_logs
  ON "ingestion_logs" FOR ALL
  USING (
    "institution_id" IS NOT NULL
    AND "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

DROP POLICY IF EXISTS admin_bypass_ingestion_logs ON "ingestion_logs";
CREATE POLICY admin_bypass_ingestion_logs
  ON "ingestion_logs" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 17. report_jobs (institution_id is nullable — NULL rows visible only to admins)
-- ---------------------------------------------------------------------------
ALTER TABLE "report_jobs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_report_jobs ON "report_jobs";
CREATE POLICY tenant_isolation_report_jobs
  ON "report_jobs" FOR ALL
  USING (
    "institution_id" IS NOT NULL
    AND "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

DROP POLICY IF EXISTS admin_bypass_report_jobs ON "report_jobs";
CREATE POLICY admin_bypass_report_jobs
  ON "report_jobs" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 18. audit_logs (institution_id is nullable — append-only enforcement)
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_audit_logs ON "audit_logs";
CREATE POLICY tenant_isolation_audit_logs
  ON "audit_logs" FOR ALL
  USING (
    "institution_id" IS NOT NULL
    AND "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

DROP POLICY IF EXISTS admin_bypass_audit_logs ON "audit_logs";
CREATE POLICY admin_bypass_audit_logs
  ON "audit_logs" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- Append-only: block UPDATE and DELETE even for matching tenants/admins
DROP POLICY IF EXISTS audit_append_only ON "audit_logs";
CREATE POLICY audit_append_only
  ON "audit_logs" AS RESTRICTIVE FOR UPDATE
  USING (FALSE);

DROP POLICY IF EXISTS audit_no_delete ON "audit_logs";
CREATE POLICY audit_no_delete
  ON "audit_logs" AS RESTRICTIVE FOR DELETE
  USING (FALSE);

-- ---------------------------------------------------------------------------
-- 19. feedback (institution_id is nullable)
-- ---------------------------------------------------------------------------
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_feedback ON "feedback";
CREATE POLICY tenant_isolation_feedback
  ON "feedback" FOR ALL
  USING (
    "institution_id" IS NOT NULL
    AND "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

DROP POLICY IF EXISTS admin_bypass_feedback ON "feedback";
CREATE POLICY admin_bypass_feedback
  ON "feedback" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 20. webhook_subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_webhook_subscriptions ON "webhook_subscriptions";
CREATE POLICY tenant_isolation_webhook_subscriptions
  ON "webhook_subscriptions" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_webhook_subscriptions ON "webhook_subscriptions";
CREATE POLICY admin_bypass_webhook_subscriptions
  ON "webhook_subscriptions" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 21. sso_configurations
-- ---------------------------------------------------------------------------
ALTER TABLE "sso_configurations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sso_configurations ON "sso_configurations";
CREATE POLICY tenant_isolation_sso_configurations
  ON "sso_configurations" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_sso_configurations ON "sso_configurations";
CREATE POLICY admin_bypass_sso_configurations
  ON "sso_configurations" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 22. usage_meter_events
-- ---------------------------------------------------------------------------
ALTER TABLE "usage_meter_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_usage_meter_events ON "usage_meter_events";
CREATE POLICY tenant_isolation_usage_meter_events
  ON "usage_meter_events" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_usage_meter_events ON "usage_meter_events";
CREATE POLICY admin_bypass_usage_meter_events
  ON "usage_meter_events" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 23. data_deletion_requests
-- ---------------------------------------------------------------------------
ALTER TABLE "data_deletion_requests" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_data_deletion_requests ON "data_deletion_requests";
CREATE POLICY tenant_isolation_data_deletion_requests
  ON "data_deletion_requests" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_data_deletion_requests ON "data_deletion_requests";
CREATE POLICY admin_bypass_data_deletion_requests
  ON "data_deletion_requests" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- ---------------------------------------------------------------------------
-- 24. institution_alerts
-- ---------------------------------------------------------------------------
ALTER TABLE "institution_alerts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_institution_alerts ON "institution_alerts";
CREATE POLICY tenant_isolation_institution_alerts
  ON "institution_alerts" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_institution_alerts ON "institution_alerts";
CREATE POLICY admin_bypass_institution_alerts
  ON "institution_alerts" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');
