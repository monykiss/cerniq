import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SampleReportController } from './sample-report.controller';
import { SampleReportService } from './sample-report.service';
import { SampleReportQueueService } from './sample-report-queue.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';

// First spec for SampleReportController — co-located per
// CO-LOCATED orphan-spec convention. Covers:
//   (a) method-level AdminKeyGuard wiring on each of the 3 admin
//       routes (reflection lock — catches future refactor that drops
//       the guard);
//   (b) handler delegation to SampleReportService / queue;
//   (c) the public `api/demo/preview` route — Zod parse, valid + invalid
//       + expired token, validation-failure surface (NOT admin-key
//       guarded).
// Admin-key auth behavior itself is covered by the 10-case
// `admin-key.guard.spec.ts` shared across the migration sweep.

describe('SampleReportController', () => {
  let controller: SampleReportController;
  let sampleReportService: Record<string, jest.Mock>;
  let queueService: Record<string, jest.Mock>;

  beforeEach(async () => {
    sampleReportService = {
      generateSampleReport: jest.fn(),
      validatePreviewToken: jest.fn(),
    };
    queueService = {
      enqueueAllProspects: jest.fn(),
      getQueueStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SampleReportController],
      providers: [
        { provide: SampleReportService, useValue: sampleReportService },
        { provide: SampleReportQueueService, useValue: queueService },
      ],
    })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SampleReportController>(SampleReportController);
  });

  describe('AdminKeyGuard wiring (reflection locks)', () => {
    const assertGuardOn = (handlerName: keyof SampleReportController) => {
      const handler = (SampleReportController.prototype as any)[handlerName];
      const guards = Reflect.getMetadata('__guards__', handler) ?? [];
      const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
      expect(names).toContain('AdminKeyGuard');
    };

    it('AdminKeyGuard guards generateAll', () => {
      assertGuardOn('generateAll');
    });
    it('AdminKeyGuard guards generateSingle', () => {
      assertGuardOn('generateSingle');
    });
    it('AdminKeyGuard guards getQueueStatus', () => {
      assertGuardOn('getQueueStatus');
    });
    it('previewReport is NOT admin-key guarded (public endpoint)', () => {
      const handler = (SampleReportController.prototype as any).previewReport;
      const guards = Reflect.getMetadata('__guards__', handler) ?? [];
      const names = guards.map((g: { name?: string }) => g?.name ?? String(g));
      expect(names).not.toContain('AdminKeyGuard');
    });
  });

  describe('generateAll', () => {
    it('enqueues prospects and returns the queue summary', async () => {
      queueService.enqueueAllProspects.mockResolvedValue({
        jobCount: 7,
        skipped: 2,
      });
      const result = await controller.generateAll();
      expect(result.message).toBe('Enqueued 7 prospects for report generation');
      expect(result.jobCount).toBe(7);
      expect(queueService.enqueueAllProspects).toHaveBeenCalled();
    });
  });

  describe('generateSingle', () => {
    it('delegates to SampleReportService.generateSampleReport', async () => {
      sampleReportService.generateSampleReport.mockResolvedValue({
        prospectInstitutionId: 'prosp-1',
        reportId: 'rpt-1',
      });
      const result = await controller.generateSingle('prosp-1');
      expect(result.message).toBe('Sample report generated');
      expect(sampleReportService.generateSampleReport).toHaveBeenCalledWith(
        'prosp-1',
      );
    });

    it('rejects an empty prospectInstitutionId path param with BadRequest', async () => {
      await expect(controller.generateSingle('')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sampleReportService.generateSampleReport).not.toHaveBeenCalled();
    });
  });

  describe('getQueueStatus', () => {
    it('returns the queue status payload', async () => {
      // The queue service's `getQueueStatus()` returns `{ waiting, active,
      // completed, failed, message }` (see `sample-report-queue.service.ts`
      // line 94-97). The controller spreads this and prepends a literal
      // `message: 'Queue status'` field. The pre-fix spec mocked
      // `{ pending, running }` — property names that don't exist on the
      // typed return — and tsc rejected the assertions on those names.
      // Per `cossec.dto.ts` QueueStatus has only the four counters.
      // The controller adds `message: 'Queue status'` via prepended
      // literal (won't be overridden because spread is { message, ...status }
      // and status has no `message` of its own).
      queueService.getQueueStatus.mockReturnValue({
        waiting: 3,
        active: 1,
        completed: 12,
        failed: 0,
      });
      const result = await controller.getQueueStatus();
      expect(result.message).toBe('Queue status');
      expect(result.waiting).toBe(3);
      expect(result.active).toBe(1);
    });
  });

  describe('previewReport (public)', () => {
    it('returns valid preview metadata when the token resolves', async () => {
      sampleReportService.validatePreviewToken.mockResolvedValue({
        prospectInstitutionId: 'prosp-7',
        institutionName: 'Cooperativa Demo',
      });
      const result = await controller.previewReport({ token: 'good.jwt' });
      expect(result).toEqual({
        valid: true,
        prospectInstitutionId: 'prosp-7',
        institutionName: 'Cooperativa Demo',
        previewUrl: '/api/demo/preview?institution=prosp-7',
      });
    });

    it('throws BadRequest for a missing or unparseable token query', async () => {
      await expect(controller.previewReport({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sampleReportService.validatePreviewToken).not.toHaveBeenCalled();
    });

    it('throws Unauthorized when the token is invalid or expired', async () => {
      sampleReportService.validatePreviewToken.mockResolvedValue(null);
      await expect(
        controller.previewReport({ token: 'bad.jwt' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
