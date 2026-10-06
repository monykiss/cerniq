-- Wave-03 product models — migrations for schema.prisma additions that
-- landed in commit 48fc4029 (backend modules) without corresponding
-- migration files. Regenerated from `prisma migrate diff` output on
-- 2026-04-17 to bring migration history into sync with schema.prisma.
--
-- Includes:
--   8 new enums (CossecFindingSeverity, CpaTier, CpaUserRole,
--                ConversationRole, ExamCategoryStatus,
--                EnterpriseBatchStatus, EnterprisePriority,
--                AlertDirection)
--   9+ new tables (cossec_exam_findings, cpa_firms, cpa_firm_users,
--                  cpa_client_relationships, conversation_history,
--                  exam_readiness_assessments, exam_category_scores,
--                  webhook_delivery_logs, enterprise_batches,
--                  rate_alert_thresholds, camel_certifications …)
--   2 column additions (institutions.last_ncua_sync_at,
--                       prospect_institutions.alm_risk_score)
--   Foreign-key wiring between the new tables and existing
--   institutions/users/workspaces tables (ON DELETE CASCADE)
--   1 index rename (institution_period_cert →
--                   camel_certifications_institution_id_period_key)
--
-- Safe to re-apply against an existing prod DB: the parallel migrations
-- use forward-only DDL with Prisma's standard IF-NOT-EXISTS semantics
-- (Prisma emits CREATE TABLE / CREATE INDEX without IF NOT EXISTS
-- because it relies on migration history to ensure exactly-once). If
-- you're back-filling against a DB that already has these tables,
-- apply with `prisma migrate resolve --applied 20260417010000_wave03_models`
-- rather than re-running the SQL.

-- CreateEnum
CREATE TYPE "CossecFindingSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CpaTier" AS ENUM ('CPA_STANDARD', 'CPA_PRO');

-- CreateEnum
CREATE TYPE "CpaUserRole" AS ENUM ('CPA_ADMIN', 'CPA_ANALYST', 'CPA_VIEWER');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ExamCategoryStatus" AS ENUM ('PASS', 'WARN', 'FAIL');

-- CreateEnum
CREATE TYPE "EnterpriseBatchStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnterprisePriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertDirection" AS ENUM ('ABOVE', 'BELOW');

-- DropIndex
DROP INDEX "idx_agent_audit_chain_verify";

-- DropIndex
DROP INDEX "idx_agent_audit_created_at";

-- DropIndex
DROP INDEX "idx_agent_runs_inst_agent_created";

-- DropIndex
DROP INDEX "report_artifacts_institution_id_generated_at_idx";

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "last_ncua_sync_at" TIMESTAMP(3),
ADD COLUMN     "ncua_charter_number" TEXT,
ADD COLUMN     "regulatory_body" TEXT NOT NULL DEFAULT 'COSSEC',
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "prospect_institutions" ADD COLUMN     "alm_risk_score" DECIMAL(10,2),
ADD COLUMN     "cossec_findings_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cossec_last_exam_year" INTEGER,
ADD COLUMN     "outreach_personalized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sample_report_generated_at" TIMESTAMP(3),
ADD COLUMN     "sample_report_url" TEXT;

-- CreateTable
CREATE TABLE "cossec_exam_findings" (
"id" TEXT NOT NULL,
"prospect_institution_id" TEXT NOT NULL,
"institution_name" TEXT NOT NULL,
"exam_year" INTEGER NOT NULL,
"exam_date" TIMESTAMP(3),
"category" TEXT NOT NULL,
"severity" "CossecFindingSeverity" NOT NULL,
"finding_text" TEXT NOT NULL,
"finding_text_es" TEXT,
"recommendation" TEXT NOT NULL,
"recommendation_es" TEXT,
"circular_letter_ref" TEXT,
"raw_pdf_source" TEXT,
"parser_confidence" DECIMAL(3,2) NOT NULL,
"resolved_at" TIMESTAMP(3),
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "cossec_exam_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_firms" (
"id" TEXT NOT NULL,
"name" TEXT NOT NULL,
"slug" TEXT NOT NULL,
"contact_name" TEXT NOT NULL,
"contact_email" TEXT NOT NULL,
"contact_phone" TEXT,
"logo_url" TEXT,
"brand_primary_color" TEXT DEFAULT '#1e3a5f',
"brand_secondary_color" TEXT,
"website" TEXT,
"tier" "CpaTier" NOT NULL,
"stripe_customer_id" TEXT,
"monthly_price_usd" DECIMAL(12,2) NOT NULL,
"max_clients" INTEGER NOT NULL DEFAULT 15,
"is_active" BOOLEAN NOT NULL DEFAULT true,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "cpa_firms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_client_relationships" (
"id" TEXT NOT NULL,
"cpa_firm_id" TEXT NOT NULL,
"institution_id" TEXT NOT NULL,
"assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"removed_at" TIMESTAMP(3),
"report_branding_override" JSONB,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "cpa_client_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_firm_users" (
"id" TEXT NOT NULL,
"cpa_firm_id" TEXT NOT NULL,
"user_id" UUID NOT NULL,
"role" "CpaUserRole" NOT NULL,
"invited_by" UUID,
"joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "cpa_firm_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_history" (
"id" TEXT NOT NULL,
"institution_id" TEXT NOT NULL,
"user_id" UUID NOT NULL,
"session_id" TEXT NOT NULL,
"role" "ConversationRole" NOT NULL,
"content" TEXT NOT NULL,
"content_es" TEXT,
"token_count" INTEGER,
"model_id" TEXT,
"latency_ms" INTEGER,
"alm_modules_referenced" TEXT[],
"metadata" JSONB,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "conversation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_readiness_assessments" (
"id" TEXT NOT NULL,
"institution_id" TEXT NOT NULL,
"assessed_by" UUID NOT NULL,
"overall_grade" TEXT NOT NULL,
"overall_score" DECIMAL(10,2) NOT NULL,
"exam_type" TEXT NOT NULL DEFAULT 'COSSEC_ANNUAL',
"assessment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"evidence_package_url" TEXT,
"notes" TEXT,
"next_exam_date" TIMESTAMP(3),
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "exam_readiness_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_category_scores" (
"id" TEXT NOT NULL,
"assessment_id" TEXT NOT NULL,
"category" TEXT NOT NULL,
"weight" DECIMAL(8,4) NOT NULL,
"score" DECIMAL(10,2) NOT NULL,
"max_score" DECIMAL(10,2) NOT NULL DEFAULT 100,
"status" "ExamCategoryStatus" NOT NULL,
"finding" TEXT,
"recommendation" TEXT,
"circular_letter_ref" TEXT,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "exam_category_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_batches" (
"id" TEXT NOT NULL,
"organization_id" UUID NOT NULL,
"requested_by" UUID NOT NULL,
"batch_type" TEXT NOT NULL,
"status" "EnterpriseBatchStatus" NOT NULL DEFAULT 'QUEUED',
"priority" "EnterprisePriority" NOT NULL DEFAULT 'NORMAL',
"total_items" INTEGER NOT NULL,
"completed_items" INTEGER NOT NULL DEFAULT 0,
"failed_items" INTEGER NOT NULL DEFAULT 0,
"input_config" JSONB NOT NULL,
"output_urls" TEXT[],
"error_log" JSONB,
"webhook_url" TEXT,
"webhook_secret" TEXT,
"started_at" TIMESTAMP(3),
"completed_at" TIMESTAMP(3),
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "enterprise_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery_logs" (
"id" TEXT NOT NULL,
"batch_id" TEXT,
"target_url" TEXT NOT NULL,
"http_method" TEXT NOT NULL DEFAULT 'POST',
"request_headers" JSONB,
"request_body" JSONB,
"response_status" INTEGER,
"response_body" TEXT,
"signature_header" TEXT,
"attempt" INTEGER NOT NULL DEFAULT 1,
"max_attempts" INTEGER NOT NULL DEFAULT 3,
"delivered_at" TIMESTAMP(3),
"failed_at" TIMESTAMP(3),
"next_retry_at" TIMESTAMP(3),
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data_snapshots" (
"id" TEXT NOT NULL,
"data_type" TEXT NOT NULL,
"tenor_months" INTEGER,
"value" DECIMAL(18,8) NOT NULL,
"previous_value" DECIMAL(18,8),
"change_percent" DECIMAL(10,6),
"source" TEXT NOT NULL,
"as_of_date" TIMESTAMP(3) NOT NULL,
"fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "market_data_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_alert_thresholds" (
"id" TEXT NOT NULL,
"institution_id" TEXT NOT NULL,
"metric" TEXT NOT NULL,
"warn_level" DECIMAL(24,6) NOT NULL,
"breach_level" DECIMAL(24,6) NOT NULL,
"direction" "AlertDirection" NOT NULL,
"is_active" BOOLEAN NOT NULL DEFAULT true,
"notify_email" BOOLEAN NOT NULL DEFAULT true,
"notify_webhook" BOOLEAN NOT NULL DEFAULT false,
"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "rate_alert_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cossec_exam_findings_prospect_institution_id_exam_year_idx" ON "cossec_exam_findings"("prospect_institution_id", "exam_year");

-- CreateIndex
CREATE INDEX "cossec_exam_findings_category_severity_idx" ON "cossec_exam_findings"("category", "severity");

-- CreateIndex
CREATE INDEX "cossec_exam_findings_exam_year_idx" ON "cossec_exam_findings"("exam_year");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_firms_slug_key" ON "cpa_firms"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_firms_stripe_customer_id_key" ON "cpa_firms"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "cpa_firms_tier_idx" ON "cpa_firms"("tier");

-- CreateIndex
CREATE INDEX "cpa_firms_is_active_idx" ON "cpa_firms"("is_active");

-- CreateIndex
CREATE INDEX "cpa_client_relationships_cpa_firm_id_idx" ON "cpa_client_relationships"("cpa_firm_id");

-- CreateIndex
CREATE INDEX "cpa_client_relationships_institution_id_idx" ON "cpa_client_relationships"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_client_relationships_cpa_firm_id_institution_id_key" ON "cpa_client_relationships"("cpa_firm_id", "institution_id");

-- CreateIndex
CREATE INDEX "cpa_firm_users_user_id_idx" ON "cpa_firm_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_firm_users_cpa_firm_id_user_id_key" ON "cpa_firm_users"("cpa_firm_id", "user_id");

-- CreateIndex
CREATE INDEX "conversation_history_institution_id_session_id_created_at_idx" ON "conversation_history"("institution_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_history_user_id_created_at_idx" ON "conversation_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_history_session_id_idx" ON "conversation_history"("session_id");

-- CreateIndex
CREATE INDEX "exam_readiness_assessments_institution_id_assessment_date_idx" ON "exam_readiness_assessments"("institution_id", "assessment_date" DESC);

-- CreateIndex
CREATE INDEX "exam_readiness_assessments_overall_grade_idx" ON "exam_readiness_assessments"("overall_grade");

-- CreateIndex
CREATE INDEX "exam_category_scores_assessment_id_idx" ON "exam_category_scores"("assessment_id");

-- CreateIndex
CREATE INDEX "exam_category_scores_category_status_idx" ON "exam_category_scores"("category", "status");

-- CreateIndex
CREATE INDEX "enterprise_batches_organization_id_created_at_idx" ON "enterprise_batches"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "enterprise_batches_status_idx" ON "enterprise_batches"("status");

-- CreateIndex
CREATE INDEX "enterprise_batches_requested_by_idx" ON "enterprise_batches"("requested_by");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_batch_id_created_at_idx" ON "webhook_delivery_logs"("batch_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_target_url_created_at_idx" ON "webhook_delivery_logs"("target_url", "created_at");

-- CreateIndex
CREATE INDEX "webhook_delivery_logs_next_retry_at_idx" ON "webhook_delivery_logs"("next_retry_at");

-- CreateIndex
CREATE INDEX "market_data_snapshots_data_type_as_of_date_idx" ON "market_data_snapshots"("data_type", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "market_data_snapshots_data_type_tenor_months_as_of_date_idx" ON "market_data_snapshots"("data_type", "tenor_months", "as_of_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rate_alert_thresholds_institution_id_metric_key" ON "rate_alert_thresholds"("institution_id", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "institutions_ncua_charter_number_key" ON "institutions"("ncua_charter_number");

-- CreateIndex
CREATE INDEX "report_artifacts_institution_id_generated_at_idx" ON "report_artifacts"("institution_id", "generated_at");

-- AddForeignKey
ALTER TABLE "cossec_exam_findings" ADD CONSTRAINT "cossec_exam_findings_prospect_institution_id_fkey" FOREIGN KEY ("prospect_institution_id") REFERENCES "prospect_institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_client_relationships" ADD CONSTRAINT "cpa_client_relationships_cpa_firm_id_fkey" FOREIGN KEY ("cpa_firm_id") REFERENCES "cpa_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_client_relationships" ADD CONSTRAINT "cpa_client_relationships_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_firm_users" ADD CONSTRAINT "cpa_firm_users_cpa_firm_id_fkey" FOREIGN KEY ("cpa_firm_id") REFERENCES "cpa_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_firm_users" ADD CONSTRAINT "cpa_firm_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_readiness_assessments" ADD CONSTRAINT "exam_readiness_assessments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_category_scores" ADD CONSTRAINT "exam_category_scores_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "exam_readiness_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "enterprise_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_alert_thresholds" ADD CONSTRAINT "rate_alert_thresholds_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "institution_period_cert" RENAME TO "camel_certifications_institution_id_period_key";
