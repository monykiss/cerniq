import { ApiV1Service } from './api-v1.service';

describe('ApiV1Service', () => {
  let service: ApiV1Service;
  const mockPrisma = {
    workspace: { create: jest.fn() },
    analysisRun: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;
  const mockAlmEnterprise = {
    createInstitution: jest.fn(),
    importBalanceSheetItems: jest.fn(),
    getCOSSECCompliance: jest.fn(),
    getALMSummary: jest.fn(),
  } as any;
  const mockAlmService = {} as any;
  const mockCsvIngestion = {
    parseCSV: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApiV1Service(
      mockPrisma,
      mockAlmEnterprise,
      mockAlmService,
      mockCsvIngestion,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getBenchmarks returns sector benchmarks object', () => {
    const benchmarks = service.getBenchmarks();
    expect(benchmarks).toBeDefined();
    expect(typeof benchmarks).toBe('object');
  });

  it('getFrameworks returns array of supported frameworks', () => {
    const frameworks = service.getFrameworks();
    expect(frameworks).toHaveLength(2);
    expect(frameworks[0].id).toBe('cossec');
    expect(frameworks[1].id).toBe('ncua');
    expect(frameworks[0].supportedInstitutionTypes).toContain('cooperativa');
  });

  it('getAnalysis throws NotFoundException when not found', async () => {
    mockPrisma.analysisRun.findFirst.mockResolvedValue(null);
    await expect(service.getAnalysis('user-1', 'bad-id')).rejects.toThrow();
  });

  it('getAnalysis returns analysis when found', async () => {
    mockPrisma.analysisRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'COMPLETED',
      analysisType: 'api_full_analysis',
      triggeredBy: 'public_api',
      parameterSnapshot: {},
      resultSummary: { compliance: {} },
      errorMessage: null,
      createdAt: new Date('2026-01-01'),
      completedAt: new Date('2026-01-01'),
      institution: {
        id: 'inst-1',
        name: 'Test',
        type: 'cooperativa',
        totalAssets: 100,
        currency: 'USD',
        reportingDate: new Date('2026-01-31'),
      },
    });
    const result = await service.getAnalysis('user-1', 'run-1');
    expect(result.analysisId).toBe('run-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.institution.name).toBe('Test');
  });

  it('analyzeFromCSV throws BadRequestException on invalid CSV', async () => {
    mockCsvIngestion.parseCSV.mockReturnValue({
      valid: false,
      errors: ['Missing required column'],
      summary: {},
      items: [],
    });
    await expect(
      service.analyzeFromCSV(
        'user-1',
        'bad,csv',
        'Test',
        'cooperativa',
        'cossec',
        'Q1-2026',
      ),
    ).rejects.toThrow();
  });

  it('analyzeFromRows normalizes rates > 1 to decimal', async () => {
    mockPrisma.workspace.create.mockResolvedValue({ id: 'ws-1' });
    mockAlmEnterprise.createInstitution.mockResolvedValue({ id: 'inst-1' });
    mockAlmEnterprise.importBalanceSheetItems.mockResolvedValue({});
    mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue({
      ratios: [],
      examReadinessScore: 80,
      overallStatus: 'compliant',
      summary: {},
    });
    mockAlmEnterprise.getALMSummary.mockResolvedValue({
      durationGap: {},
      niiSensitivity: {},
      liquidity: {},
      recommendations: [],
    });
    mockPrisma.analysisRun.create.mockResolvedValue({
      id: 'run-1',
      createdAt: new Date('2026-01-01'),
    });

    const result = await service.analyzeFromRows('user-1', {
      institutionName: 'Test Coop',
      institutionType: 'cooperativa',
      framework: 'cossec',
      period: 'Q1-2026',
      rows: [
        {
          category: 'asset',
          name: 'Loans',
          balance: 100000,
          rate: 5.5,
          subcategory: 'consumer_loans',
          duration: 3,
          rateType: 'fixed',
        },
      ],
    });

    expect(result.analysisId).toBe('run-1');
    // The rate 5.5 (>1) should have been normalized to 0.055
    expect(mockAlmEnterprise.importBalanceSheetItems).toHaveBeenCalledWith(
      'inst-1',
      expect.arrayContaining([expect.objectContaining({ rate: 0.055 })]),
    );
  });

  it('analyzeFromCSV delegates to analyzeFromRows when CSV is valid', async () => {
    mockCsvIngestion.parseCSV.mockReturnValue({
      valid: true,
      errors: [],
      items: [
        {
          category: 'asset',
          name: 'Cash',
          balance: 50000,
          rate: 0.01,
          subcategory: 'cash',
          duration: 0,
          rateType: 'fixed',
        },
      ],
    });
    mockPrisma.workspace.create.mockResolvedValue({ id: 'ws-2' });
    mockAlmEnterprise.createInstitution.mockResolvedValue({ id: 'inst-2' });
    mockAlmEnterprise.importBalanceSheetItems.mockResolvedValue({});
    mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue({
      ratios: [],
      examReadinessScore: 75,
      overallStatus: 'compliant',
      summary: {},
    });
    mockAlmEnterprise.getALMSummary.mockResolvedValue({
      durationGap: {},
      niiSensitivity: {},
      liquidity: {},
      recommendations: [],
    });
    mockPrisma.analysisRun.create.mockResolvedValue({
      id: 'run-2',
      createdAt: new Date('2026-02-01'),
    });

    const result = await service.analyzeFromCSV(
      'user-1',
      'valid,csv',
      'Test2',
      'cooperativa',
      'cossec',
      'Q1-2026',
    );
    expect(result.analysisId).toBe('run-2');
    expect(result.institutionName).toBe('Test2');
  });

  it('getAnalysis returns completedAt as ISO string', async () => {
    mockPrisma.analysisRun.findFirst.mockResolvedValue({
      id: 'run-3',
      status: 'COMPLETED',
      analysisType: 'api_full_analysis',
      triggeredBy: 'public_api',
      parameterSnapshot: {},
      resultSummary: null,
      errorMessage: null,
      createdAt: new Date('2026-01-01'),
      completedAt: null,
      institution: {
        id: 'inst-1',
        name: 'Test',
        type: 'cooperativa',
        totalAssets: 100,
        currency: 'USD',
        reportingDate: new Date('2026-01-31'),
      },
    });
    const result = await service.getAnalysis('user-1', 'run-3');
    expect(result.completedAt).toBeNull();
    expect(result.result).toBeNull();
  });
});
