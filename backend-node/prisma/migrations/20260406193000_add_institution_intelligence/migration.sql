DO $$ BEGIN CREATE TYPE "IntelligenceAccountKind" AS ENUM ('COMPETITOR', 'BUYER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceAccountStatus" AS ENUM ('TRACKED', 'WATCHLIST', 'ACTIVE', 'DORMANT', 'ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceSourceType" AS ENUM ('OFFICIAL_REGISTRY', 'PUBLIC_WEBSITE', 'PRICING_PAGE', 'DOCUMENT', 'MANUAL_UPLOAD', 'INTERNAL_NOTE', 'ENRICHMENT_API'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceSourceFetchPolicy" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceSourceTrustLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceInsightType" AS ENUM ('PRICING_CHANGE', 'HIRING_SIGNAL', 'REGULATORY_SIGNAL', 'PRODUCT_SIGNAL', 'URGENCY_SIGNAL', 'THREAT_SIGNAL', 'CONTACT_SIGNAL', 'REFRESH_NOTE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceInsightSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceActionType" AS ENUM ('REVIEW_ACCOUNT', 'REFRESH_ACCOUNT', 'CONTACT_BUYER', 'UPDATE_CRM', 'GENERATE_REPORT', 'REVIEW_COMPETITOR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "IntelligenceArtifactType" AS ENUM ('WEEKLY_BRIEF', 'COMPETITOR_TEAR_SHEET', 'BUYER_DOSSIER', 'ACCOUNT_EXPORT', 'ACTION_EXPORT', 'HANDOFF_REPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WorkspaceMemoryEntryType" AS ENUM ('HANDOFF', 'DECISION', 'NOTE', 'ALERT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "intelligence_account_id" TEXT;

ALTER TABLE "prospect_institutions"
  ADD COLUMN IF NOT EXISTS "intelligence_account_id" TEXT;

CREATE TABLE IF NOT EXISTS "intelligence_accounts" (
  "id" TEXT NOT NULL,
  "workspace_id" UUID NOT NULL,
  "kind" "IntelligenceAccountKind" NOT NULL,
  "status" "IntelligenceAccountStatus" NOT NULL DEFAULT 'TRACKED',
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "domain" TEXT,
  "website_url" TEXT,
  "region" TEXT,
  "country" TEXT DEFAULT 'Puerto Rico',
  "industry" TEXT,
  "institutional_type" TEXT,
  "source_of_truth" TEXT,
  "current_summary" TEXT,
  "freshness_score" INTEGER NOT NULL DEFAULT 0,
  "opportunity_score" INTEGER NOT NULL DEFAULT 0,
  "threat_score" INTEGER NOT NULL DEFAULT 0,
  "action_score" INTEGER NOT NULL DEFAULT 0,
  "last_refreshed_at" TIMESTAMP(3),
  "last_changed_at" TIMESTAMP(3),
  "next_refresh_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_contacts" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "title" TEXT,
  "department" TEXT,
  "seniority" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "linkedin_url" TEXT,
  "contact_score" INTEGER NOT NULL DEFAULT 0,
  "reachability_score" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "last_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_sources" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "label" TEXT,
  "url" TEXT NOT NULL,
  "source_type" "IntelligenceSourceType" NOT NULL,
  "fetch_policy" "IntelligenceSourceFetchPolicy" NOT NULL DEFAULT 'WEEKLY',
  "trust_level" "IntelligenceSourceTrustLevel" NOT NULL DEFAULT 'MEDIUM',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "last_fetched_at" TIMESTAMP(3),
  "last_http_status" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_runs" (
  "id" TEXT NOT NULL,
  "workspace_id" UUID NOT NULL,
  "initiated_by_user_id" UUID,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "status" "IntelligenceRunStatus" NOT NULL DEFAULT 'QUEUED',
  "account_count" INTEGER NOT NULL DEFAULT 0,
  "snapshot_count" INTEGER NOT NULL DEFAULT 0,
  "insight_count" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "metadata" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_snapshots" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "source_id" TEXT,
  "run_id" TEXT,
  "summary" TEXT,
  "facts_json" JSONB NOT NULL,
  "raw_metadata" JSONB,
  "change_hash" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intelligence_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_insights" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "run_id" TEXT,
  "snapshot_id" TEXT,
  "type" "IntelligenceInsightType" NOT NULL,
  "severity" "IntelligenceInsightSeverity" NOT NULL DEFAULT 'MEDIUM',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "data" JSONB,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_insights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_actions" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "insight_id" TEXT,
  "assigned_to_user_id" UUID,
  "type" "IntelligenceActionType" NOT NULL,
  "status" "IntelligenceActionStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "action_score" INTEGER NOT NULL DEFAULT 0,
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "intelligence_artifacts" (
  "id" TEXT NOT NULL,
  "workspace_id" UUID NOT NULL,
  "account_id" TEXT,
  "run_id" TEXT,
  "created_by_user_id" UUID,
  "type" "IntelligenceArtifactType" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "default_format" TEXT NOT NULL DEFAULT 'json',
  "filters_json" JSONB,
  "artifact_data" JSONB,
  "artifact_text" TEXT,
  "csv_content" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intelligence_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workspace_memory_entries" (
  "id" TEXT NOT NULL,
  "workspace_id" UUID NOT NULL,
  "account_id" TEXT,
  "author_user_id" UUID,
  "type" "WorkspaceMemoryEntryType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_memory_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_accounts_workspace_id_kind_normalized_name_key"
  ON "intelligence_accounts"("workspace_id", "kind", "normalized_name");
CREATE INDEX IF NOT EXISTS "intelligence_accounts_workspace_id_kind_idx"
  ON "intelligence_accounts"("workspace_id", "kind");
CREATE INDEX IF NOT EXISTS "intelligence_accounts_status_next_refresh_at_idx"
  ON "intelligence_accounts"("status", "next_refresh_at");
CREATE INDEX IF NOT EXISTS "intelligence_accounts_domain_idx"
  ON "intelligence_accounts"("domain");

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_contacts_account_id_normalized_name_title_key"
  ON "intelligence_contacts"("account_id", "normalized_name", "title");
CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_contacts_account_id_email_key"
  ON "intelligence_contacts"("account_id", "email");
CREATE INDEX IF NOT EXISTS "intelligence_contacts_account_id_contact_score_idx"
  ON "intelligence_contacts"("account_id", "contact_score");

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_sources_account_id_url_key"
  ON "intelligence_sources"("account_id", "url");
CREATE INDEX IF NOT EXISTS "intelligence_sources_account_id_active_idx"
  ON "intelligence_sources"("account_id", "active");

CREATE INDEX IF NOT EXISTS "intelligence_runs_workspace_id_status_idx"
  ON "intelligence_runs"("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "intelligence_runs_started_at_idx"
  ON "intelligence_runs"("started_at");

CREATE UNIQUE INDEX IF NOT EXISTS "intelligence_snapshots_account_id_change_hash_key"
  ON "intelligence_snapshots"("account_id", "change_hash");
CREATE INDEX IF NOT EXISTS "intelligence_snapshots_account_id_captured_at_idx"
  ON "intelligence_snapshots"("account_id", "captured_at");

CREATE INDEX IF NOT EXISTS "intelligence_insights_account_id_severity_created_at_idx"
  ON "intelligence_insights"("account_id", "severity", "created_at");

CREATE INDEX IF NOT EXISTS "intelligence_actions_status_due_at_idx"
  ON "intelligence_actions"("status", "due_at");
CREATE INDEX IF NOT EXISTS "intelligence_actions_account_id_action_score_idx"
  ON "intelligence_actions"("account_id", "action_score");

CREATE INDEX IF NOT EXISTS "intelligence_artifacts_workspace_id_type_created_at_idx"
  ON "intelligence_artifacts"("workspace_id", "type", "created_at");

CREATE INDEX IF NOT EXISTS "workspace_memory_entries_workspace_id_type_created_at_idx"
  ON "workspace_memory_entries"("workspace_id", "type", "created_at");
CREATE INDEX IF NOT EXISTS "workspace_memory_entries_account_id_pinned_idx"
  ON "workspace_memory_entries"("account_id", "pinned");

CREATE INDEX IF NOT EXISTS "leads_intelligence_account_id_idx"
  ON "leads"("intelligence_account_id");
CREATE INDEX IF NOT EXISTS "prospect_institutions_intelligence_account_id_idx"
  ON "prospect_institutions"("intelligence_account_id");

DO $$ BEGIN
  ALTER TABLE "intelligence_accounts"
    ADD CONSTRAINT "intelligence_accounts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_contacts"
    ADD CONSTRAINT "intelligence_contacts_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_sources"
    ADD CONSTRAINT "intelligence_sources_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_runs"
    ADD CONSTRAINT "intelligence_runs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_runs"
    ADD CONSTRAINT "intelligence_runs_initiated_by_user_id_fkey"
    FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_snapshots"
    ADD CONSTRAINT "intelligence_snapshots_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_snapshots"
    ADD CONSTRAINT "intelligence_snapshots_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_snapshots"
    ADD CONSTRAINT "intelligence_snapshots_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "intelligence_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_insights"
    ADD CONSTRAINT "intelligence_insights_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_insights"
    ADD CONSTRAINT "intelligence_insights_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "intelligence_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_insights"
    ADD CONSTRAINT "intelligence_insights_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "intelligence_snapshots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_actions"
    ADD CONSTRAINT "intelligence_actions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_actions"
    ADD CONSTRAINT "intelligence_actions_insight_id_fkey"
    FOREIGN KEY ("insight_id") REFERENCES "intelligence_insights"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_actions"
    ADD CONSTRAINT "intelligence_actions_assigned_to_user_id_fkey"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_artifacts"
    ADD CONSTRAINT "intelligence_artifacts_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_artifacts"
    ADD CONSTRAINT "intelligence_artifacts_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_artifacts"
    ADD CONSTRAINT "intelligence_artifacts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "intelligence_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "intelligence_artifacts"
    ADD CONSTRAINT "intelligence_artifacts_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workspace_memory_entries"
    ADD CONSTRAINT "workspace_memory_entries_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workspace_memory_entries"
    ADD CONSTRAINT "workspace_memory_entries_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workspace_memory_entries"
    ADD CONSTRAINT "workspace_memory_entries_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "leads_intelligence_account_id_fkey"
    FOREIGN KEY ("intelligence_account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prospect_institutions"
    ADD CONSTRAINT "prospect_institutions_intelligence_account_id_fkey"
    FOREIGN KEY ("intelligence_account_id") REFERENCES "intelligence_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
