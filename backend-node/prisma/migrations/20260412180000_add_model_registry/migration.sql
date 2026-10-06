-- FAANG Audit P1: Formal Model Registry
-- Every production-facing model is discoverable, owned, versioned, approvable.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ModelStatus" AS ENUM ('DRAFT', 'CANDIDATE', 'APPROVED', 'DEPRECATED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ModelCategory" AS ENUM (
    'ALM_CORE', 'CREDIT_RISK', 'LIQUIDITY', 'INTEREST_RATE', 'STRESS_TEST',
    'CAPITAL', 'REGULATORY', 'PRICING', 'RISK_METRICS', 'REPORTING',
    'PEER_ANALYTICS', 'PORTFOLIO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ModelRiskTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "model_registry_entries" (
    "id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "category" "ModelCategory" NOT NULL,
    "risk_tier" "ModelRiskTier" NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_id" TEXT,
    "owner_name" TEXT NOT NULL,
    "service_file" TEXT NOT NULL,
    "entry_function" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "retired_at" TIMESTAMP(3),
    "retired_by" TEXT,
    "retired_reason" TEXT,
    "calibration_metadata" JSONB,
    "required_inputs" JSONB,
    "output_schema" JSONB,
    "limitations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_registry_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "model_validation_artifacts" (
    "id" TEXT NOT NULL,
    "model_registry_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "storage_locator" TEXT NOT NULL,
    "checksum" TEXT,
    "produced_by" TEXT NOT NULL,
    "produced_at" TIMESTAMP(3) NOT NULL,
    "validation_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_validation_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "model_registry_entries_model_key_key"
    ON "model_registry_entries"("model_key");

CREATE INDEX IF NOT EXISTS "model_registry_entries_category_idx"
    ON "model_registry_entries"("category");

CREATE INDEX IF NOT EXISTS "model_registry_entries_status_idx"
    ON "model_registry_entries"("status");

CREATE INDEX IF NOT EXISTS "model_registry_entries_risk_tier_idx"
    ON "model_registry_entries"("risk_tier");

CREATE INDEX IF NOT EXISTS "model_registry_entries_category_status_idx"
    ON "model_registry_entries"("category", "status");

CREATE INDEX IF NOT EXISTS "model_validation_artifacts_model_registry_id_idx"
    ON "model_validation_artifacts"("model_registry_id");

CREATE INDEX IF NOT EXISTS "model_validation_artifacts_artifact_type_idx"
    ON "model_validation_artifacts"("artifact_type");

-- AddForeignKey
ALTER TABLE "model_validation_artifacts"
    ADD CONSTRAINT "model_validation_artifacts_model_registry_id_fkey"
    FOREIGN KEY ("model_registry_id") REFERENCES "model_registry_entries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
