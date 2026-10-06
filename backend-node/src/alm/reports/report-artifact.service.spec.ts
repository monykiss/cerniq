/**
 * ReportArtifact service specs — FAANG Audit P1 #4.
 *
 * Tests: record, checksum computation, find by checksum, list,
 * verify integrity, and immutability contract.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReportArtifactService } from './report-artifact.service';
import { PrismaService } from '../../prisma.service';

function createMockPrisma() {
  const artifacts: any[] = [];
  let idCounter = 1;

  return {
    reportArtifact: {
      create: jest.fn(({ data }: any) => {
        const a = {
          id: `artifact-${idCounter++}`,
          ...data,
          generatedAt: new Date(),
        };
        artifacts.push(a);
        return Promise.resolve(a);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const found = artifacts.find(
          (a) => a.contentChecksum === where.contentChecksum,
        );
        return Promise.resolve(found ?? null);
      }),
      findUnique: jest.fn(({ where }: any) => {
        const found = artifacts.find((a) => a.id === where.id);
        return Promise.resolve(found ?? null);
      }),
      findMany: jest.fn(({ where, take }: any) => {
        let result = [...artifacts];
        if (where?.institutionId)
          result = result.filter(
            (a) => a.institutionId === where.institutionId,
          );
        if (where?.analysisRunId)
          result = result.filter(
            (a) => a.analysisRunId === where.analysisRunId,
          );
        if (take) result = result.slice(0, take);
        return Promise.resolve(result);
      }),
    },
    _artifacts: artifacts,
  };
}

describe('ReportArtifactService', () => {
  let service: ReportArtifactService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportArtifactService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ReportArtifactService);
  });

  const sampleContent = Buffer.from('CERNIQ ALM Report — Test PDF Content');
  const sampleInput = () => ({
    institutionId: 'inst-1',
    format: 'PDF_ES' as const,
    language: 'es',
    content: sampleContent,
    storageLocator: 'r2://cerniq-reports/inst-1/2026-04/alm-report-es.pdf',
    modelLineage: [
      {
        modelKey: 'alm.lcr',
        version: '1.1.0',
        status: 'APPROVED',
        approvedAt: '2026-04-12',
        approvedBy: 'system-seed',
      },
      {
        modelKey: 'reg.cossec-compliance',
        version: '1.0.0',
        status: 'APPROVED',
        approvedAt: '2026-04-12',
        approvedBy: 'system-seed',
      },
    ],
    preflightReady: true,
  });

  it('records an artifact with correct SHA-256 checksum', async () => {
    const result = await service.record(sampleInput());

    expect(result.id).toBeDefined();
    expect(result.contentChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBe(sampleContent.length);
    expect(result.institutionId).toBe('inst-1');
    expect(result.format).toBe('PDF_ES');
    expect(result.preflightReady).toBe(true);
  });

  it('computes deterministic checksums for identical content', async () => {
    const r1 = await service.record(sampleInput());
    const r2 = await service.record(sampleInput());

    expect(r1.contentChecksum).toBe(r2.contentChecksum);
  });

  it('computes different checksums for different content', async () => {
    const r1 = await service.record(sampleInput());
    const r2 = await service.record({
      ...sampleInput(),
      content: Buffer.from('Different content'),
    });

    expect(r1.contentChecksum).not.toBe(r2.contentChecksum);
  });

  it('stores model lineage snapshot', async () => {
    const input = sampleInput();
    await service.record(input);

    const stored = prisma._artifacts[0];
    expect(stored.modelLineageSnapshot).toHaveLength(2);
    expect(stored.modelLineageSnapshot[0].modelKey).toBe('alm.lcr');
  });

  it('finds artifact by checksum', async () => {
    const recorded = await service.record(sampleInput());
    const found = await service.findByChecksum(recorded.contentChecksum);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(recorded.id);
  });

  it('returns null for unknown checksum', async () => {
    const found = await service.findByChecksum('sha256:0000');
    expect(found).toBeNull();
  });

  it('gets artifact by id', async () => {
    const recorded = await service.record(sampleInput());
    const found = await service.getById(recorded.id);
    expect(found.contentChecksum).toBe(recorded.contentChecksum);
  });

  it('throws NotFoundException for missing id', async () => {
    await expect(service.getById('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists artifacts for an institution', async () => {
    await service.record(sampleInput());
    await service.record({ ...sampleInput(), content: Buffer.from('second') });
    await service.record({
      ...sampleInput(),
      institutionId: 'inst-2',
      content: Buffer.from('other'),
    });

    const list = await service.listForInstitution('inst-1');
    expect(list).toHaveLength(2);
  });

  it('lists artifacts for an analysis run', async () => {
    await service.record({ ...sampleInput(), analysisRunId: 'run-1' });
    await service.record({
      ...sampleInput(),
      analysisRunId: 'run-1',
      format: 'PDF_EN',
      content: Buffer.from('en'),
    });
    await service.record({
      ...sampleInput(),
      analysisRunId: 'run-2',
      content: Buffer.from('other'),
    });

    const list = await service.listForAnalysisRun('run-1');
    expect(list).toHaveLength(2);
  });

  it('verifies artifact integrity — valid content', async () => {
    const recorded = await service.record(sampleInput());
    const result = await service.verify(recorded.id, sampleContent);

    expect(result.valid).toBe(true);
    expect(result.stored).toBe(result.computed);
  });

  it('detects tampered content on verification', async () => {
    const recorded = await service.record(sampleInput());
    const tampered = Buffer.from('TAMPERED CONTENT');
    const result = await service.verify(recorded.id, tampered);

    expect(result.valid).toBe(false);
    expect(result.stored).not.toBe(result.computed);
  });

  it('records optional fields: analysisRunId, reportJobId, preflightGaps', async () => {
    await service.record({
      ...sampleInput(),
      analysisRunId: 'run-123',
      reportJobId: 'job-456',
      preflightGaps: [
        {
          field: 'liquidity.lcr',
          reason: 'NO_LIQUIDITY_POSITION',
          severity: 'CRITICAL',
          action: 'Upload liquidity data',
        },
      ],
      preflightReady: false,
    });

    const stored = prisma._artifacts[0];
    expect(stored.analysisRunId).toBe('run-123');
    expect(stored.reportJobId).toBe('job-456');
    expect(stored.preflightGaps).toHaveLength(1);
    expect(stored.preflightReady).toBe(false);
  });
});
