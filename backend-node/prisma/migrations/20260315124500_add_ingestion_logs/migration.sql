-- CreateEnum
CREATE TYPE "IngestionLogStatus" AS ENUM ('VALIDATED', 'IMPORTED', 'FAILED', 'DRY_RUN');

-- CreateTable
CREATE TABLE "ingestion_logs" (
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

-- CreateIndex
CREATE INDEX "ingestion_logs_institution_id_created_at_idx" ON "ingestion_logs"("institution_id", "created_at");
CREATE INDEX "ingestion_logs_created_by_user_id_created_at_idx" ON "ingestion_logs"("created_by_user_id", "created_at");
CREATE INDEX "ingestion_logs_report_job_id_created_at_idx" ON "ingestion_logs"("report_job_id", "created_at");

-- AddForeignKey
ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ingestion_logs" ADD CONSTRAINT "ingestion_logs_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
