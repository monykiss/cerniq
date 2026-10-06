import { AgentSchedulerService } from './agent-scheduler.service';

describe('AgentSchedulerService', () => {
  let service: AgentSchedulerService;
  let mockPrisma: any;
  let mockTrigger: any;
  let mockCostBreaker: any;

  beforeEach(() => {
    mockPrisma = {
      agentRun: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    mockTrigger = {
      runScheduledMonitor: jest.fn().mockResolvedValue(undefined),
    };
    mockCostBreaker = {
      isAllowed: jest.fn().mockResolvedValue({ allowed: true, state: 'OK' }),
    };
    service = new AgentSchedulerService(
      mockPrisma,
      mockTrigger,
      mockCostBreaker,
    );
    service.onModuleInit();
  });

  it('dispatches daily scan for each active institution', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { institutionId: 'inst-1', organizationId: 'org-1' },
      { institutionId: 'inst-2', organizationId: null },
    ]);

    const result = await service.dispatchForAllInstitutions('daily');
    expect(result.dispatched).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockTrigger.runScheduledMonitor).toHaveBeenCalledTimes(2);
    expect(mockTrigger.runScheduledMonitor).toHaveBeenCalledWith(
      'inst-1',
      'daily',
      'org-1',
    );
  });

  it('skips institutions over budget', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { institutionId: 'inst-1', organizationId: null },
      { institutionId: 'inst-2', organizationId: null },
    ]);
    mockCostBreaker.isAllowed.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'inst-2'
          ? { allowed: false, state: 'BLOCKED' }
          : { allowed: true, state: 'OK' },
      ),
    );

    const result = await service.dispatchForAllInstitutions('daily');
    expect(result.dispatched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockTrigger.runScheduledMonitor).toHaveBeenCalledTimes(1);
  });

  it('returns zeroes when no active institutions', async () => {
    const result = await service.dispatchForAllInstitutions('weekly');
    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockTrigger.runScheduledMonitor).not.toHaveBeenCalled();
  });

  it('counts failed dispatches without crashing the batch', async () => {
    mockPrisma.agentRun.findMany.mockResolvedValue([
      { institutionId: 'inst-1', organizationId: null },
      { institutionId: 'inst-2', organizationId: null },
    ]);
    mockTrigger.runScheduledMonitor.mockImplementation((id: string) =>
      id === 'inst-2' ? Promise.reject(new Error('boom')) : Promise.resolve(),
    );

    const result = await service.dispatchForAllInstitutions('monthly');
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(1);
  });
});
