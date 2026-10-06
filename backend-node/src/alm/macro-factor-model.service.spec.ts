import { MacroFactorModelService } from './macro-factor-model.service';

describe('MacroFactorModelService', () => {
  let service: MacroFactorModelService;

  beforeEach(() => {
    service = new MacroFactorModelService({} as any);
  });

  it('should return 5 scenarios including baseline', async () => {
    const result = await service.computeMacroImpact('inst-1');
    expect(result.scenarios).toHaveLength(5);
    expect(result.baselineScenario.name).toBe('Baseline');
  });

  it('baseline scenario should have zero NII impact', async () => {
    const result = await service.computeMacroImpact('inst-1');
    const baseline = result.scenarios.find(
      (s) => s.scenario.name === 'Baseline',
    );
    expect(baseline!.niiImpactPct).toBeCloseTo(0, 1);
    expect(baseline!.nplImpactBps).toBeCloseTo(0, 0);
  });

  it('hurricane scenario should show negative NII and deposit growth', async () => {
    const result = await service.computeMacroImpact('inst-1');
    const hurricane = result.scenarios.find(
      (s) => s.scenario.name === 'Hurricane Disruption',
    );
    expect(hurricane!.niiImpactPct).toBeLessThan(0);
    expect(hurricane!.depositGrowth).toBeLessThan(0);
  });

  it('sensitivity table should have 5 factors', async () => {
    const result = await service.computeMacroImpact('inst-1');
    expect(result.sensitivity).toHaveLength(5);
    expect(result.sensitivity[0].factor).toContain('GDP');
  });

  it('fed funds sensitivity should reflect 40% NII beta', async () => {
    const result = await service.computeMacroImpact('inst-1');
    const fedFunds = result.sensitivity.find((s) =>
      s.factor.includes('Fed Funds'),
    );
    expect(fedFunds!.niiSensitivity).toBeCloseTo(40, 0);
  });

  it('currentRegime should be PLATEAU', async () => {
    const result = await service.computeMacroImpact('inst-1');
    expect(result.currentRegime).toBe('PLATEAU');
  });
});
