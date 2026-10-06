// Single source of truth for interpreting AGENT_SCHEDULER_DISABLED.
//
// Two sites care about the value: (1) AgentSchedulerService gates its
// @Cron handlers; (2) the /api/agent-runs/schedule endpoint reports the
// state to the dashboard. Before this helper they used different truthiness
// rules — the scheduler required `'true' | '1'`, the controller used raw
// JS truthiness — so `AGENT_SCHEDULER_DISABLED=false` meant "disabled"
// to the controller and "enabled" to the scheduler. The dashboard would
// show the wrong state.
//
// The env var's accepted values are pinned in `env.schema.ts` to the
// enum ['true','false','1','0'], which prevents ambiguous inputs from
// reaching this helper in the first place.

export function isSchedulerDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.AGENT_SCHEDULER_DISABLED;
  return raw === 'true' || raw === '1';
}
