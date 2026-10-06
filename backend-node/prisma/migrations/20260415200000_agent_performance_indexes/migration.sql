-- Agent Performance Indexes (Terminal F3)
-- Optimizes the hot-path queries surfaced by the agent-api layer:
--   1. "Recent runs for this institution" (agent-runs.controller GET /runs)
--   2. "Open alerts by severity" (alerts.controller GET /alerts)
--   3. "Audit chain for a run" (export.controller GET /trace)
--   4. "Dedup check on alert creation" (risk-monitor agent)
--   5. "Cost rollup per institution per month" (cost-summary API)
--
-- Notes on non-CONCURRENTLY index creation:
--   The three agent tables (agent_runs, agent_audit_logs, agent_alerts)
--   are created by migration 20260415120000 and are empty at the time
--   this migration runs on production. CREATE INDEX on an empty table
--   is effectively instantaneous — CONCURRENTLY only matters when the
--   table already holds significant data and we need to avoid a full
--   AccessExclusiveLock. Prisma's CI drift check (`migrate diff`) wraps
--   each migration in a transaction, which makes CONCURRENTLY incompatible
--   (ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction
--   block). Dropping CONCURRENTLY lets the same migration succeed in
--   drift-check + the initial deploy + any future replay against a
--   fresh shadow DB without the Prisma P3006 error.

-- ═══ agent_runs ═══════════════════════════════════════════════════════
-- Composite covering index for the runs-list endpoint filtered by agent
-- type and date range. INCLUDE output avoids a heap lookup for the list
-- view that only shows summary fields.
CREATE INDEX IF NOT EXISTS idx_agent_runs_inst_agent_created
  ON agent_runs (institution_id, agent_id, created_at DESC)
  INCLUDE (status, duration_ms, cost_usd_cents);

-- Partial index for active runs (QUEUED/RUNNING) — the queue poller
-- and SSE "is anything running?" check both hit this.
CREATE INDEX IF NOT EXISTS idx_agent_runs_active
  ON agent_runs (status, created_at)
  WHERE status IN ('QUEUED', 'RUNNING');

-- Cost rollup: monthly cost per institution, partitioned by agent.
CREATE INDEX IF NOT EXISTS idx_agent_runs_cost_rollup
  ON agent_runs (institution_id, agent_id, created_at)
  WHERE cost_usd_cents IS NOT NULL AND status = 'SUCCEEDED';

-- ═══ agent_audit_logs ═════════════════════════════════════════════════
-- The trace viewer and regulator export walk the chain in step_index order.
-- B-tree on (run_id, step_index) already exists via @@unique; add a
-- covering index that includes the hash for chain-verification reads
-- without touching the payload column (which can be large).
CREATE INDEX IF NOT EXISTS idx_agent_audit_chain_verify
  ON agent_audit_logs (run_id, step_index)
  INCLUDE (prev_hash, hash, step_kind);

-- Tool-name index for "which runs called this tool?" analytics.
CREATE INDEX IF NOT EXISTS idx_agent_audit_tool
  ON agent_audit_logs (tool_name, created_at DESC)
  WHERE tool_name IS NOT NULL;

-- ═══ agent_alerts ═════════════════════════════════════════════════════
-- The alert feed shows open alerts sorted by severity + recency.
-- Partial index excludes resolved/suppressed alerts from the hot path.
CREATE INDEX IF NOT EXISTS idx_agent_alerts_open_feed
  ON agent_alerts (institution_id, severity, created_at DESC)
  WHERE status IN ('OPEN', 'ACKNOWLEDGED');

-- Dedup check: the risk-monitor agent checks for existing OPEN alerts
-- with the same dedup_key before creating a new one.
CREATE INDEX IF NOT EXISTS idx_agent_alerts_dedup
  ON agent_alerts (institution_id, dedup_key)
  WHERE status = 'OPEN';

-- ═══ Audit log retention (full btree on created_at for cleanup scan) ══
-- The data-retention cron job (src/jobs/data-retention.service.ts) runs:
--   DELETE FROM agent_audit_logs WHERE created_at < now() - interval '$X days';
-- and a plain ascending btree on created_at supports that range scan
-- efficiently. A partial-index with a moving threshold would have been
-- tempting but PostgreSQL rejects non-IMMUTABLE functions (e.g. now())
-- in index predicates — the predicate would bake in the migration-time
-- timestamp and become stale immediately.
CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at
  ON agent_audit_logs (created_at);
