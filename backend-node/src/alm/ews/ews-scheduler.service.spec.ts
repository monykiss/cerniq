import { EwsSchedulerService } from './ews-scheduler.service';
import { isEwsSchedulerDisabled } from './ews-scheduler-flag.util';

describe('ews-scheduler-flag util — truth table (W1.3)', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    [undefined, false],
    ['', false],
    ['yes', false], // schema pins the enum; unknown strings never disable
  ] as const)('EWS_SCHEDULER_DISABLED=%p → disabled=%p', (raw, expected) => {
    const env: NodeJS.ProcessEnv = {};
    if (raw !== undefined) env.EWS_SCHEDULER_DISABLED = raw;
    expect(isEwsSchedulerDisabled(env)).toBe(expected);
  });
});

describe('EwsSchedulerService — daily capture (W1.3)', () => {
  let prisma: { institution: { findMany: jest.Mock } };
  let snapshots: { captureSnapshot: jest.Mock };
  let svc: EwsSchedulerService;

  beforeEach(() => {
    delete process.env.EWS_SCHEDULER_DISABLED;
    prisma = {
      institution: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'inst-1' }, { id: 'inst-2' }]),
      },
    };
    snapshots = {
      captureSnapshot: jest.fn().mockResolvedValue({ alerts: [] }),
    };
    // type-rationale: structural test doubles for the injected services
    svc = new EwsSchedulerService(prisma as any, snapshots as any);
  });

  afterEach(() => {
    delete process.env.EWS_SCHEDULER_DISABLED;
  });

  it('captures every institution with source=scheduled', async () => {
    const summary = await svc.captureAll('scheduled');
    expect(snapshots.captureSnapshot).toHaveBeenCalledTimes(2);
    expect(snapshots.captureSnapshot).toHaveBeenCalledWith('inst-1', {
      source: 'scheduled',
    });
    expect(summary).toEqual({ captured: 2, failed: 0, alertsRaised: 0 });
  });

  it('one broken institution never blocks the rest — failure is counted, not swallowed', async () => {
    snapshots.captureSnapshot
      .mockRejectedValueOnce(new Error('inst-1 exploded'))
      .mockResolvedValueOnce({
        alerts: [{ type: 'composite_drop', severity: 'warning' }],
      });
    const summary = await svc.captureAll('scheduled');
    expect(summary).toEqual({ captured: 1, failed: 1, alertsRaised: 1 });
  });

  it('the cron entrypoint skips entirely when EWS_SCHEDULER_DISABLED=true', async () => {
    process.env.EWS_SCHEDULER_DISABLED = 'true';
    await svc.captureDaily();
    expect(prisma.institution.findMany).not.toHaveBeenCalled();
    expect(snapshots.captureSnapshot).not.toHaveBeenCalled();
  });

  it('the cron entrypoint runs when the flag is unset', async () => {
    await svc.captureDaily();
    expect(snapshots.captureSnapshot).toHaveBeenCalledTimes(2);
  });
});
