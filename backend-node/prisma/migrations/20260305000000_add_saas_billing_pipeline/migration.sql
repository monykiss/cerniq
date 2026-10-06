-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('free', 'one_time', 'monthly', 'annual', 'partner');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'cancelled', 'grace_period');

-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('AWAITING_DATA', 'VALIDATING', 'VALIDATION_FAILED', 'QUEUED', 'PROCESSING', 'GENERATING_PDF', 'UPLOADING', 'COMPLETE', 'FAILED');

-- CreateTable: Subscriptions
CREATE TABLE "subscriptions" (
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

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");
CREATE INDEX "subscriptions_stripe_customer_id_idx" ON "subscriptions"("stripe_customer_id");

-- CreateTable: Report Jobs
CREATE TABLE "report_jobs" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "institution_id" TEXT,
    "institution_name" TEXT NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'AWAITING_DATA',
    "submitted_at" TIMESTAMP(3),
    "processing_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "report_url" TEXT,
    "report_url_en" TEXT,
    "report_lang" TEXT NOT NULL DEFAULT 'es',
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" TEXT NOT NULL DEFAULT 'payment',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_jobs_user_id_status_idx" ON "report_jobs"("user_id", "status");
CREATE INDEX "report_jobs_status_idx" ON "report_jobs"("status");

-- CreateTable: Magic Links
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_key" ON "magic_links"("token");
CREATE INDEX "magic_links_token_idx" ON "magic_links"("token");

-- CreateTable: Email Sequences
CREATE TABLE "email_sequences" (
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

-- CreateIndex
CREATE INDEX "email_sequences_user_id_sequence_key_idx" ON "email_sequences"("user_id", "sequence_key");
CREATE INDEX "email_sequences_scheduled_at_cancelled_sent_at_idx" ON "email_sequences"("scheduled_at", "cancelled", "sent_at");

-- CreateTable: Partner Configs
CREATE TABLE "partner_configs" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "firm_name" TEXT NOT NULL,
    "firm_logo_url" TEXT,
    "firm_address" TEXT,
    "cover_footer" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#1B3A6B',

    CONSTRAINT "partner_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_configs_user_id_key" ON "partner_configs"("user_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_configs" ADD CONSTRAINT "partner_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
