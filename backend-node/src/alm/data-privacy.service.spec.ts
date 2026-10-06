import { DataPrivacyService } from './data-privacy.service';

describe('DataPrivacyService', () => {
  let service: DataPrivacyService;
  const mockPrisma = {
    dataDeletionRequest: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    institution: { update: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { findMany: jest.fn() },
    subscription: { findMany: jest.fn() },
    expense: { findMany: jest.fn() },
  } as any;

  beforeEach(() => {
    service = new DataPrivacyService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return data inventory with PII items', () => {
    const inventory = service.getDataInventory();
    expect(inventory.length).toBeGreaterThan(0);
    const piiItems = inventory.filter((i) => i.category === 'PII');
    expect(piiItems.length).toBeGreaterThan(0);
  });

  it('should process deletion request for member_pii_only scope', async () => {
    mockPrisma.dataDeletionRequest.create.mockResolvedValue({ id: 'del-1' });
    mockPrisma.dataDeletionRequest.update.mockResolvedValue({});
    mockPrisma.institution.update.mockResolvedValue({});

    const result = await service.requestDeletion(
      'inst-1',
      'user-1',
      'GDPR',
      'member_pii_only',
    );
    expect(result.requestId).toBe('del-1');
    expect(result.status).toBe('completed');
    expect(result.regulation).toBe('GDPR');
    expect(mockPrisma.institution.update).toHaveBeenCalled();
  });

  it('should generate SAR export with all personal data', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'test@test.com',
      name: 'Test',
    });
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.institution.findMany.mockResolvedValue([]);
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);

    const result = await service.generateSAR('u1');
    expect(result.userId).toBe('u1');
    expect(result.data.personalData).toBeDefined();
    expect(result.exportedAt).toBeDefined();
  });

  it('should return deletion history for an institution', async () => {
    mockPrisma.dataDeletionRequest.findMany.mockResolvedValue([
      { id: 'del-1', status: 'completed' },
    ]);

    const result = await service.getDeletionHistory('inst-1');
    expect(result.length).toBe(1);
  });

  it('generateSAR catches expense query failure gracefully', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
    });
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockRejectedValue(new Error('DB error'));

    const result = await service.generateSAR('u1');
    expect(result.userId).toBe('u1');
    expect(result.data.personalData).toBeDefined();
  });
});
