-- Member 360: create the three enum TYPES the Prisma schema declares.
--
-- WHY THIS EXISTS
-- ---------------
-- `20260812200000_add_member_360` created `members.lifecycle_stage`,
-- `member_accounts.category` and `member_lifecycle_events.severity` as plain
-- TEXT, but schema.prisma declares them as the enums `MemberLifecycleStage`,
-- `MemberAccountCategory` and `MemberEventSeverity`. Prisma Client is
-- generated from schema.prisma, so every write it emits casts to
-- `public."MemberLifecycleStage"` — a type that did not exist in the database.
--
-- The result: Member 360 could not persist a single row against a real
-- Postgres. Seeding failed with:
--     DriverAdapterError: type "public.MemberLifecycleStage" does not exist
--
-- Nothing caught it, because:
--   * every member360 unit test mocks PrismaService, so the 48 passing specs
--     exercise the classifier and never touch SQL;
--   * `prisma validate` only validates schema.prisma against itself;
--   * `prisma migrate deploy`/`status` only track WHICH migration files ran,
--     never whether their SQL matches the datamodel.
-- Confirmed with `prisma migrate diff --from-config-datasource --to-schema`.
--
-- WHY ALTER ... USING RATHER THAN PRISMA'S SUGGESTED DROP/ADD
-- ----------------------------------------------------------
-- `migrate diff` proposes DROP COLUMN + ADD COLUMN, which silently discards
-- every existing value. Production has never run the 08-12 migration, but any
-- developer or demo database that already seeded a book would lose its
-- lifecycle stages. `ALTER COLUMN ... TYPE ... USING` converts in place and
-- preserves the data. Idempotent guards so this is safe to re-run.

-- ── Types ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "MemberLifecycleStage" AS ENUM (
    'ONBOARDING', 'ACTIVE', 'AT_RISK', 'DELINQUENT', 'WORKOUT', 'CHARGED_OFF', 'CHURNED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MemberAccountCategory" AS ENUM ('SHARE', 'DEPOSIT', 'LOAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MemberEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── members.lifecycle_stage ─────────────────────────────────────────────
-- The DEFAULT must be dropped before the type change: Postgres cannot cast an
-- existing text default to the new enum as part of ALTER TYPE.
ALTER TABLE "members" ALTER COLUMN "lifecycle_stage" DROP DEFAULT;
ALTER TABLE "members"
  ALTER COLUMN "lifecycle_stage" TYPE "MemberLifecycleStage"
  USING "lifecycle_stage"::"MemberLifecycleStage";
ALTER TABLE "members"
  ALTER COLUMN "lifecycle_stage" SET DEFAULT 'ONBOARDING';

-- ── member_accounts.category ────────────────────────────────────────────
ALTER TABLE "member_accounts"
  ALTER COLUMN "category" TYPE "MemberAccountCategory"
  USING "category"::"MemberAccountCategory";

-- ── member_lifecycle_events.severity ────────────────────────────────────
ALTER TABLE "member_lifecycle_events" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "member_lifecycle_events"
  ALTER COLUMN "severity" TYPE "MemberEventSeverity"
  USING "severity"::"MemberEventSeverity";
ALTER TABLE "member_lifecycle_events"
  ALTER COLUMN "severity" SET DEFAULT 'INFO';

-- ── Index name parity with the Prisma datamodel ─────────────────────────
-- The 08-12 migration hand-named this index shorter than Prisma's generated
-- convention, which shows up as permanent drift in `migrate diff`.
ALTER INDEX IF EXISTS "member_lifecycle_events_inst_member_created_idx"
  RENAME TO "member_lifecycle_events_institution_id_member_id_created_at_idx";
