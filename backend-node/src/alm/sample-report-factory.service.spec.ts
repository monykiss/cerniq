import { SampleReportFactoryService } from './sample-report-factory.service';

describe('SampleReportFactoryService', () => {
  let service: SampleReportFactoryService;
  let prisma: any;
  let ncuaDataPull: any;
  let almService: any;
  let reportsService: any;

  beforeEach(() => {
    prisma = {
      institution: {
        create: jest.fn().mockResolvedValue({ id: 'temp-inst' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      balanceSheetItem: {
        createMany: jest.fn().mockResolvedValue({ count: 5 }),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ws-1' }),
        create: jest.fn(),
      },
      prospectInstitution: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    ncuaDataPull = {
      pullByCharterNumber: jest.fn().mockResolvedValue({
        institutionName: 'Test CU',
        totalAssets: 200,
        asOfDate: '2026-03-01',
        items: [
          {
            category: 'asset',
            subcategory: 'cash',
            name: 'Cash',
            balance: 50,
            rate: 0,
            duration: 0,
            rateType: 'fixed',
          },
          {
            category: 'liability',
            subcategory: 'deposits',
            name: 'Deposits',
            balance: 45,
            rate: 0.02,
            duration: 1,
            rateType: 'fixed',
          },
        ],
      }),
    };
    almService = {} as any;
    reportsService = {
      generateALMReport: jest.fn().mockResolvedValue(Buffer.from('PDF')),
    };
    service = new SampleReportFactoryService(
      prisma,
      ncuaDataPull,
      almService,
      reportsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generates sample report and cleans up temp data', async () => {
    const buffer = await service.generateSampleReport('12345');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(ncuaDataPull.pullByCharterNumber).toHaveBeenCalledWith('12345');
    expect(prisma.institution.create).toHaveBeenCalled();
    expect(prisma.balanceSheetItem.createMany).toHaveBeenCalled();
    expect(reportsService.generateALMReport).toHaveBeenCalledWith(
      'temp-inst',
      'en',
      expect.objectContaining({ watermark: expect.any(String) }),
    );
    // Cleanup
    expect(prisma.balanceSheetItem.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { institutionId: 'temp-inst' } }),
    );
    expect(prisma.institution.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'temp-inst' } }),
    );
  });

  it('preserves temp data when report generation fails (for debugging)', async () => {
    reportsService.generateALMReport.mockRejectedValue(new Error('PDF fail'));

    await expect(service.generateSampleReport('12345')).rejects.toThrow(
      'PDF fail',
    );
    // Temp data must NOT be cleaned up — preserved for admin inspection
    expect(prisma.balanceSheetItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.institution.delete).not.toHaveBeenCalled();
  });

  it('generateAndSaveForProspect returns success on happy path', async () => {
    prisma.prospectInstitution.findUnique.mockResolvedValue({
      id: 'p1',
      notes: 'existing',
    });
    prisma.prospectInstitution.update.mockResolvedValue({});

    const result = await service.generateAndSaveForProspect('12345', 'p1');
    expect(result.success).toBe(true);
    expect(prisma.prospectInstitution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ outreachStatus: 'sample_generated' }),
      }),
    );
  });

  it('generateAndSaveForProspect returns false on failure', async () => {
    ncuaDataPull.pullByCharterNumber.mockRejectedValue(new Error('network'));

    const result = await service.generateAndSaveForProspect('99999', 'p1');
    expect(result.success).toBe(false);
  });

  // ── Coverage: generates report with custom language ────────────
  it('generates sample report with es language', async () => {
    const buffer = await service.generateSampleReport('12345', 'es');
    expect(buffer).toBeInstanceOf(Buffer);
    expect(reportsService.generateALMReport).toHaveBeenCalledWith(
      'temp-inst',
      'es',
      expect.any(Object),
    );
  });

  // ── Coverage: getOrCreateSystemWorkspaceId creates new workspace ──
  it('creates system workspace when it does not exist', async () => {
    prisma.workspace.findFirst.mockResolvedValueOnce(null);
    prisma.workspace.create.mockResolvedValue({ id: 'ws-new' });

    const buffer = await service.generateSampleReport('12345');
    expect(buffer).toBeInstanceOf(Buffer);
    expect(prisma.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: '__SYSTEM_SAMPLE_REPORTS__' } }),
    );
  });

  // ── Coverage: prospect not found path ──────────────────────────
  it('generateAndSaveForProspect handles null prospect', async () => {
    prisma.prospectInstitution.findUnique.mockResolvedValue(null);

    const result = await service.generateAndSaveForProspect(
      '12345',
      'p-missing',
    );
    expect(result.success).toBe(true);
    // update should NOT be called since prospect is null
    expect(prisma.prospectInstitution.update).not.toHaveBeenCalled();
  });

  // ── Coverage: prospect with null notes ────────────────────────
  it('generateAndSaveForProspect handles prospect with null notes', async () => {
    prisma.prospectInstitution.findUnique.mockResolvedValue({
      id: 'p2',
      notes: null,
    });
    prisma.prospectInstitution.update.mockResolvedValue({});

    const result = await service.generateAndSaveForProspect('12345', 'p2');
    expect(result.success).toBe(true);
    expect(prisma.prospectInstitution.update).toHaveBeenCalled();
  });
});
