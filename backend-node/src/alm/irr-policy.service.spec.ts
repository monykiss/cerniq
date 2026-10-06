import { IRRPolicyService } from './irr-policy.service';

describe('IRRPolicyService', () => {
  let service: IRRPolicyService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      iRRPolicyLimit: {
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      balanceSheetItem: { findMany: jest.fn() },
      policyBreachLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new IRRPolicyService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getLimits ─────────────────────────────────────────────────

  it('returns default limits when no custom limits exist', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([]);
    const limits = await service.getLimits('inst_1');

    expect(limits.length).toBeGreaterThanOrEqual(6);
    const eveLimits = limits.filter((l) => l.limitType === 'EVE_PCT');
    expect(eveLimits.length).toBe(2);
  });

  it('returns custom limits when they exist', async () => {
    const custom = [
      {
        limitType: 'CUSTOM',
        scenario: 'test',
        watchPct: 5,
        warningPct: 10,
        breachPct: 15,
        regulatoryRef: 'Custom Ref',
      },
    ];
    prisma.iRRPolicyLimit.findMany.mockResolvedValue(custom);
    const limits = await service.getLimits('inst_1');
    expect(limits).toEqual(custom);
  });

  // ── saveLimits ────────────────────────────────────────────────

  it('saves custom limits and returns count', async () => {
    const result = await service.saveLimits('inst_1', [
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 10,
        warningPct: 15,
        breachPct: 20,
        regulatoryRef: 'Test',
      },
      {
        limitType: 'NII_AT_RISK',
        scenario: '+200bps',
        watchPct: 8,
        warningPct: 12,
        breachPct: 16,
        regulatoryRef: 'Test',
      },
    ]);

    expect(result.saved).toBe(2);
    expect(prisma.iRRPolicyLimit.deleteMany).toHaveBeenCalledWith({
      where: { institutionId: 'inst_1' },
    });
    expect(prisma.iRRPolicyLimit.createMany).toHaveBeenCalled();
  });

  // ── checkAll — demo metrics (no balance sheet items) ──────────

  it('returns dashboard with demo metrics when no balance sheet items', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');

    expect(dashboard.checks.length).toBeGreaterThanOrEqual(6);
    expect(['GREEN', 'AMBER', 'RED']).toContain(dashboard.overallStatus);
    expect(dashboard.lastChecked).toBeDefined();
    expect(
      dashboard.breachCount + dashboard.warningCount + dashboard.watchCount,
    ).toBeGreaterThanOrEqual(0);
  });

  it('classifies levels correctly: COMPLIANT < WATCH < WARNING < BREACH', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');

    for (const check of dashboard.checks) {
      const absVal = Math.abs(check.actualValue);
      if (check.level === 'BREACH') {
        expect(absVal).toBeGreaterThanOrEqual(check.breachPct);
      } else if (check.level === 'COMPLIANT') {
        expect(absVal).toBeLessThan(check.watchPct);
      }
    }
  });

  // ── checkAll — with balance sheet items (computed metrics) ────

  it('computes metrics from balance sheet items', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([
      { category: 'asset', balance: 100, duration: 5, rate: 0.05 },
      { category: 'asset', balance: 50, duration: 2, rate: 0.03 },
      { category: 'liability', balance: 80, duration: 1, rate: 0.02 },
      { category: 'liability', balance: 40, duration: 3, rate: 0.04 },
    ]);

    const dashboard = await service.checkAll('inst_1');
    expect(dashboard.checks.length).toBeGreaterThanOrEqual(6);
    // Each check should have numeric actualValue
    for (const check of dashboard.checks) {
      expect(typeof check.actualValue).toBe('number');
      expect(typeof check.utilizationPct).toBe('number');
    }
  });

  // ── checkAll — breach detection and logging ───────────────────

  it('logs breaches for WARNING and BREACH levels', async () => {
    // Set very low thresholds so demo metrics trigger breaches
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 1,
        warningPct: 2,
        breachPct: 3,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    await service.checkAll('inst_1');

    // The demo metric for EVE_PCT:+200bps is -15.2, |15.2| > 3 => BREACH
    expect(prisma.policyBreachLog.create).toHaveBeenCalled();
  });

  it('does not log duplicates if recent breach exists', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 1,
        warningPct: 2,
        breachPct: 3,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);
    // Simulate a recent breach already logged
    prisma.policyBreachLog.findFirst.mockResolvedValue({
      id: 'existing',
      limitType: 'EVE_PCT',
    });

    await service.checkAll('inst_1');

    expect(prisma.policyBreachLog.create).not.toHaveBeenCalled();
  });

  // ── checkAll — overall status ─────────────────────────────────

  it('returns RED when there are breaches', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 1,
        warningPct: 2,
        breachPct: 3,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');
    expect(dashboard.overallStatus).toBe('RED');
    expect(dashboard.breachCount).toBeGreaterThanOrEqual(1);
  });

  it('returns GREEN when all limits are compliant', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 99,
        warningPct: 99,
        breachPct: 99,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');
    expect(dashboard.overallStatus).toBe('GREEN');
    expect(dashboard.breachCount).toBe(0);
    expect(dashboard.warningCount).toBe(0);
  });

  // ── checkAll — utilization calculation ────────────────────────

  it('calculates utilization as 0 when breachPct is 0', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 0,
        warningPct: 0,
        breachPct: 0,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');
    const check = dashboard.checks[0];
    expect(check.utilizationPct).toBe(0);
  });

  // ── checkAll — unknown metric key returns 0 ───────────────────

  it('returns 0 for metrics that do not exist in the metrics map', async () => {
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'UNKNOWN_METRIC',
        scenario: 'some_scenario',
        watchPct: 10,
        warningPct: 20,
        breachPct: 30,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');
    const unknownCheck = dashboard.checks.find(
      (c) => c.limitType === 'UNKNOWN_METRIC',
    );
    expect(unknownCheck).toBeDefined();
    expect(unknownCheck!.actualValue).toBe(0);
    expect(unknownCheck!.level).toBe('COMPLIANT');
  });

  // ── getBreachHistory ──────────────────────────────────────────

  it('returns breach history from prisma', async () => {
    prisma.policyBreachLog.findMany.mockResolvedValue([
      { limitType: 'EVE_PCT', breachLevel: 'BREACH', actualValue: 28 },
    ]);

    const history = await service.getBreachHistory('inst_1', 10);
    expect(history).toHaveLength(1);
    expect(history[0].limitType).toBe('EVE_PCT');
  });

  it('uses default limit of 50 when not specified', async () => {
    prisma.policyBreachLog.findMany.mockResolvedValue([]);
    await service.getBreachHistory('inst_1');
    expect(prisma.policyBreachLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  // ── AMBER status ──────────────────────────────────────────────

  it('returns AMBER when there are warnings but no breaches', async () => {
    // EVE_PCT demo value is -15.2 (abs=15.2)
    // Set thresholds so it is WARNING but not BREACH
    prisma.iRRPolicyLimit.findMany.mockResolvedValue([
      {
        limitType: 'EVE_PCT',
        scenario: '+200bps',
        watchPct: 10,
        warningPct: 14,
        breachPct: 50,
        regulatoryRef: 'Test',
      },
    ]);
    prisma.balanceSheetItem.findMany.mockResolvedValue([]);

    const dashboard = await service.checkAll('inst_1');
    expect(dashboard.overallStatus).toBe('AMBER');
    expect(dashboard.warningCount).toBeGreaterThanOrEqual(1);
    expect(dashboard.breachCount).toBe(0);
  });
});
