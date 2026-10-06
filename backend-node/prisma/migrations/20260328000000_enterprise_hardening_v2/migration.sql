-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_user_id_fkey";

-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "positions" DROP CONSTRAINT "positions_ticker_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_workspace_id_fkey";

-- AlterTable
ALTER TABLE "balance_sheet_items" ADD COLUMN     "deposit_beta" DECIMAL(8,6),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "rate" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "duration" SET DATA TYPE DECIMAL(8,4);

-- AlterTable
ALTER TABLE "board_reports" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "camel_composite" SET DATA TYPE DECIMAL(6,2),
ALTER COLUMN "nim_snapshot" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "lcr_snapshot" SET DATA TYPE DECIMAL(10,6);

-- AlterTable
ALTER TABLE "cecl_vintage_allowances" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "base_allowance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "adverse_allowance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "severe_allowance" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "concentration_limits" ALTER COLUMN "max_pct" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "current_pct" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "current_balance" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "cooperativa_benchmarks" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "total_assets_median" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "capital_ratio_median" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "loan_to_share_median" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "liquidity_ratio_median" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "nii_margin_median" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "asset_growth_yoy" SET DATA TYPE DECIMAL(10,6);

-- AlterTable
ALTER TABLE "data_deletion_requests" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "demo_requests" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "deposit_tiers" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "insured_pct" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "flight_rate" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "avg_rate" SET DATA TYPE DECIMAL(8,6);

-- AlterTable
ALTER TABLE "email_sequences" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "ingestion_logs" ALTER COLUMN "total_assets" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "total_liabilities" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "institution_alerts" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "institutions" ALTER COLUMN "total_assets" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "interest_rate_scenarios" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "ni_impact" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "mve_impact" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "duration" SET DATA TYPE DECIMAL(8,4);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "irr_policy_limits" ALTER COLUMN "watch_pct" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "warning_pct" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "breach_pct" SET DATA TYPE DECIMAL(8,6);

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "revenue_amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "liquidity_positions" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "hqla_level1" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "hqla_level2" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "cash_outflows" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "cash_inflows" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "lcr" SET DATA TYPE DECIMAL(10,6),
ALTER COLUMN "nsfr" SET DATA TYPE DECIMAL(10,6);

-- AlterTable
ALTER TABLE "loan_cohorts" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "original_balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "current_balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "defaults" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "loan_segments" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "weighted_avg_rate" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "weighted_avg_maturity" SET DATA TYPE DECIMAL(8,4),
ALTER COLUMN "historical_loss_rate" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "lgd" SET DATA TYPE DECIMAL(8,6),
ALTER COLUMN "qualitative_adj" SET DATA TYPE DECIMAL(8,6);

-- AlterTable
ALTER TABLE "magic_links" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "market_prices" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "password_reset_tokens" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pipeline_runs" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "policy_breach_logs" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "actual_value" SET DATA TYPE DECIMAL(18,6),
ALTER COLUMN "limit_value" SET DATA TYPE DECIMAL(18,6);

-- AlterTable
ALTER TABLE "positions" ALTER COLUMN "ticker" DROP NOT NULL;

-- AlterTable
ALTER TABLE "prospect_analyses" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "total_assets" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "prospect_institutions" ALTER COLUMN "estimated_assets" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "prospects" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "regulatory_publications" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "report_jobs" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "resellers" ALTER COLUMN "revenue_share_pct" SET DATA TYPE DECIMAL(8,6);

-- AlterTable
ALTER TABLE "tickers" ALTER COLUMN "market_cap" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "uploads" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "usage_meter_events" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "webhook_subscriptions" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- AlterTable
ALTER TABLE "yield_curves" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "board_reports_report_month_idx" ON "board_reports"("report_month");

-- CreateIndex
CREATE UNIQUE INDEX "board_reports_institution_id_report_month_key" ON "board_reports"("institution_id", "report_month");

-- CreateIndex
CREATE INDEX "data_deletion_requests_status_idx" ON "data_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "data_deletion_requests_requested_by_idx" ON "data_deletion_requests"("requested_by");

-- CreateIndex
CREATE INDEX "demo_requests_email_idx" ON "demo_requests"("email");

-- CreateIndex
CREATE INDEX "demo_requests_created_at_idx" ON "demo_requests"("created_at");

-- CreateIndex
CREATE INDEX "expenses_transaction_date_idx" ON "expenses"("transaction_date");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_review_status_idx" ON "expenses"("review_status");

-- CreateIndex
CREATE INDEX "feedback_job_id_idx" ON "feedback"("job_id");

-- CreateIndex
CREATE INDEX "institution_alerts_publication_id_idx" ON "institution_alerts"("publication_id");

-- CreateIndex
CREATE INDEX "institutions_type_idx" ON "institutions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "liquidity_positions_institution_id_date_key" ON "liquidity_positions"("institution_id", "date");

-- CreateIndex
CREATE INDEX "loan_cohorts_loan_type_idx" ON "loan_cohorts"("loan_type");

-- CreateIndex
CREATE INDEX "magic_links_user_id_idx" ON "magic_links"("user_id");

-- CreateIndex
CREATE INDEX "magic_links_expires_at_idx" ON "magic_links"("expires_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs"("status");

-- CreateIndex
CREATE INDEX "pipeline_runs_started_at_idx" ON "pipeline_runs"("started_at");

-- CreateIndex
CREATE INDEX "portfolios_user_id_idx" ON "portfolios"("user_id");

-- CreateIndex
CREATE INDEX "positions_ticker_idx" ON "positions"("ticker");

-- CreateIndex
CREATE INDEX "prospect_analyses_status_idx" ON "prospect_analyses"("status");

-- CreateIndex
CREATE INDEX "prospect_analyses_overall_risk_idx" ON "prospect_analyses"("overall_risk");

-- CreateIndex
CREATE INDEX "prospects_email_idx" ON "prospects"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "report_jobs_created_at_idx" ON "report_jobs"("created_at");

-- CreateIndex
CREATE INDEX "reports_workspace_id_idx" ON "reports"("workspace_id");

-- CreateIndex
CREATE INDEX "uploads_workspace_id_idx" ON "uploads"("workspace_id");

-- CreateIndex
CREATE INDEX "usage_meter_events_billed_at_idx" ON "usage_meter_events"("billed_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_is_active_idx" ON "webhook_subscriptions"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_subscriptions_institution_id_url_key" ON "webhook_subscriptions"("institution_id", "url");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_ticker_fkey" FOREIGN KEY ("ticker") REFERENCES "tickers"("ticker") ON DELETE SET NULL ON UPDATE CASCADE;

