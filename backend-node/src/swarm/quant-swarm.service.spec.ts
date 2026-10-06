import { QuantSwarmService } from './quant-swarm.service';

describe('QuantSwarmService', () => {
  let service: QuantSwarmService;
  const mockPrisma = {} as any;

  const makeMockService = (result: any) => ({
    getYieldCurveAnalysis: jest.fn().mockResolvedValue(result),
    getAdvancedLiquidity: jest.fn().mockResolvedValue(result),
    getCECLAnalysis: jest.fn().mockResolvedValue(result),
    getConcentrationAnalysis: jest.fn().mockResolvedValue(result),
    getFTPAnalysis: jest.fn().mockResolvedValue(result),
    getPeerAnalytics: jest.fn().mockResolvedValue(result),
    scoreInstitution: jest.fn().mockResolvedValue(result),
    computeClimateRisk: jest.fn().mockResolvedValue(result),
    computeEWS: jest.fn().mockResolvedValue(result),
    calculate: jest.fn().mockResolvedValue(result),
    getRepricingGap: jest.fn().mockResolvedValue(result),
    getDepositBetas: jest.fn().mockResolvedValue(result),
    computeHealthScore: jest.fn().mockResolvedValue({ overall: 75 }),
  });

  const makeFullServices = (mockSvc: ReturnType<typeof makeMockService>) => ({
    yieldCurve: mockSvc,
    liquidity: mockSvc,
    cecl: mockSvc,
    concentration: mockSvc,
    ftp: mockSvc,
    peers: mockSvc,
    camel: mockSvc,
    climate: mockSvc,
    earlyWarning: mockSvc,
    capitalAdequacy: mockSvc,
    repricingGap: mockSvc,
    depositBeta: mockSvc,
    advisor: mockSvc,
  });

  beforeEach(() => {
    service = new QuantSwarmService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('runFullSwarm returns results from all 12 models', async () => {
    const mockSvc = makeMockService({ score: 80 });
    const result = await service.runFullSwarm(
      'inst-1',
      makeFullServices(mockSvc),
    );
    expect(result.institutionId).toBe('inst-1');
    expect(result.completedModels).toHaveLength(12);
    expect(result.failedModels).toHaveLength(0);
    expect(result.healthScore).toBe(75);
    expect(result.computeTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.confidence.score).toBe(100);
    expect(result.confidence.label).toBe('HIGH');
    expect(result.confidence.missingCritical).toEqual([]);
  });

  it('handles partial model failures gracefully', async () => {
    const mockSvc = makeMockService({ score: 80 });
    const failingSvc = {
      ...mockSvc,
      getYieldCurveAnalysis: jest
        .fn()
        .mockRejectedValue(new Error('rate shock failed')),
    };
    const services = makeFullServices(mockSvc);
    services.yieldCurve = failingSvc;
    const result = await service.runFullSwarm('inst-1', services);
    expect(result.failedModels).toContain('rateShock');
    expect(result.completedModels).toHaveLength(11);
    expect(result.rateShock).toBeNull();
    expect(result.confidence.missingCritical).toContain('rateShock');
  });

  it('returns default health score of 50 when advisor fails', async () => {
    const mockSvc = makeMockService({ score: 80 });
    const failingAdvisor = {
      ...mockSvc,
      computeHealthScore: jest
        .fn()
        .mockRejectedValue(new Error('advisor down')),
    };
    const services = makeFullServices(mockSvc);
    services.advisor = failingAdvisor;
    const result = await service.runFullSwarm('inst-1', services);
    expect(result.healthScore).toBe(50);
  });

  it('computeTimeMs is a positive number', async () => {
    const mockSvc = makeMockService({ score: 80 });
    const result = await service.runFullSwarm(
      'inst-1',
      makeFullServices(mockSvc),
    );
    expect(result.computeTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('confidence drops when critical models fail', async () => {
    const mockSvc = makeMockService({ score: 80 });
    const failSvc = {
      ...mockSvc,
      computeEWS: jest.fn().mockRejectedValue(new Error('ews down')),
      getAdvancedLiquidity: jest.fn().mockRejectedValue(new Error('liq down')),
    };
    const services = makeFullServices(mockSvc);
    services.earlyWarning = failSvc;
    services.liquidity = failSvc;
    const result = await service.runFullSwarm('inst-1', services);
    expect(result.confidence.score).toBeLessThan(80);
    expect(result.confidence.missingCritical).toContain('earlyWarning');
    expect(result.confidence.missingCritical).toContain('liquidity');
  });
});
