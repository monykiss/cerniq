-- FAANG Audit P1 #4: Immutable Report Artifacts
-- Binds every distributed PDF to one AnalysisRun + model lineage snapshot.

DO $$ BEGIN
  CREATE TYPE "ReportArtifactFormat" AS ENUM ('PDF_ES', 'PDF_EN', 'EXCEL', 'JSON_BINDER', 'CSV_TEMPLATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "report_artifacts" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "analysis_run_id" TEXT,
    "report_job_id" TEXT,
    "format" "ReportArtifactFormat" NOT NULL,
    "language" TEXT,
    "template_version" TEXT NOT NULL DEFAULT 'alm-v1',
    "content_checksum" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_locator" TEXT NOT NULL,
    "model_lineage_snapshot" JSONB NOT NULL,
    "dataset_versions" JSONB,
    "preflight_gaps" JSONB,
    "preflight_ready" BOOLEAN NOT NULL DEFAULT false,
    "generated_by" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_artifacts_institution_id_generated_at_idx"
    ON "report_artifacts"("institution_id", "generated_at" DESC);

CREATE INDEX IF NOT EXISTS "report_artifacts_analysis_run_id_idx"
    ON "report_artifacts"("analysis_run_id");

CREATE INDEX IF NOT EXISTS "report_artifacts_report_job_id_idx"
    ON "report_artifacts"("report_job_id");

CREATE INDEX IF NOT EXISTS "report_artifacts_content_checksum_idx"
    ON "report_artifacts"("content_checksum");

ALTER TABLE "report_artifacts"
    ADD CONSTRAINT "report_artifacts_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_artifacts"
    ADD CONSTRAINT "report_artifacts_analysis_run_id_fkey"
    FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
