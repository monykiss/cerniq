import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  const mockPrisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'log-1',
          action: 'login',
          resource: 'auth',
          createdAt: new Date(),
        },
      ]),
      count: jest.fn().mockResolvedValue(1),
    },
  };

  beforeEach(() => {
    service = new AuditService(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('log creates an audit log entry (fire-and-forget)', () => {
    service.log({
      userId: 'user-1',
      institutionId: 'inst-1',
      action: 'balance_sheet.view',
      resource: 'balance_sheet',
      resourceId: 'bs-1',
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'balance_sheet.view',
          resource: 'balance_sheet',
        }),
      }),
    );
  });

  it('log handles missing optional fields', () => {
    service.log({ action: 'health_check', resource: 'system' });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          institutionId: null,
          action: 'health_check',
          outcome: 'success',
        }),
      }),
    );
  });

  it('queryByInstitution returns logs with default limits', async () => {
    const result = await service.queryByInstitution('inst-1');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ institutionId: 'inst-1' }),
        orderBy: { createdAt: 'desc' },
        take: 100,
        skip: 0,
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('queryByUser respects custom limit and offset', async () => {
    await service.queryByUser('user-1', {
      limit: 50,
      offset: 10,
      daysBack: 30,
    });
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        skip: 10,
      }),
    );
  });

  it('adminQuery returns data and total count', async () => {
    const result = await service.adminQuery({
      institutionId: 'inst-1',
      limit: 20,
    });
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result.limit).toBe(20);
  });
});
