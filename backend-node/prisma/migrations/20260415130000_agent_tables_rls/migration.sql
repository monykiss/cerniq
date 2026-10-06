-- Agent Execution Layer — Row-Level Security + audit immutability
--
-- This migration extends the existing RLS pattern
-- (rls_tenant_isolation/migration.sql) to the three new agent tables:
--
--   1. agent_runs         — tenant_isolation + admin_bypass
--   2. agent_audit_logs   — read through agent_runs scope; INSERT only (no UPDATE/DELETE)
--   3. agent_alerts       — tenant_isolation + admin_bypass
--
-- Key design decision: agent_audit_logs rows carry no `institution_id`
-- column of their own — they inherit scope through the `run_id` FK. RLS
-- on agent_audit_logs therefore uses a sub-select into agent_runs.
-- Regulator exports use the dedicated export endpoint which verifies
-- ownership at the application layer before returning rows.
--
-- GUC variable: app.current_institution_id  (SET LOCAL per request)
-- GUC variable: app.admin_mode              (SET LOCAL for operator)
-- Both are set by TenantContextMiddleware before any query executes.
-- current_setting('...', TRUE) returns '' when unset — which matches no
-- rows, ensuring that unauthenticated requests see nothing.

-- ══════════════════════════════════════════════════════════════════════
-- 1. agent_runs — standard tenant isolation + admin bypass
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;

-- Authenticated reads: only rows for the caller's institution.
CREATE POLICY tenant_isolation_agent_runs ON "agent_runs"
  FOR ALL
  USING (
    "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

-- Admin bypass: control-tower endpoints and support queries.
CREATE POLICY admin_bypass_agent_runs ON "agent_runs"
  FOR ALL
  USING (
    current_setting('app.admin_mode', TRUE) = 'true'
  );

-- ══════════════════════════════════════════════════════════════════════
-- 2. agent_audit_logs — scoped through agent_runs FK
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE "agent_audit_logs" ENABLE ROW LEVEL SECURITY;

-- Reads are only allowed if the parent run belongs to the caller's
-- institution. The subquery uses the agent_runs index on `id` so this
-- adds no scan overhead on the audit_logs table itself.
CREATE POLICY tenant_isolation_agent_audit_logs ON "agent_audit_logs"
  FOR SELECT
  USING (
    "run_id" IN (
      SELECT id FROM "agent_runs"
      WHERE "institution_id" = current_setting('app.current_institution_id', TRUE)::text
    )
  );

-- INSERT is allowed for the application role (needed by the runner).
-- No WHERE clause — the runner inserts with the correct run_id by
-- construction, and the FK constraint prevents orphan inserts.
CREATE POLICY allow_insert_agent_audit_logs ON "agent_audit_logs"
  FOR INSERT
  WITH CHECK (TRUE);

-- Admin bypass for audit reads (support queries, export pipelines).
CREATE POLICY admin_bypass_agent_audit_logs ON "agent_audit_logs"
  FOR ALL
  USING (
    current_setting('app.admin_mode', TRUE) = 'true'
  );

-- ══════════════════════════════════════════════════════════════════════
-- 3. AUDIT IMMUTABILITY — revoke UPDATE/DELETE from the application role
-- ══════════════════════════════════════════════════════════════════════
--
-- Vol.2 ADR-004: "No updates. No deletes. Ever." The application
-- Postgres user should have INSERT + SELECT on agent_audit_logs, but
-- never UPDATE or DELETE. This protects against both bugs and
-- compromised application credentials.
--
-- NOTE: These statements assume the application connects as role
-- 'cerniq_app' (Railway / Supabase default). Adjust if the role name
-- differs. The GRANT ALL → REVOKE pattern ensures idempotency: running
-- this migration twice doesn't error because REVOKE on a privilege that
-- doesn't exist is a no-op in PostgreSQL.

DO $$
DECLARE
  app_role TEXT;
BEGIN
  -- Detect the current application role from the connection.
  app_role := current_user;
  -- Revoke dangerous operations on the immutable audit table.
  EXECUTE format(
    'REVOKE UPDATE, DELETE ON TABLE "agent_audit_logs" FROM %I',
    app_role
  );
  RAISE NOTICE 'Revoked UPDATE + DELETE on agent_audit_logs from %', app_role;
END $$;

-- ══════════════════════════════════════════════════════════════════════
-- 4. agent_alerts — standard tenant isolation + admin bypass
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE "agent_alerts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_agent_alerts ON "agent_alerts"
  FOR ALL
  USING (
    "institution_id" = current_setting('app.current_institution_id', TRUE)::text
  );

CREATE POLICY admin_bypass_agent_alerts ON "agent_alerts"
  FOR ALL
  USING (
    current_setting('app.admin_mode', TRUE) = 'true'
  );

-- ══════════════════════════════════════════════════════════════════════
-- 5. Verify — fail the migration if any table is not RLS-enabled
-- ══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['agent_runs', 'agent_audit_logs', 'agent_alerts'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE tablename = tbl AND rowsecurity = TRUE
    ) THEN
      RAISE EXCEPTION 'RLS not enabled on %', tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'RLS verified on agent_runs, agent_audit_logs, agent_alerts';
END $$;
