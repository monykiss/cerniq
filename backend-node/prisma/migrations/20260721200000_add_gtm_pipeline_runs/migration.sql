-- GTM pipeline run history (append-only audit of enrichment executions)
DO $$ BEGIN
  CREATE TYPE "GtmPipelineRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "gtm_pipeline_runs" (
  "id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "status" "GtmPipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger_source" TEXT NOT NULL,
  "summary" JSONB,
  "playbook" JSONB,
  "artifact_path" TEXT,
  "error_message" TEXT,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gtm_pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gtm_pipeline_runs_status_idx" ON "gtm_pipeline_runs"("status");
CREATE INDEX IF NOT EXISTS "gtm_pipeline_runs_started_at_idx" ON "gtm_pipeline_runs"("started_at");
