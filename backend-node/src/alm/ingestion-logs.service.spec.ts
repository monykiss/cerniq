import { IngestionLogsService } from './ingestion-logs.service';

describe('IngestionLogsService', () => {
  let service: IngestionLogsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      ingestionLog: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'log_123', ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      institution: {
        findFirst: jest.fn().mockResolvedValue({ id: 'inst_123' }),
      },
      reportJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'job_123' }),
      },
    };

    service = new IngestionLogsService(prisma);
  });

  it('records ingestion metadata with schema version and row counts', async () => {
    const result = await service.recordLog({
      userId: 'user_123',
      institutionId: 'inst_123',
      source: 'manual_upload',
      sourceFilename: 'balance-sheet.csv',
      status: 'IMPORTED',
      importedCount: 8,
      parseResult: {
        valid: true,
        items: [],
        errors: [],
        warnings: ['warning'],
        summary: {
          totalRows: 8,
          validRows: 8,
          errorRows: 0,
          totalAssets: 120,
          totalLiabilities: 110,
        },
      },
    });

    expect(prisma.ingestionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schemaVersion: 'alm_csv_v1',
          importedCount: 8,
          totalRows: 8,
        }),
      }),
    );
    expect(result.sourceFilename).toBe('balance-sheet.csv');
  });

  // ── Coverage boost: listInstitutionLogs and listJobLogs ────
  describe('listInstitutionLogs', () => {
    it('returns paginated logs for an institution', async () => {
      const mockLogs = [{ id: 'log_1' }, { id: 'log_2' }];
      prisma.ingestionLog.findMany.mockResolvedValue(mockLogs);
      prisma.ingestionLog = {
        ...prisma.ingestionLog,
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue(mockLogs),
      };

      const result = await service.listInstitutionLogs('user_123', 'inst_123', {
        page: 1,
        pageSize: 10,
      } as any);
      expect(result.items).toEqual(mockLogs);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('throws NotFoundException when institution access denied', async () => {
      prisma.institution.findFirst.mockResolvedValue(null);
      await expect(
        service.listInstitutionLogs('user_123', 'inst_bad'),
      ).rejects.toThrow('Institution not found');
    });
  });

  describe('listJobLogs', () => {
    it('returns logs for a specific report job', async () => {
      prisma.reportJob = {
        findFirst: jest.fn().mockResolvedValue({ id: 'job_123' }),
      };
      prisma.ingestionLog.findMany.mockResolvedValue([{ id: 'log_j1' }]);

      const result = await service.listJobLogs('user_123', 'job_123');
      expect(result).toEqual([{ id: 'log_j1' }]);
    });

    it('throws NotFoundException when job not found', async () => {
      prisma.reportJob = { findFirst: jest.fn().mockResolvedValue(null) };
      await expect(
        service.listJobLogs('user_123', 'job_missing'),
      ).rejects.toThrow('Job not found');
    });
  });

  describe('recordLog edge cases', () => {
    it('uses default schema version when not provided', async () => {
      await service.recordLog({
        userId: 'user_123',
        source: 'portal_submit',
        status: 'DRY_RUN',
        dryRun: true,
        parseResult: {
          valid: true,
          items: [],
          errors: [],
          warnings: [],
          summary: {
            totalRows: 0,
            validRows: 0,
            errorRows: 0,
            totalAssets: 0,
            totalLiabilities: 0,
          },
        },
      });

      expect(prisma.ingestionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            schemaVersion: 'alm_csv_v1',
            dryRun: true,
            importedCount: 0,
          }),
        }),
      );
    });
  });
});
