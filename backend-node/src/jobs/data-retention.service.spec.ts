import { DataRetentionService } from './data-retention.service';

describe('DataRetentionService', () => {
  let service: DataRetentionService;
  const mockPrisma = {
    auditLog: { deleteMany: jest.fn() },
    demoRequest: { deleteMany: jest.fn() },
    analysisRun: { deleteMany: jest.fn() },
    ingestionLog: { deleteMany: jest.fn() },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataRetentionService(mockPrisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('runRetentionPolicy deletes old records from all tables', async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.demoRequest.deleteMany.mockResolvedValue({ count: 3 });
    mockPrisma.analysisRun.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.ingestionLog.deleteMany.mockResolvedValue({ count: 10 });

    const result = await service.runRetentionPolicy();
    expect(result.auditLogs).toBe(5);
    expect(result.demoRequests).toBe(3);
    expect(result.analysisRuns).toBe(2);
    expect(result.ingestionLogs).toBe(10);
  });

  it('runRetentionPolicy returns zero counts when nothing to delete', async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.demoRequest.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.analysisRun.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.ingestionLog.deleteMany.mockResolvedValue({ count: 0 });

    const result = await service.runRetentionPolicy();
    expect(result.auditLogs).toBe(0);
    expect(result.demoRequests).toBe(0);
    expect(result.analysisRuns).toBe(0);
    expect(result.ingestionLogs).toBe(0);
  });

  it('runRetentionPolicy handles individual table failures gracefully', async () => {
    mockPrisma.auditLog.deleteMany.mockRejectedValue(new Error('DB error'));
    mockPrisma.demoRequest.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.analysisRun.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.ingestionLog.deleteMany.mockResolvedValue({ count: 3 });

    const result = await service.runRetentionPolicy();
    expect(result.auditLogs).toBe(0);
    expect(result.demoRequests).toBe(1);
    expect(result.analysisRuns).toBe(2);
    expect(result.ingestionLogs).toBe(3);
  });

  it('defaults audit log retention to 7 years (2555 days) per security page claim', async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.demoRequest.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.analysisRun.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.ingestionLog.deleteMany.mockResolvedValue({ count: 0 });

    await service.runRetentionPolicy();

    const cutoffArg = mockPrisma.auditLog.deleteMany.mock.calls[0][0].where
      .createdAt.lt as Date;
    const daysAgo = (Date.now() - cutoffArg.getTime()) / 86_400_000;
    // Should be approximately 2555 days ago (7 years), not 365
    expect(daysAgo).toBeGreaterThan(2500);
    expect(daysAgo).toBeLessThan(2600);
  });

  it('runRetentionPolicy calls deleteMany with date cutoff', async () => {
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.demoRequest.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.analysisRun.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.ingestionLog.deleteMany.mockResolvedValue({ count: 0 });

    await service.runRetentionPolicy();

    expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(mockPrisma.demoRequest.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });

  it('runRetentionPolicy continues even when multiple tables fail', async () => {
    mockPrisma.auditLog.deleteMany.mockRejectedValue(new Error('fail'));
    mockPrisma.demoRequest.deleteMany.mockRejectedValue(new Error('fail'));
    mockPrisma.analysisRun.deleteMany.mockRejectedValue(new Error('fail'));
    mockPrisma.ingestionLog.deleteMany.mockRejectedValue(new Error('fail'));

    const result = await service.runRetentionPolicy();
    expect(result.auditLogs).toBe(0);
    expect(result.demoRequests).toBe(0);
    expect(result.analysisRuns).toBe(0);
    expect(result.ingestionLogs).toBe(0);
  });
});
