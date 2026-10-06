import { isSchedulerDisabled } from './scheduler-flag.util';

// Truth table for AGENT_SCHEDULER_DISABLED. This spec locks the
// contract that both AgentSchedulerService and the /schedule API
// endpoint depend on. If someone changes the rule to "any truthy
// string disables", `AGENT_SCHEDULER_DISABLED=false` will start
// meaning "disabled" again — and the dashboard will start lying.
describe('isSchedulerDisabled', () => {
  const cases: Array<[string | undefined, boolean]> = [
    [undefined, false], // unset → enabled
    ['true', true],
    ['1', true],
    ['false', false], // explicit false → enabled
    ['0', false],
  ];

  it.each(cases)(
    'AGENT_SCHEDULER_DISABLED=%p → disabled=%p',
    (raw, expected) => {
      const env = raw === undefined ? {} : { AGENT_SCHEDULER_DISABLED: raw };
      expect(isSchedulerDisabled(env as NodeJS.ProcessEnv)).toBe(expected);
    },
  );

  it('treats the unset env as enabled (not disabled)', () => {
    expect(isSchedulerDisabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
