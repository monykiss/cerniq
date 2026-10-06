import { WorkspaceOnboardingService } from './workspace-onboarding.service';

describe('WorkspaceOnboardingService', () => {
  let service: WorkspaceOnboardingService;
  const mockPrisma = {
    institution: { create: jest.fn() },
    balanceSheetItem: { createMany: jest.fn() },
    liquidityPosition: { create: jest.fn() },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkspaceOnboardingService(mockPrisma);
    mockPrisma.institution.create.mockResolvedValue({ id: 'inst-1' });
    mockPrisma.balanceSheetItem.createMany.mockResolvedValue({ count: 5 });
    mockPrisma.liquidityPosition.create.mockResolvedValue({ id: 'liq-1' });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('seedDemoData creates bank profile correctly', async () => {
    const result = await service.seedDemoData('ws-1', 'bank');
    expect(result.institutionId).toBe('inst-1');
    expect(mockPrisma.institution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Banco Comunidad PR',
          type: 'bank',
          totalAssets: 1200,
        }),
      }),
    );
    expect(mockPrisma.balanceSheetItem.createMany).toHaveBeenCalled();
    expect(mockPrisma.liquidityPosition.create).toHaveBeenCalled();
  });

  it('seedDemoData creates credit_union profile', async () => {
    const result = await service.seedDemoData('ws-1', 'credit_union');
    expect(result.institutionId).toBe('inst-1');
    expect(mockPrisma.institution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'CoopAhorro PR',
          type: 'credit_union',
          totalAssets: 180,
        }),
      }),
    );
  });

  it('seedDemoData creates family_office profile', async () => {
    await service.seedDemoData('ws-1', 'family_office');
    expect(mockPrisma.institution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Caribbean Family Capital',
          type: 'family_office',
          totalAssets: 45,
        }),
      }),
    );
  });

  it('seedDemoData creates cooperativa profile', async () => {
    await service.seedDemoData('ws-1', 'cooperativa');
    expect(mockPrisma.institution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'CoopAhorro San Juan',
          type: 'cooperativa',
          totalAssets: 250,
        }),
      }),
    );
  });

  it('seedDemoData creates balance sheet items with correct institutionId', async () => {
    await service.seedDemoData('ws-2', 'bank');
    const createManyCall =
      mockPrisma.balanceSheetItem.createMany.mock.calls[0][0];
    expect(createManyCall.data.length).toBeGreaterThan(0);
    createManyCall.data.forEach((item: any) => {
      expect(item.institutionId).toBe('inst-1');
    });
  });
});
