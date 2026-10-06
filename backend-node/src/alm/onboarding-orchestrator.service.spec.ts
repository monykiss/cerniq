import { OnboardingOrchestratorService } from './onboarding-orchestrator.service';

describe('OnboardingOrchestratorService', () => {
  let service: OnboardingOrchestratorService;
  const mockPrisma = {
    institution: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    balanceSheetItem: { count: jest.fn() },
    analysisRun: { count: jest.fn() },
    boardReport: { count: jest.fn() },
  } as any;

  beforeEach(() => {
    service = new OnboardingOrchestratorService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty status for non-existent institution', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    const result = await service.getOnboardingStatus('nonexistent');
    expect(result.activationScore).toBe(0);
    expect(result.milestones).toEqual([]);
  });

  it('should track milestone completion based on data', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      createdAt: new Date(Date.now() - 86400000), // 1 day ago
    });
    mockPrisma.balanceSheetItem.count.mockResolvedValue(10);
    mockPrisma.analysisRun.count.mockResolvedValue(3);
    mockPrisma.boardReport.count.mockResolvedValue(1);

    const result = await service.getOnboardingStatus('inst-1');
    expect(result.activationScore).toBe(5); // all milestones met
    expect(result.milestones.length).toBe(5);
    expect(result.isStalled).toBe(false);
  });

  it('should detect stalled onboarding', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-2',
      createdAt: new Date(Date.now() - 5 * 86400000), // 5 days ago
    });
    mockPrisma.balanceSheetItem.count.mockResolvedValue(0);
    mockPrisma.analysisRun.count.mockResolvedValue(0);
    mockPrisma.boardReport.count.mockResolvedValue(0);

    const result = await service.getOnboardingStatus('inst-2');
    expect(result.isStalled).toBe(true);
    expect(result.stalledMilestone).toBe('data_loaded');
  });

  it('should list all institution onboarding statuses', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([
      { id: 'inst-1' },
      { id: 'inst-2' },
    ]);
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'inst-1',
      createdAt: new Date(),
    });
    mockPrisma.balanceSheetItem.count.mockResolvedValue(0);
    mockPrisma.analysisRun.count.mockResolvedValue(0);
    mockPrisma.boardReport.count.mockResolvedValue(0);

    const results = await service.getAllOnboardingStatuses();
    expect(results.length).toBe(2);
  });
});
