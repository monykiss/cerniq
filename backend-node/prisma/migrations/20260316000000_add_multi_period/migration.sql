-- AlterTable: Add multi-period analysis fields to report_jobs
ALTER TABLE "report_jobs" ADD COLUMN IF NOT EXISTS "analysis_period" TEXT;
ALTER TABLE "report_jobs" ADD COLUMN IF NOT EXISTS "previous_job_id" TEXT;

-- CreateIndex: speed up lookups for previous period linking
CREATE INDEX IF NOT EXISTS "report_jobs_institution_id_status_idx" ON "report_jobs"("institution_id", "status");
