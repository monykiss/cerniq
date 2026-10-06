import { Test, TestingModule } from '@nestjs/testing';
import { PipelineController } from './pipeline.controller';
import { PrismaService } from '../prisma.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';

describe('PipelineController', () => {
  let controller: PipelineController;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      reportJob: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      lead: {
        aggregate: jest.fn(),
      },
      subscription: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PipelineController],
      providers: [{ provide: PrismaService, useValue: prismaService }],
    })
      .overrideGuard(AdminKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PipelineController>(PipelineController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPipelineJobs', () => {
    it('should return jobs with health metrics', async () => {
      const mockJobs = [{ id: 'job-1', status: 'COMPLETE' }];
      prismaService.reportJob.findMany.mockResolvedValue(mockJobs);
      prismaService.reportJob.count
        .mockResolvedValueOnce(5) // awaitingData
        .mockResolvedValueOnce(2) // processing
        .mockResolvedValueOnce(10) // complete
        .mockResolvedValueOnce(1); // failed

      const result = await controller.getPipelineJobs();
      expect(result.jobs).toEqual(mockJobs);
      expect(result.health).toEqual({
        awaitingData: 5,
        processing: 2,
        complete: 10,
        failed: 1,
      });
    });

    it('should filter by status when provided', async () => {
      prismaService.reportJob.findMany.mockResolvedValue([]);
      prismaService.reportJob.count.mockResolvedValue(0);

      await controller.getPipelineJobs('FAILED');
      expect(prismaService.reportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'FAILED' } }),
      );
    });

    it('should not filter when status not provided', async () => {
      prismaService.reportJob.findMany.mockResolvedValue([]);
      prismaService.reportJob.count.mockResolvedValue(0);

      await controller.getPipelineJobs();
      expect(prismaService.reportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('getJobDetail', () => {
    it('should return job detail', async () => {
      const mockJob = { id: 'job-1', status: 'COMPLETE' };
      prismaService.reportJob.findUnique.mockResolvedValue(mockJob);

      const result = await controller.getJobDetail('job-1');
      expect(result).toEqual(mockJob);
      expect(prismaService.reportJob.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        include: { user: { select: { email: true, name: true } } },
      });
    });
  });

  describe('forceAdvance', () => {
    it('should advance job to QUEUED status', async () => {
      prismaService.reportJob.update.mockResolvedValue({});

      const result = await controller.forceAdvance('job-1');
      expect(result).toEqual({ message: 'Job advanced to QUEUED' });
      expect(prismaService.reportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'QUEUED' },
      });
    });
  });

  describe('forceFail', () => {
    it('should mark job as FAILED with custom reason', async () => {
      prismaService.reportJob.update.mockResolvedValue({});

      const result = await controller.forceFail('job-1', {
        reason: 'Bad data',
      });
      expect(result).toEqual({ message: 'Job marked as FAILED' });
      expect(prismaService.reportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'FAILED', errorMessage: 'Bad data' },
      });
    });

    it('should use default reason when not provided', async () => {
      prismaService.reportJob.update.mockResolvedValue({});

      await controller.forceFail('job-1', {} as any);
      expect(prismaService.reportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'FAILED',
          errorMessage: 'Manually failed by admin',
        },
      });
    });
  });

  describe('forceRegenerate', () => {
    it('should re-queue job for regeneration', async () => {
      prismaService.reportJob.update.mockResolvedValue({});

      const result = await controller.forceRegenerate('job-1');
      expect(result).toEqual({ message: 'Job re-queued for regeneration' });
      expect(prismaService.reportJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'QUEUED', retryCount: 0, errorMessage: null },
      });
    });
  });

  describe('getRevenueMetrics', () => {
    it('should return revenue metrics', async () => {
      prismaService.lead.aggregate
        .mockResolvedValueOnce({ _sum: { revenueAmount: 500 } }) // today
        .mockResolvedValueOnce({ _sum: { revenueAmount: 5000 } }) // month
        .mockResolvedValueOnce({ _sum: { revenueAmount: 50000 } }); // year

      prismaService.subscription.count
        .mockResolvedValueOnce(10) // active subscriptions (not one_time)
        .mockResolvedValueOnce(15) // total subscriptions
        .mockResolvedValueOnce(5) // monthly
        .mockResolvedValueOnce(3) // annual
        .mockResolvedValueOnce(2); // partner

      const result = await controller.getRevenueMetrics();
      expect(result.revenueToday).toBe(500);
      expect(result.revenueMonth).toBe(5000);
      expect(result.revenueYear).toBe(50000);
      // mrr = 5*299 + 3*200 + 2*499 = 1495 + 600 + 998 = 3093
      expect(result.mrr).toBe(3093);
      expect(result.arr).toBe(3093 * 12);
      expect(result.activeSubscriptions).toBe(10);
      expect(result.totalSubscriptions).toBe(15);
    });

    it('should handle null revenue amounts', async () => {
      prismaService.lead.aggregate
        .mockResolvedValueOnce({ _sum: { revenueAmount: null } })
        .mockResolvedValueOnce({ _sum: { revenueAmount: null } })
        .mockResolvedValueOnce({ _sum: { revenueAmount: null } });

      prismaService.subscription.count.mockResolvedValue(0);

      const result = await controller.getRevenueMetrics();
      expect(result.revenueToday).toBe(0);
      expect(result.revenueMonth).toBe(0);
      expect(result.revenueYear).toBe(0);
      expect(result.mrr).toBe(0);
    });
  });

  describe('jobStatus', () => {
    it('should return an Observable', () => {
      const result = controller.jobStatus('job-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.subscribe).toBeDefined();
    });

    it('should return an Observable even without userId', () => {
      const result = controller.jobStatus('job-1');
      expect(result).toBeDefined();
      expect(result.subscribe).toBeDefined();
    });
  });

  describe('getRevenueMetrics — edge cases', () => {
    it('should compute MRR correctly with mixed subscription types', async () => {
      prismaService.lead.aggregate
        .mockResolvedValueOnce({ _sum: { revenueAmount: 100 } })
        .mockResolvedValueOnce({ _sum: { revenueAmount: 1000 } })
        .mockResolvedValueOnce({ _sum: { revenueAmount: 10000 } });

      prismaService.subscription.count
        .mockResolvedValueOnce(8) // active non-one_time
        .mockResolvedValueOnce(12) // total active
        .mockResolvedValueOnce(3) // monthly
        .mockResolvedValueOnce(5) // annual
        .mockResolvedValueOnce(1); // partner

      const result = await controller.getRevenueMetrics();
      // mrr = 3*299 + 5*200 + 1*499 = 897 + 1000 + 499 = 2396
      expect(result.mrr).toBe(2396);
      expect(result.arr).toBe(2396 * 12);
      expect(result.revenueToday).toBe(100);
    });
  });

  describe('getPipelineJobs — with status filter', () => {
    it('should filter by COMPLETE status', async () => {
      prismaService.reportJob.findMany.mockResolvedValue([
        { id: 'j1', status: 'COMPLETE' },
      ]);
      prismaService.reportJob.count.mockResolvedValue(0);

      await controller.getPipelineJobs('COMPLETE');
      expect(prismaService.reportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'COMPLETE' } }),
      );
    });
  });

  // ── SSE endpoint — Observable emission ───────────────────────
  describe('jobStatus — SSE emission', () => {
    it('emits job data from the observable when subscribed', (done) => {
      prismaService.reportJob.findFirst.mockResolvedValue({
        status: 'COMPLETE',
        completedAt: new Date(),
        errorMessage: null,
      });

      const obs = controller.jobStatus('job-sse', 'user-sse');
      const sub = obs.subscribe({
        next: (event) => {
          expect(event.data).toBeDefined();
          expect(event.data.status).toBe('COMPLETE');
          sub.unsubscribe();
          done();
        },
        error: done,
      });
    });

    it('emits null data when userId is not provided (tenant guard)', (done) => {
      prismaService.reportJob.findFirst.mockResolvedValue(null);

      const obs = controller.jobStatus('job-no-user');
      const sub = obs.subscribe({
        next: (event) => {
          expect(event.data).toBeNull();
          sub.unsubscribe();
          done();
        },
        error: done,
      });
    });
  });
});
