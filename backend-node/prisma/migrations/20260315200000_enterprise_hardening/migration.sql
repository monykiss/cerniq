-- Enterprise Hardening: RBAC, Institution Profile, Feedback

-- Add InstitutionRole enum and role field to users
DO $$ BEGIN
  CREATE TYPE "InstitutionRole" AS ENUM ('OWNER', 'ANALYST', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "InstitutionRole" NOT NULL DEFAULT 'OWNER';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

-- Expand institution profile for COSSEC compliance
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "cossec_registration_number" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "fiscal_year_end" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "alco_meeting_frequency" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "alco_next_date" TIMESTAMP(3);
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "last_exam_date" TIMESTAMP(3);
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "next_exam_date" TIMESTAMP(3);
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "primary_regulator" TEXT NOT NULL DEFAULT 'COSSEC';
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "contact_name" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "preferred_language" TEXT NOT NULL DEFAULT 'es';

-- Expand audit_logs for full compliance tracking (skip if table not yet created)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "institution_id" TEXT;
    ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "outcome" TEXT NOT NULL DEFAULT 'success';
    ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
    CREATE INDEX IF NOT EXISTS "audit_logs_institution_id_created_at_idx" ON "audit_logs"("institution_id", "created_at");
  END IF;
END $$;

-- Create feedback/NPS table
CREATE TABLE IF NOT EXISTS "feedback" (
  "id" TEXT NOT NULL,
  "institution_id" TEXT,
  "job_id" TEXT,
  "nps_score" INTEGER,
  "comment" TEXT,
  "contact_ok" BOOLEAN NOT NULL DEFAULT false,
  "responded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "feedback_institution_id_idx" ON "feedback"("institution_id");
