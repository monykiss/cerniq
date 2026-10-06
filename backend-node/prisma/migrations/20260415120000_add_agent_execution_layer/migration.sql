-- Agent Execution Layer (Blueprint §1)
--
-- Three tables that form the substrate for the 12 CERNIQ agents:
--   agent_runs        — one row per invocation (lifecycle + metering)
--   agent_audit_logs  — append-only, hash-chained per-run trace
--   agent_alerts      — Risk Monitor outputs, deduped by (institution, dedup_key)
--
-- Every row carries institutionId (primary tenant scope) and, where applicable,
-- organizationId. All enum CREATEs use the duplicate_object guard so the
-- migration is safe to re-run against a partially-applied database.

-- ─── Enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "AgentId" AS ENUM (
    'ALM_DECISION',
    'COMMITTEE_REPORT',
    'RISK_MONITOR',
    'CFO_COPILOT',
    'STRESS_TESTING',
    'CAPITAL_OPTIMIZER',
    'REGULATORY_COMPLIANCE',
    'EXAM_PREP',
    'LOAN_PRICING',
    'DEPOSIT_STRATEGY',
    'PEER_INTELLIGENCE',
    'BOARD_NARRATIVE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentRunStatus" AS ENUM (
    'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentTriggerKind" AS ENUM (
    'UPLOAD', 'SCHEDULE', 'USER_QUERY', 'API', 'CHAIN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentAuditStepKind" AS ENUM (
    'RUN_STARTED',
    'TOOL_CALL',
    'TOOL_RESULT',
    'LLM_TURN',
    'CONTRACT_VALIDATION',
    'RUN_COMPLETED',
    'RUN_FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentAlertSeverity" AS ENUM (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentAlertStatus" AS ENUM (
    'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── agent_runs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id"                   TEXT NOT NULL,
  "agent_id"             "AgentId" NOT NULL,
  "agent_version"        TEXT NOT NULL DEFAULT '1.0.0',
  "prompt_version"       TEXT NOT NULL DEFAULT '1.0.0',
  "institution_id"       TEXT,
  "organization_id"      UUID,
  "triggered_by_user_id" UUID,
  "trigger_kind"         "AgentTriggerKind" NOT NULL DEFAULT 'API',
  "trigger_ref"          TEXT,
  "idempotency_key"      TEXT NOT NULL,
  "status"               "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
  "input"                JSONB NOT NULL,
  "output"               JSONB,
  "error_message"        TEXT,
  "error_code"           TEXT,
  "tool_call_count"      INTEGER NOT NULL DEFAULT 0,
  "llm_turn_count"       INTEGER NOT NULL DEFAULT 0,
  "input_tokens"         INTEGER,
  "output_tokens"        INTEGER,
  "cost_usd_cents"       INTEGER,
  "duration_ms"          INTEGER,
  "audit_root_hash"      TEXT,
  "started_at"           TIMESTAMP(3),
  "completed_at"         TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_agent_id_idempotency_key_key"
  ON "agent_runs" ("agent_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "agent_runs_institution_id_agent_id_created_at_idx"
  ON "agent_runs" ("institution_id", "agent_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_runs_organization_id_created_at_idx"
  ON "agent_runs" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_runs_status_created_at_idx"
  ON "agent_runs" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "agent_runs_agent_id_status_idx"
  ON "agent_runs" ("agent_id", "status");

-- ─── agent_audit_logs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_audit_logs" (
  "id"          TEXT NOT NULL,
  "run_id"      TEXT NOT NULL,
  "step_index"  INTEGER NOT NULL,
  "step_kind"   "AgentAuditStepKind" NOT NULL,
  "tool_name"   TEXT,
  "payload"     JSONB NOT NULL,
  "prev_hash"   TEXT,
  "hash"        TEXT NOT NULL,
  "duration_ms" INTEGER,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_audit_logs_run_id_step_index_key"
  ON "agent_audit_logs" ("run_id", "step_index");

CREATE INDEX IF NOT EXISTS "agent_audit_logs_run_id_created_at_idx"
  ON "agent_audit_logs" ("run_id", "created_at");

CREATE INDEX IF NOT EXISTS "agent_audit_logs_tool_name_idx"
  ON "agent_audit_logs" ("tool_name");

DO $$ BEGIN
  ALTER TABLE "agent_audit_logs"
    ADD CONSTRAINT "agent_audit_logs_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── agent_alerts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "agent_alerts" (
  "id"              TEXT NOT NULL,
  "run_id"          TEXT,
  "agent_id"        "AgentId" NOT NULL,
  "institution_id"  TEXT NOT NULL,
  "organization_id" UUID,
  "category"        TEXT NOT NULL,
  "severity"        "AgentAlertSeverity" NOT NULL,
  "metric"          TEXT NOT NULL,
  "current_value"   DECIMAL(24, 6),
  "threshold"       DECIMAL(24, 6),
  "delta"           DECIMAL(24, 6),
  "trend"           TEXT,
  "finding"         TEXT NOT NULL,
  "finding_es"      TEXT,
  "recommendation"  TEXT NOT NULL,
  "regulatory_ref"  TEXT,
  "deadline"        TIMESTAMP(3),
  "dedup_key"       TEXT NOT NULL,
  "status"          "AgentAlertStatus" NOT NULL DEFAULT 'OPEN',
  "acknowledged_by" UUID,
  "acknowledged_at" TIMESTAMP(3),
  "resolved_at"     TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_alerts_institution_id_dedup_key_status_idx"
  ON "agent_alerts" ("institution_id", "dedup_key", "status");

CREATE INDEX IF NOT EXISTS "agent_alerts_institution_id_severity_created_at_idx"
  ON "agent_alerts" ("institution_id", "severity", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_alerts_agent_id_severity_status_idx"
  ON "agent_alerts" ("agent_id", "severity", "status");

CREATE INDEX IF NOT EXISTS "agent_alerts_status_created_at_idx"
  ON "agent_alerts" ("status", "created_at" DESC);

DO $$ BEGIN
  ALTER TABLE "agent_alerts"
    ADD CONSTRAINT "agent_alerts_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
