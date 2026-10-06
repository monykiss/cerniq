// Single source of truth for interpreting EWS_SCHEDULER_DISABLED.
//
// Same pattern as scheduler-flag.util.ts (the template for shared runtime
// flags): the env var's accepted values are pinned in `env.schema.ts` to the
// enum ['true','false','1','0'], and every consumer goes through this one
// helper so two sites can never interpret the same string with different
// truthiness rules.
//
// Deliberately a SEPARATE flag from AGENT_SCHEDULER_DISABLED: the agent
// crons (LLM monitors, cost) and the EWS daily capture have different blast
// radii — ops must be able to pause one without the other.

export function isEwsSchedulerDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.EWS_SCHEDULER_DISABLED;
  return raw === 'true' || raw === '1';
}
