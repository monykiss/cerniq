
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN CREATE TYPE "InstitutionRole" AS ENUM ('OWNER', 'ANALYST', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "PipelineStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'PROPOSAL_SENT', 'NEGOTIATING', 'CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "LeadPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "SubscriptionTier" AS ENUM ('free', 'one_time', 'monthly', 'annual', 'partner'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'cancelled', 'grace_period'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "AnalysisRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "IngestionLogStatus" AS ENUM ('VALIDATED', 'IMPORTED', 'FAILED', 'DRY_RUN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "ReportJobStatus" AS ENUM ('AWAITING_DATA', 'VALIDATING', 'VALIDATION_FAILED', 'QUEUED', 'PROCESSING', 'GENERATING_PDF', 'UPLOADING', 'COMPLETE', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "ProspectStage" AS ENUM ('lead', 'contacted', 'demo_scheduled', 'demo_done', 'proposal', 'closed_won', 'closed_lost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "provider_id" TEXT,
    "role" "InstitutionRole" NOT NULL DEFAULT 'OWNER',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invited_by" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "category" TEXT,
    "description" TEXT,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "receipt_url" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "ai_extracted" BOOLEAN NOT NULL DEFAULT false,
    "ai_confidence" DOUBLE PRECISION,
    "ai_data" JSONB,
    "invoice_hash" TEXT,
    "anomaly_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "review_status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "institutions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "total_assets" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reporting_date" TIMESTAMP(3) NOT NULL,
    "cossec_registration_number" TEXT,
    "fiscal_year_end" TEXT,
    "alco_meeting_frequency" TEXT,
    "alco_next_date" TIMESTAMP(3),
    "last_exam_date" TIMESTAMP(3),
    "next_exam_date" TIMESTAMP(3),
    "primary_regulator" TEXT NOT NULL DEFAULT 'COSSEC',
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'es',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "balance_sheet_items" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "reprice_date" TIMESTAMP(3),
    "maturity_date" TIMESTAMP(3),
    "rate_type" TEXT NOT NULL,
    "deposit_beta" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "interest_rate_scenarios" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shift_bps" INTEGER NOT NULL,
    "ni_impact" DOUBLE PRECISION NOT NULL,
    "mve_impact" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_rate_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidity_positions" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hqla_level1" DOUBLE PRECISION NOT NULL,
    "hqla_level2" DOUBLE PRECISION NOT NULL,
    "cash_outflows" DOUBLE PRECISION NOT NULL,
    "cash_inflows" DOUBLE PRECISION NOT NULL,
    "lcr" DOUBLE PRECISION NOT NULL,
    "nsfr" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidity_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "saved_scenarios" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scenario_type" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "results" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "yield_curves" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "tenors" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yield_curves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "loan_segments" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "segment_name" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "weighted_avg_rate" DOUBLE PRECISION NOT NULL,
    "weighted_avg_maturity" DOUBLE PRECISION NOT NULL,
    "historical_loss_rate" DOUBLE PRECISION NOT NULL,
    "lgd" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "qualitative_adj" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deposit_tiers" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "tier_name" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "insured_pct" DOUBLE PRECISION NOT NULL,
    "flight_rate" DOUBLE PRECISION NOT NULL,
    "avg_rate" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "concentration_limits" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "limit_type" TEXT NOT NULL,
    "limit_name" TEXT NOT NULL,
    "max_pct" DOUBLE PRECISION NOT NULL,
    "current_pct" DOUBLE PRECISION NOT NULL,
    "current_balance" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'compliant',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concentration_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "loan_cohorts" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "loan_type" TEXT NOT NULL,
    "origination_qtr" TEXT NOT NULL,
    "original_balance" DOUBLE PRECISION NOT NULL,
    "current_balance" DOUBLE PRECISION NOT NULL,
    "defaults" DOUBLE PRECISION NOT NULL,
    "age_months" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cecl_vintage_allowances" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "methodology" TEXT NOT NULL,
    "base_allowance" DOUBLE PRECISION NOT NULL,
    "adverse_allowance" DOUBLE PRECISION NOT NULL,
    "severe_allowance" DOUBLE PRECISION NOT NULL,
    "segment_breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cecl_vintage_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "irr_policy_limits" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "limit_type" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "watch_pct" DOUBLE PRECISION NOT NULL,
    "warning_pct" DOUBLE PRECISION NOT NULL,
    "breach_pct" DOUBLE PRECISION NOT NULL,
    "regulatory_ref" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "irr_policy_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "policy_breach_logs" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "limit_type" TEXT NOT NULL,
    "breach_level" TEXT NOT NULL,
    "actual_value" DOUBLE PRECISION NOT NULL,
    "limit_value" DOUBLE PRECISION NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "policy_breach_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "column_mapping_memories" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "csv_column_name" TEXT NOT NULL,
    "cerniq_field" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "column_mapping_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "board_reports" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "report_month" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "camel_composite" DOUBLE PRECISION,
    "nim_snapshot" DOUBLE PRECISION,
    "lcr_snapshot" DOUBLE PRECISION,
    "top_risk_alert" TEXT,

    CONSTRAINT "board_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "uploads" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "upload_id" UUID,
    "vendor_name" TEXT NOT NULL,
    "invoice_number" TEXT,
    "invoice_date" TIMESTAMP(3),
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "findings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "invoice_id" UUID,
    "vendor_name" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reports" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tickers" (
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "industry" TEXT,
    "asset_type" TEXT NOT NULL,
    "exchange" TEXT,
    "country" TEXT,
    "market_cap" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "first_added" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickers_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "positions" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "ticker" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "avg_cost" DECIMAL(18,2) NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "PipelineStatus" NOT NULL DEFAULT 'RUNNING',
    "tickers_processed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "duration_ms" INTEGER,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "market_prices" (
    "id" UUID NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,4),
    "high" DECIMAL(18,4),
    "low" DECIMAL(18,4),
    "close" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "demo_requests" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "institution_name" TEXT,
    "institution_type" TEXT,
    "total_assets" TEXT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CFO',
    "institution_name" TEXT NOT NULL,
    "institution_type" TEXT NOT NULL,
    "message" TEXT,
    "source" TEXT NOT NULL DEFAULT 'landing_page',
    "utm_source" TEXT,
    "utm_campaign" TEXT,
    "referred_by" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigned_to" TEXT,
    "notes" TEXT,
    "next_follow_up" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "revenue_amount" DOUBLE PRECISION,
    "deal_type" TEXT,
    "report_job_id" TEXT,
    "report_sent_at" TIMESTAMP(3),
    "public_data_snapshot" JSONB,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prospect_institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution_type" TEXT NOT NULL,
    "location" TEXT,
    "estimated_assets" DOUBLE PRECISION,
    "public_data_source" TEXT,
    "outreach_status" TEXT NOT NULL DEFAULT 'not_started',
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_role" TEXT,
    "notes" TEXT,
    "report_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospect_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cooperativa_benchmarks" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_assets_median" DOUBLE PRECISION,
    "capital_ratio_median" DOUBLE PRECISION,
    "loan_to_share_median" DOUBLE PRECISION,
    "liquidity_ratio_median" DOUBLE PRECISION,
    "nii_margin_median" DOUBLE PRECISION,
    "asset_growth_yoy" DOUBLE PRECISION,
    "member_count_total" INTEGER,
    "active_institutions" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cooperativa_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "analysis_runs" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
    "analysis_type" TEXT NOT NULL DEFAULT 'full_analysis',
    "triggered_by" TEXT NOT NULL DEFAULT 'manual',
    "model_version" TEXT NOT NULL DEFAULT 'alm-v1',
    "scenario_set" TEXT NOT NULL DEFAULT 'base_parallel_shocks',
    "assumptions" JSONB,
    "parameter_snapshot" JSONB NOT NULL,
    "balance_sheet_snapshot" JSONB NOT NULL,
    "result_summary" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ingestion_logs" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "report_job_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual_upload',
    "source_filename" TEXT,
    "schema_version" TEXT NOT NULL DEFAULT 'alm_csv_v1',
    "status" "IngestionLogStatus" NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "total_assets" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_liabilities" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "stripe_customer_id" TEXT,
    "stripe_session_id" TEXT,
    "stripe_price_id" TEXT,
    "stripe_subscription_id" TEXT,
    "current_period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "reports_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_jobs" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "institution_id" TEXT,
    "institution_name" TEXT NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'AWAITING_DATA',
    "analysis_period" TEXT,
    "previous_job_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "processing_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "report_url" TEXT,
    "report_url_en" TEXT,
    "report_lang" TEXT NOT NULL DEFAULT 'es',
    "raw_data" TEXT,
    "raw_data_purged_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" TEXT NOT NULL DEFAULT 'payment',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "magic_links" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_sequences" (
    "id" TEXT NOT NULL,
    "user_id" UUID,
    "lead_id" TEXT,
    "sequence_key" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "partner_configs" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "firm_name" TEXT NOT NULL,
    "firm_logo_url" TEXT,
    "firm_address" TEXT,
    "cover_footer" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#1B3A6B',

    CONSTRAINT "partner_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prospects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "role" TEXT,
    "stage" "ProspectStage" NOT NULL DEFAULT 'lead',
    "source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "institution_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "changes" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "tenant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "feedback" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT,
    "job_id" TEXT,
    "nps_score" INTEGER,
    "comment" TEXT,
    "contact_ok" BOOLEAN NOT NULL DEFAULT false,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_delivered_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "resellers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#1B3A6B',
    "domain" TEXT,
    "revenue_share_pct" DOUBLE PRECISION NOT NULL,
    "billing_model" TEXT NOT NULL DEFAULT 'PASS_THROUGH',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "prospect_analyses" (
    "id" TEXT NOT NULL,
    "charter_number" TEXT NOT NULL,
    "institution_name" TEXT NOT NULL,
    "total_assets" DOUBLE PRECISION NOT NULL,
    "risk_flags" JSONB NOT NULL,
    "email_draft" TEXT,
    "email_draft_es" TEXT,
    "overall_risk" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analyzed',
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sso_configurations" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "saml_entity_id" TEXT,
    "saml_idp_url" TEXT,
    "saml_idp_cert" TEXT,
    "oidc_issuer" TEXT,
    "oidc_client_id" TEXT,
    "oidc_client_secret" TEXT,
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT true,
    "default_role" TEXT NOT NULL DEFAULT 'viewer',
    "group_role_mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "usage_meter_events" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "billed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_meter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "regulation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "data_scope" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "regulatory_publications" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "regulator" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "rawText" TEXT NOT NULL,
    "impact_json" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "institution_alerts" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "alert_text_es" TEXT NOT NULL,
    "alert_text_en" TEXT,
    "affected_items" TEXT[],
    "recommended_action" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institution_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_keys_user_id_revoked_at_idx" ON "api_keys"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_keys_expires_at_idx" ON "api_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_organization_id_idx" ON "expenses"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_user_id_idx" ON "expenses"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_status_idx" ON "expenses"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_invoice_hash_idx" ON "expenses"("invoice_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "institutions_workspace_id_idx" ON "institutions"("workspace_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_sheet_items_institution_id_idx" ON "balance_sheet_items"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "interest_rate_scenarios_institution_id_idx" ON "interest_rate_scenarios"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidity_positions_institution_id_idx" ON "liquidity_positions"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_scenarios_institution_id_created_at_idx" ON "saved_scenarios"("institution_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_scenarios_created_by_idx" ON "saved_scenarios"("created_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "yield_curves_institution_id_as_of_date_idx" ON "yield_curves"("institution_id", "as_of_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "loan_segments_institution_id_as_of_date_idx" ON "loan_segments"("institution_id", "as_of_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deposit_tiers_institution_id_idx" ON "deposit_tiers"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "concentration_limits_institution_id_idx" ON "concentration_limits"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "loan_cohorts_institution_id_idx" ON "loan_cohorts"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cecl_vintage_allowances_institution_id_idx" ON "cecl_vintage_allowances"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "irr_policy_limits_institution_id_idx" ON "irr_policy_limits"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_breach_logs_institution_id_detected_at_idx" ON "policy_breach_logs"("institution_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "column_mapping_memories_institution_id_csv_column_name_key" ON "column_mapping_memories"("institution_id", "csv_column_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "board_reports_institution_id_idx" ON "board_reports"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "positions_portfolio_id_ticker_key" ON "positions"("portfolio_id", "ticker");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "market_prices_ticker_idx" ON "market_prices"("ticker");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "market_prices_date_idx" ON "market_prices"("date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "market_prices_ticker_date_key" ON "market_prices"("ticker", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_priority_idx" ON "leads"("priority");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prospect_institutions_outreach_status_idx" ON "prospect_institutions"("outreach_status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cooperativa_benchmarks_period_key" ON "cooperativa_benchmarks"("period");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "analysis_runs_institution_id_created_at_idx" ON "analysis_runs"("institution_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "analysis_runs_created_by_user_id_created_at_idx" ON "analysis_runs"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "analysis_runs_status_idx" ON "analysis_runs"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ingestion_logs_institution_id_created_at_idx" ON "ingestion_logs"("institution_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ingestion_logs_created_by_user_id_created_at_idx" ON "ingestion_logs"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ingestion_logs_report_job_id_created_at_idx" ON "ingestion_logs"("report_job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_id_idx" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_jobs_user_id_status_idx" ON "report_jobs"("user_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_jobs_status_idx" ON "report_jobs"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_jobs_institution_id_status_idx" ON "report_jobs"("institution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "magic_links_token_key" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "magic_links_token_idx" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_sequences_user_id_sequence_key_idx" ON "email_sequences"("user_id", "sequence_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_sequences_scheduled_at_cancelled_sent_at_idx" ON "email_sequences"("scheduled_at", "cancelled", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "partner_configs_user_id_key" ON "partner_configs"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "prospects_stage_idx" ON "prospects"("stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_resource_resource_id_idx" ON "audit_logs"("resource", "resource_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_institution_id_created_at_idx" ON "audit_logs"("institution_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_institution_id_idx" ON "feedback"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_institution_id_idx" ON "webhook_subscriptions"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "resellers_slug_key" ON "resellers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_analyses_charter_number_key" ON "prospect_analyses"("charter_number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sso_configurations_institution_id_key" ON "sso_configurations"("institution_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "usage_meter_events_institution_id_event_type_created_at_idx" ON "usage_meter_events"("institution_id", "event_type", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "data_deletion_requests_institution_id_idx" ON "data_deletion_requests"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "regulatory_publications_url_key" ON "regulatory_publications"("url");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "institution_alerts_institution_id_created_at_idx" ON "institution_alerts"("institution_id", "created_at" DESC);

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "institutions" ADD CONSTRAINT "institutions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "balance_sheet_items" ADD CONSTRAINT "balance_sheet_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "interest_rate_scenarios" ADD CONSTRAINT "interest_rate_scenarios_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "liquidity_positions" ADD CONSTRAINT "liquidity_positions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "saved_scenarios" ADD CONSTRAINT "saved_scenarios_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "yield_curves" ADD CONSTRAINT "yield_curves_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "loan_segments" ADD CONSTRAINT "loan_segments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "deposit_tiers" ADD CONSTRAINT "deposit_tiers_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "concentration_limits" ADD CONSTRAINT "concentration_limits_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "loan_cohorts" ADD CONSTRAINT "loan_cohorts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "cecl_vintage_allowances" ADD CONSTRAINT "cecl_vintage_allowances_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "irr_policy_limits" ADD CONSTRAINT "irr_policy_limits_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "policy_breach_logs" ADD CONSTRAINT "policy_breach_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "column_mapping_memories" ADD CONSTRAINT "column_mapping_memories_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "board_reports" ADD CONSTRAINT "board_reports_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "findings" ADD CONSTRAINT "findings_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "positions" ADD CONSTRAINT "positions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "positions" ADD CONSTRAINT "positions_ticker_fkey" FOREIGN KEY ("ticker") REFERENCES "tickers"("ticker") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "partner_configs" ADD CONSTRAINT "partner_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "institution_alerts" ADD CONSTRAINT "institution_alerts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "institution_alerts" ADD CONSTRAINT "institution_alerts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "regulatory_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

