-- Member 360 (Wave 3 / Layer 3 — fixture-first slice).
-- Member-grain data model: one member (socio) per row, N accounts per
-- member, an append-only lifecycle-event trail. Every optional column is
-- nullable and nullability IS the missingness record (D1 — never impute or
-- default a classification/score field; see cossec_classification, risk_score,
-- cecl_stage in the corresponding Prisma model comments).
-- Append-only, idempotent (IF NOT EXISTS guards) — never edit after apply.

CREATE TABLE IF NOT EXISTS "members" (
  "id"               TEXT NOT NULL,
  "institution_id"   TEXT NOT NULL,
  "member_number"    TEXT NOT NULL,
  "full_name"        TEXT NOT NULL,
  "tax_id_encrypted" TEXT,
  "member_since"     DATE NOT NULL,
  "lifecycle_stage"  TEXT NOT NULL DEFAULT 'ONBOARDING',
  "risk_score"       INTEGER,
  "cecl_stage"       INTEGER,
  "source"           TEXT NOT NULL DEFAULT 'fixture',
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "members_institution_id_member_number_key"
  ON "members"("institution_id", "member_number");

CREATE INDEX IF NOT EXISTS "members_institution_id_lifecycle_stage_idx"
  ON "members"("institution_id", "lifecycle_stage");

DO $$ BEGIN
  ALTER TABLE "members"
    ADD CONSTRAINT "members_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "member_accounts" (
  "id"                    TEXT NOT NULL,
  "member_id"             TEXT NOT NULL,
  "institution_id"        TEXT NOT NULL,
  "product_type"          TEXT NOT NULL,
  "category"              TEXT NOT NULL,
  "balance"               DECIMAL(18,2) NOT NULL,
  "interest_rate"         DECIMAL(8,6),
  "delinquency_days"      INTEGER,
  "maturity_date"         DATE,
  "opened_date"           DATE NOT NULL,
  "cossec_classification" TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "member_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "member_accounts_institution_id_member_id_idx"
  ON "member_accounts"("institution_id", "member_id");

CREATE INDEX IF NOT EXISTS "member_accounts_institution_id_category_idx"
  ON "member_accounts"("institution_id", "category");

DO $$ BEGIN
  ALTER TABLE "member_accounts"
    ADD CONSTRAINT "member_accounts_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "member_lifecycle_events" (
  "id"             TEXT NOT NULL,
  "member_id"      TEXT NOT NULL,
  "institution_id" TEXT NOT NULL,
  "event_type"     TEXT NOT NULL,
  "severity"       TEXT NOT NULL DEFAULT 'INFO',
  "metadata"       JSONB NOT NULL DEFAULT '{}',
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "member_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "member_lifecycle_events_inst_member_created_idx"
  ON "member_lifecycle_events"("institution_id", "member_id", "created_at" DESC);

DO $$ BEGIN
  ALTER TABLE "member_lifecycle_events"
    ADD CONSTRAINT "member_lifecycle_events_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Row-Level Security — the two-policy pattern every institution-scoped table
-- ships with (20260417020000 / Supreme Engineering Bible §11). All three
-- tables carry institution_id directly (member_accounts and
-- member_lifecycle_events denormalize it from members, same tradeoff
-- loan_records makes) so every policy below is a single-hop check.
-- ---------------------------------------------------------------------------

ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_members ON "members";
CREATE POLICY tenant_isolation_members
  ON "members" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_members ON "members";
CREATE POLICY admin_bypass_members
  ON "members" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

ALTER TABLE "member_accounts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_member_accounts ON "member_accounts";
CREATE POLICY tenant_isolation_member_accounts
  ON "member_accounts" FOR ALL
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_member_accounts ON "member_accounts";
CREATE POLICY admin_bypass_member_accounts
  ON "member_accounts" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');

-- member_lifecycle_events: same tenant policy PLUS an append-only guard
-- (KLYTICS Rule 4 — audit-immutable, the audit_log* precedent). No UPDATE,
-- no DELETE grant to the application role at the RLS layer: history is
-- corrected by inserting a new event, never by editing an old one.
ALTER TABLE "member_lifecycle_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_member_lifecycle_events ON "member_lifecycle_events";
CREATE POLICY tenant_isolation_member_lifecycle_events
  ON "member_lifecycle_events" FOR SELECT
  USING ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS tenant_insert_member_lifecycle_events ON "member_lifecycle_events";
CREATE POLICY tenant_insert_member_lifecycle_events
  ON "member_lifecycle_events" FOR INSERT
  WITH CHECK ("institution_id" = current_setting('app.current_institution_id', TRUE)::text);

DROP POLICY IF EXISTS admin_bypass_member_lifecycle_events ON "member_lifecycle_events";
CREATE POLICY admin_bypass_member_lifecycle_events
  ON "member_lifecycle_events" FOR ALL
  USING (current_setting('app.admin_mode', TRUE) = 'true');
