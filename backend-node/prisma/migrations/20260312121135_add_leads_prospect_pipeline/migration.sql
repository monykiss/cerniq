-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'PROPOSAL_SENT', 'NEGOTIATING', 'CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "leads" (
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
CREATE TABLE "prospect_institutions" (
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
CREATE TABLE "cooperativa_benchmarks" (
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

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_priority_idx" ON "leads"("priority");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "prospect_institutions_outreach_status_idx" ON "prospect_institutions"("outreach_status");

-- CreateIndex
CREATE UNIQUE INDEX "cooperativa_benchmarks_period_key" ON "cooperativa_benchmarks"("period");

