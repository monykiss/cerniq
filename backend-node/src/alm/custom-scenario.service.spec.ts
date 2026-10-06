import { BadRequestException } from '@nestjs/common';
import { CustomScenarioService } from './custom-scenario.service';

function mockSvc(): any {
  return new Proxy(
    {},
    {
      get: (_t: any, p: any) =>
        typeof p === 'symbol' ? undefined : jest.fn().mockResolvedValue(null),
    },
  );
}

describe('CustomScenarioService', () => {
  let service: CustomScenarioService;
  let almEnterprise: Record<string, jest.Mock>;
  let scenarioPersistence: Record<string, jest.Mock>;

  const baseNIISensitivity = {
    baseNII: 5.2,
    scenarios: [
      { shiftBps: -200, niImpact: -1.8, mveImpact: 0 },
      { shiftBps: -100, niImpact: -0.9, mveImpact: 0 },
      { shiftBps: 0, niImpact: 0, mveImpact: 0 },
      { shiftBps: 100, niImpact: 0.8, mveImpact: 0 },
      { shiftBps: 200, niImpact: 1.5, mveImpact: 0 },
      { shiftBps: 300, niImpact: 2.1, mveImpact: 0 },
    ],
  };

  const baseLiquidity = { lcr: 142, nsfr: 118, status: 'compliant' };

  const baseCOSSEC = {
    summary: {
      totalAssets: 250_000_000,
      totalLoans: 150_000_000,
      totalShares: 120_000_000,
      capitalRatio: 12.5,
    },
  };

  const baseDurationGap = { durationGap: 2.1, riskProfile: 'asset-sensitive' };

  beforeEach(() => {
    almEnterprise = {
      calculateNIISensitivity: jest.fn().mockResolvedValue(baseNIISensitivity),
      calculateLCR: jest.fn().mockResolvedValue(baseLiquidity),
      getCOSSECCompliance: jest.fn().mockResolvedValue(baseCOSSEC),
      calculateDurationGap: jest.fn().mockResolvedValue(baseDurationGap),
    };

    scenarioPersistence = {
      persist: jest.fn().mockResolvedValue({ id: 'scen-1' }),
      saveScenario: jest.fn().mockResolvedValue({
        id: 'scen-1',
        name: 'Test',
        createdAt: new Date(),
      }),
    };

    service = new CustomScenarioService(
      mockSvc(), // prisma
      almEnterprise as any,
      mockSvc(), // stressTesting
      scenarioPersistence as any,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('runs a basic +200bps scenario', async () => {
    const result = await service.runCustomScenario('inst-1', {
      name: 'Rate Hike 200bps',
      rateShiftBps: 200,
    });

    expect(result.scenario.name).toBe('Rate Hike 200bps');
    expect(result.niiImpact).toBeDefined();
    expect(result.eveChange).toBeDefined();
    expect(result.lcrImpact).toBeDefined();
    expect(result.capitalImpact).toBeDefined();
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it('rejects rate shift outside [-300, +300] range', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Extreme',
        rateShiftBps: 500,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('negative rate shift produces negative NII impact for asset-sensitive institution', async () => {
    const result = await service.runCustomScenario('inst-1', {
      name: 'Rate Cut',
      rateShiftBps: -200,
    });
    expect(result.niiImpact).toBeLessThan(0);
  });

  it('deposit runoff reduces LCR', async () => {
    const noRunoff = await service.runCustomScenario('inst-1', {
      name: 'Base',
      rateShiftBps: 100,
      depositRunoff: 0,
    });
    const withRunoff = await service.runCustomScenario('inst-1', {
      name: 'Deposit Flight',
      rateShiftBps: 100,
      depositRunoff: 20,
    });
    expect(noRunoff.lcrImpact).not.toBeNull();
    expect(withRunoff.lcrImpact).not.toBeNull();
    expect(withRunoff.lcrImpact!).toBeLessThan(noRunoff.lcrImpact!);
  });

  it('loan default increase impacts capital', async () => {
    const noDefaults = await service.runCustomScenario('inst-1', {
      name: 'Base',
      rateShiftBps: 0,
      loanDefaultIncrease: 0,
    });
    const withDefaults = await service.runCustomScenario('inst-1', {
      name: 'Credit Stress',
      rateShiftBps: 0,
      loanDefaultIncrease: 10,
    });
    expect(noDefaults.capitalImpact).not.toBeNull();
    expect(withDefaults.capitalImpact).not.toBeNull();
    expect(withDefaults.capitalImpact!).toBeLessThan(noDefaults.capitalImpact!);
  });

  it('throws BadRequestException when institution data unavailable', async () => {
    almEnterprise.calculateNIISensitivity.mockRejectedValue(
      new Error('Institution not found'),
    );

    await expect(
      service.runCustomScenario('nonexistent', {
        name: 'Test',
        rateShiftBps: 100,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid scenario name', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: '',
        rateShiftBps: 100,
      }),
    ).rejects.toThrow();
  });

  // ── Coverage boost: validation branches ──

  it('rejects scenario name longer than 200 characters', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'A'.repeat(201),
        rateShiftBps: 100,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-finite rateShiftBps (NaN)', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Test',
        rateShiftBps: NaN,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects yieldCurveTwist outside [-200, +200]', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Test',
        rateShiftBps: 100,
        yieldCurveTwist: 250,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects depositRunoff outside [0, 30]', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Test',
        rateShiftBps: 100,
        depositRunoff: 35,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects loanDefaultIncrease outside [0, 15]', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Test',
        rateShiftBps: 100,
        loanDefaultIncrease: 20,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects prepaymentMultiplier outside [0.5, 3]', async () => {
    await expect(
      service.runCustomScenario('inst-1', {
        name: 'Test',
        rateShiftBps: 100,
        prepaymentMultiplier: 0.1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('yield curve twist affects NII and EVE', async () => {
    const withTwist = await service.runCustomScenario('inst-1', {
      name: 'Twist Test',
      rateShiftBps: 100,
      yieldCurveTwist: 100,
    });
    const noTwist = await service.runCustomScenario('inst-1', {
      name: 'No Twist',
      rateShiftBps: 100,
      yieldCurveTwist: 0,
    });
    // With twist, NII and EVE should differ
    expect(withTwist.niiImpact).not.toBe(noTwist.niiImpact);
    expect(withTwist.eveChange).not.toBe(noTwist.eveChange);
  });

  it('prepayment multiplier affects NII in falling-rate environment', async () => {
    const noPrepay = await service.runCustomScenario('inst-1', {
      name: 'No Prepay',
      rateShiftBps: -200,
      prepaymentMultiplier: 1,
    });
    const highPrepay = await service.runCustomScenario('inst-1', {
      name: 'High Prepay',
      rateShiftBps: -200,
      prepaymentMultiplier: 2.5,
    });
    expect(noPrepay.niiImpact).not.toBeNull();
    expect(highPrepay.niiImpact).not.toBeNull();
    expect(highPrepay.niiImpact!).toBeLessThan(noPrepay.niiImpact!);
  });

  it('narrative contains scenario name and shock description', async () => {
    const result = await service.runCustomScenario('inst-1', {
      name: 'Rate Shock Plus',
      rateShiftBps: 200,
      depositRunoff: 10,
      loanDefaultIncrease: 5,
    });
    expect(result.narrative).toContain('Rate Shock Plus');
    expect(result.narrative).toContain('+200bps');
    expect(result.narrative).toContain('10% deposit runoff');
    expect(result.narrative).toContain('5% increase in loan defaults');
  });

  it('rate shock > 100bps triggers additional LCR impact', async () => {
    const low = await service.runCustomScenario('inst-1', {
      name: 'Low',
      rateShiftBps: 50,
    });
    const high = await service.runCustomScenario('inst-1', {
      name: 'High',
      rateShiftBps: 250,
    });
    expect(low.lcrImpact).not.toBeNull();
    expect(high.lcrImpact).not.toBeNull();
    expect(high.lcrImpact!).toBeLessThan(low.lcrImpact!);
  });

  // D1 (2026-04-07): when COSSEC compliance reports data_unavailable,
  // the custom scenario refuses to compute and returns structured null
  // impacts + a CRITICAL gap. Previously the `?? 0` chain would coerce
  // missing data to zero and produce phantom scenarios.
  it('returns data_unavailable when COSSEC inputs are missing', async () => {
    almEnterprise.getCOSSECCompliance.mockResolvedValueOnce({
      summary: {
        totalAssets: 0,
        totalLoans: 0,
        totalShares: 0,
        capitalRatio: 0,
      },
      overallStatus: 'data_unavailable',
      gaps: [
        {
          field: 'cossec.balanceSheet',
          reason: 'EMPTY_BALANCE_SHEET',
          severity: 'CRITICAL',
        },
      ],
    });

    const result = await service.runCustomScenario('inst-1', {
      name: 'Should Not Compute',
      rateShiftBps: 100,
    });

    expect(result.overallStatus).toBe('data_unavailable');
    expect(result.niiImpact).toBeNull();
    expect(result.eveChange).toBeNull();
    expect(result.lcrImpact).toBeNull();
    expect(result.capitalImpact).toBeNull();
    expect(result.gaps).toBeDefined();
    expect(result.gaps!.some((g) => g.field === 'customScenario.cossec')).toBe(
      true,
    );
  });

  it('returns data_unavailable when LCR is null', async () => {
    almEnterprise.calculateLCR.mockResolvedValueOnce({
      lcr: null,
      hqla: null,
      netOutflows: null,
      status: 'data_unavailable',
      buffer: null,
      gaps: [
        {
          field: 'liquidity.lcr',
          reason: 'NO_LIQUIDITY_POSITION',
          severity: 'CRITICAL',
        },
      ],
    });

    const result = await service.runCustomScenario('inst-1', {
      name: 'Should Not Compute',
      rateShiftBps: 100,
    });

    expect(result.overallStatus).toBe('data_unavailable');
    expect(result.lcrImpact).toBeNull();
    expect(result.gaps!.some((g) => g.field === 'customScenario.lcr')).toBe(
      true,
    );
  });
});
