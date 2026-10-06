-- FAANG Audit P1 items #2 and #3: Governed Scenarios + Governed Benchmarks

-- Shared enum for governed entity lifecycle
DO $$ BEGIN
  CREATE TYPE "GovernedEntityStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SUPERSEDED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ScenarioScope" AS ENUM ('INSTITUTION', 'SECTOR', 'REGULATORY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BenchmarkType" AS ENUM ('YIELD_CURVE', 'PEER_BENCHMARK', 'REGULATORY_LIMIT', 'MARKET_INDEX');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefreshPolicy" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ON_PUBLICATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Governed Scenarios
-- ============================================================================

CREATE TABLE IF NOT EXISTS "governed_scenarios" (
    "id" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "scope" "ScenarioScope" NOT NULL,
    "status" "GovernedEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "approved_uses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provenance" JSONB,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "retired_at" TIMESTAMP(3),
    "retired_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "governed_scenarios_scenario_key_key"
    ON "governed_scenarios"("scenario_key");

CREATE INDEX IF NOT EXISTS "governed_scenarios_scope_idx"
    ON "governed_scenarios"("scope");

CREATE INDEX IF NOT EXISTS "governed_scenarios_status_idx"
    ON "governed_scenarios"("status");

CREATE INDEX IF NOT EXISTS "governed_scenarios_scope_status_idx"
    ON "governed_scenarios"("scope", "status");

-- ============================================================================
-- Governed Benchmarks
-- ============================================================================

CREATE TABLE IF NOT EXISTS "governed_benchmarks" (
    "id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "benchmark_type" "BenchmarkType" NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "status" "GovernedEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "refresh_policy" "RefreshPolicy" NOT NULL,
    "data" JSONB NOT NULL,
    "provenance" JSONB,
    "fallback_policy" TEXT,
    "data_checksum" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_benchmarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "governed_benchmarks_dataset_key_key"
    ON "governed_benchmarks"("dataset_key");

CREATE INDEX IF NOT EXISTS "governed_benchmarks_benchmark_type_idx"
    ON "governed_benchmarks"("benchmark_type");

CREATE INDEX IF NOT EXISTS "governed_benchmarks_status_idx"
    ON "governed_benchmarks"("status");

CREATE INDEX IF NOT EXISTS "governed_benchmarks_benchmark_type_status_idx"
    ON "governed_benchmarks"("benchmark_type", "status");

CREATE INDEX IF NOT EXISTS "governed_benchmarks_as_of_date_idx"
    ON "governed_benchmarks"("as_of_date");
