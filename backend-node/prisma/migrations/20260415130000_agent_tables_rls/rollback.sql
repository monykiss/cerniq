-- Rollback: Agent Execution Layer RLS policies
-- Run this ONLY if you need to revert the RLS migration.
-- WARNING: Removing RLS exposes all agent data to any authenticated request.
-- This should only be used in emergencies, never in production without
-- immediately re-applying a corrected migration.

-- 1. Drop policies on agent_alerts
DROP POLICY IF EXISTS tenant_isolation_agent_alerts ON "agent_alerts";
DROP POLICY IF EXISTS admin_bypass_agent_alerts ON "agent_alerts";
ALTER TABLE "agent_alerts" DISABLE ROW LEVEL SECURITY;

-- 2. Drop policies on agent_audit_logs + restore UPDATE/DELETE
DROP POLICY IF EXISTS tenant_isolation_agent_audit_logs ON "agent_audit_logs";
DROP POLICY IF EXISTS allow_insert_agent_audit_logs ON "agent_audit_logs";
DROP POLICY IF EXISTS admin_bypass_agent_audit_logs ON "agent_audit_logs";
ALTER TABLE "agent_audit_logs" DISABLE ROW LEVEL SECURITY;

-- Restore UPDATE/DELETE on audit logs (reverting ADR-004 immutability)
DO $$
DECLARE
  app_role TEXT;
BEGIN
  app_role := current_user;
  EXECUTE format(
    'GRANT UPDATE, DELETE ON TABLE "agent_audit_logs" TO %I',
    app_role
  );
  RAISE NOTICE 'Restored UPDATE + DELETE on agent_audit_logs for %', app_role;
END $$;

-- 3. Drop policies on agent_runs
DROP POLICY IF EXISTS tenant_isolation_agent_runs ON "agent_runs";
DROP POLICY IF EXISTS admin_bypass_agent_runs ON "agent_runs";
ALTER TABLE "agent_runs" DISABLE ROW LEVEL SECURITY;

-- Verify
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['agent_runs', 'agent_audit_logs', 'agent_alerts'])
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE tablename = tbl AND rowsecurity = TRUE
    ) THEN
      RAISE EXCEPTION 'RLS still enabled on % after rollback', tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'RLS rollback verified — all three tables have RLS disabled';
END $$;
