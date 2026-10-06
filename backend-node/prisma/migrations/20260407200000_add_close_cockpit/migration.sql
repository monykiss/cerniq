-- ============================================================================
-- Close Cockpit migration
-- ============================================================================
-- Adds 6 tables, 7 enums, and 1 relation for the month-end close workspace.
-- Safe to run against production: no destructive changes to existing tables,
-- all new tables are independent except for the new close_cycles.organization_id
-- foreign key which only reads from the existing organizations table.
--
-- Review-ready. Apply with:
--   npx prisma migrate deploy
-- or
--   npx prisma db execute --file prisma/migrations/20260407200000_add_close_cockpit/migration.sql
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "CloseCycleStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'SIGNED_OFF', 'REOPENED');

CREATE TYPE "CloseTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'WAIVED');

CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'AWAITING_REVIEW', 'APPROVED', 'POSTED', 'REVERSED');

CREATE TYPE "ReconciliationType" AS ENUM ('BANK', 'AP_SUBLEDGER', 'AR_SUBLEDGER', 'INTERCOMPANY', 'PREPAID', 'ACCRUAL', 'FIXED_ASSET');

CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'TIE', 'EXCEPTION', 'REVIEWED', 'SIGNED_OFF');

CREATE TYPE "CloseActivityKind" AS ENUM (
  'CYCLE_OPENED',
  'CYCLE_SIGNED_OFF',
  'CYCLE_REOPENED',
  'TASK_UPDATED',
  'TASK_COMPLETED',
  'TASK_WAIVED',
  'TASK_CASCADED_UNBLOCK',
  'TIE_OUT_RUN',
  'JE_POSTED',
  'JE_REVERSED',
  'FLUX_REFRESHED',
  'GL_UPLOADED',
  'RECON_REVIEWED'
);

-- ── close_cycles ────────────────────────────────────────────────────────────
CREATE TABLE "close_cycles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER NOT NULL,
  "status" "CloseCycleStatus" NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "target_close_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "closed_by_id" UUID,
  "materiality_abs" DECIMAL(14,2) NOT NULL,
  "materiality_pct" DOUBLE PRECISION NOT NULL,
  "notes_en" TEXT,
  "notes_es" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "close_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "close_cycles_organization_id_period_year_period_month_key"
  ON "close_cycles"("organization_id", "period_year", "period_month");
CREATE INDEX "close_cycles_organization_id_status_idx"
  ON "close_cycles"("organization_id", "status");
CREATE INDEX "close_cycles_target_close_at_idx"
  ON "close_cycles"("target_close_at");

ALTER TABLE "close_cycles"
  ADD CONSTRAINT "close_cycles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── close_tasks ─────────────────────────────────────────────────────────────
CREATE TABLE "close_tasks" (
  "id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title_en" TEXT NOT NULL,
  "title_es" TEXT NOT NULL,
  "owner_id" UUID,
  "due_at" TIMESTAMP(3),
  "status" "CloseTaskStatus" NOT NULL DEFAULT 'PENDING',
  "blocked_by_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "completed_at" TIMESTAMP(3),
  "completed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "close_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "close_tasks_cycle_id_status_idx" ON "close_tasks"("cycle_id", "status");
CREATE INDEX "close_tasks_owner_id_idx" ON "close_tasks"("owner_id");
CREATE INDEX "close_tasks_due_at_idx" ON "close_tasks"("due_at");

ALTER TABLE "close_tasks"
  ADD CONSTRAINT "close_tasks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── close_journal_entries ───────────────────────────────────────────────────
CREATE TABLE "close_journal_entries" (
  "id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "memo_en" TEXT NOT NULL,
  "memo_es" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "total_debit" DECIMAL(14,2) NOT NULL,
  "total_credit" DECIMAL(14,2) NOT NULL,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "posted_at" TIMESTAMP(3),
  "posted_by_id" UUID,
  "approved_by_id" UUID,
  "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reverses_je_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "close_journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "close_journal_entries_cycle_id_reference_key"
  ON "close_journal_entries"("cycle_id", "reference");
CREATE INDEX "close_journal_entries_cycle_id_status_idx"
  ON "close_journal_entries"("cycle_id", "status");
CREATE INDEX "close_journal_entries_reverses_je_id_idx"
  ON "close_journal_entries"("reverses_je_id");

ALTER TABLE "close_journal_entries"
  ADD CONSTRAINT "close_journal_entries_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "close_journal_entries"
  ADD CONSTRAINT "close_journal_entries_reverses_je_id_fkey"
  FOREIGN KEY ("reverses_je_id") REFERENCES "close_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── close_reconciliations ───────────────────────────────────────────────────
CREATE TABLE "close_reconciliations" (
  "id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "account" TEXT NOT NULL,
  "recon_type" "ReconciliationType" NOT NULL,
  "gl_balance" DECIMAL(14,2) NOT NULL,
  "external_balance" DECIMAL(14,2) NOT NULL,
  "difference" DECIMAL(14,2) NOT NULL,
  "unmatched_items" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
  "prepared_by_id" UUID,
  "reviewed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "close_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "close_reconciliations_cycle_id_status_idx"
  ON "close_reconciliations"("cycle_id", "status");

ALTER TABLE "close_reconciliations"
  ADD CONSTRAINT "close_reconciliations_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── close_flux_narratives ───────────────────────────────────────────────────
CREATE TABLE "close_flux_narratives" (
  "id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "account" TEXT NOT NULL,
  "prior_balance" DECIMAL(14,2) NOT NULL,
  "current_balance" DECIMAL(14,2) NOT NULL,
  "variance_abs" DECIMAL(14,2) NOT NULL,
  "variance_pct" DOUBLE PRECISION NOT NULL,
  "is_material" BOOLEAN NOT NULL,
  "narrative_en" TEXT NOT NULL,
  "narrative_es" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "close_flux_narratives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "close_flux_narratives_cycle_id_is_material_idx"
  ON "close_flux_narratives"("cycle_id", "is_material");

ALTER TABLE "close_flux_narratives"
  ADD CONSTRAINT "close_flux_narratives_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── close_activities ────────────────────────────────────────────────────────
CREATE TABLE "close_activities" (
  "id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "actor_id" UUID,
  "kind" "CloseActivityKind" NOT NULL,
  "summary_en" TEXT NOT NULL,
  "summary_es" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "close_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "close_activities_cycle_id_created_at_idx"
  ON "close_activities"("cycle_id", "created_at");

ALTER TABLE "close_activities"
  ADD CONSTRAINT "close_activities_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── gl_balance_snapshots ───────────────────────────────────────────────────
-- Org-scoped monthly GL balance snapshots uploaded via CSV or synced from an
-- accounting system. Primary source for the "Pull from GL" / "Load from GL"
-- flows in the Close Cockpit. Replaces the legacy ALM bridge.

CREATE TABLE "gl_balance_snapshots" (
  "id"               UUID NOT NULL,
  "organization_id"  UUID NOT NULL,
  "account"          TEXT NOT NULL,
  "period_year"      INTEGER NOT NULL,
  "period_month"     INTEGER NOT NULL,
  "balance"          DECIMAL(18,2) NOT NULL,
  "source_label"     TEXT,
  "uploaded_by_id"   UUID,
  "notes"            TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gl_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gl_balance_snapshots_org_account_period_key"
  ON "gl_balance_snapshots"("organization_id", "account", "period_year", "period_month");
CREATE INDEX "gl_balance_snapshots_org_period_idx"
  ON "gl_balance_snapshots"("organization_id", "period_year", "period_month");

ALTER TABLE "gl_balance_snapshots"
  ADD CONSTRAINT "gl_balance_snapshots_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
