import { DemoWorkspaceService } from './demo-workspace.service';

describe('DemoWorkspaceService', () => {
  let service: DemoWorkspaceService;
  const mockPrisma = {
    workspace: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    institution: { create: jest.fn() },
    balanceSheetItem: { createMany: jest.fn() },
  } as any;
  const mockNcuaDataPull = {
    pullByCharterNumber: jest.fn(),
  } as any;

  beforeEach(() => {
    service = new DemoWorkspaceService(mockPrisma, mockNcuaDataPull);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should build a demo workspace with existing system workspace', async () => {
    mockNcuaDataPull.pullByCharterNumber.mockResolvedValue({
      institutionName: 'Test CU',
      totalAssets: 200,
      netWorthRatio: 10.5,
      items: [
        {
          category: 'asset',
          subcategory: 'cash',
          name: 'Cash',
          balance: 50,
          rate: 0.05,
          duration: 0.1,
          rateType: 'variable',
        },
      ],
    });
    mockPrisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-1' });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 1 });

    const result = await service.buildWorkspace('12345', 'Sales Call');
    expect(result.institutionId).toBe('inst-1');
    expect(result.name).toBe('Test CU');
    expect(result.talkingPoints.length).toBe(3);
    expect(result.dashboardUrl).toContain('inst-1');
  });

  it('should create system workspace if none exists', async () => {
    mockNcuaDataPull.pullByCharterNumber.mockResolvedValue({
      institutionName: 'New CU',
      totalAssets: 100,
      netWorthRatio: 7.5,
      items: [],
    });
    mockPrisma.workspace.findFirst.mockResolvedValue(null);
    mockPrisma.workspace.create.mockResolvedValue({ id: 'ws-new' });
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-2' });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 0 });

    const result = await service.buildWorkspace('99999', 'Demo');
    expect(mockPrisma.workspace.create).toHaveBeenCalled();
    expect(result.institutionId).toBe('inst-2');
  });

  it('should include capital-focused talking point for low NWR', async () => {
    mockNcuaDataPull.pullByCharterNumber.mockResolvedValue({
      institutionName: 'Low Cap CU',
      totalAssets: 150,
      netWorthRatio: 7.0,
      items: [],
    });
    mockPrisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-3' });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 0 });

    const result = await service.buildWorkspace('11111', 'Demo');
    expect(result.talkingPoints[1]).toContain('capital planning');
  });

  it('should set expiration 8 hours from now', async () => {
    mockNcuaDataPull.pullByCharterNumber.mockResolvedValue({
      institutionName: 'Expiry CU',
      totalAssets: 100,
      netWorthRatio: 10,
      items: [],
    });
    mockPrisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-4' });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 0 });

    const result = await service.buildWorkspace('22222', 'Demo');
    const expires = new Date(result.expiresAt);
    const created = new Date(result.createdAt);
    const diffHours = (expires.getTime() - created.getTime()) / 3600000;
    expect(diffHours).toBeCloseTo(8, 0);
  });
});
