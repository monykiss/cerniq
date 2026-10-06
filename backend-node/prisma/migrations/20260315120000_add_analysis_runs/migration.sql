-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
    "analysis_type" TEXT NOT NULL DEFAULT 'full_analysis',
    "triggered_by" TEXT NOT NULL DEFAULT 'manual',
    "model_version" TEXT NOT NULL DEFAULT 'alm-v1',
    "scenario_set" TEXT NOT NULL DEFAULT 'base_parallel_shocks',
    "assumptions" JSONB,
    "parameter_snapshot" JSONB NOT NULL,
    "balance_sheet_snapshot" JSONB NOT NULL,
    "result_summary" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_runs_institution_id_created_at_idx" ON "analysis_runs"("institution_id", "created_at");
CREATE INDEX "analysis_runs_created_by_user_id_created_at_idx" ON "analysis_runs"("created_by_user_id", "created_at");
CREATE INDEX "analysis_runs_status_idx" ON "analysis_runs"("status");

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
