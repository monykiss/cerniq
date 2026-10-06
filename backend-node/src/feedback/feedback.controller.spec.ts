import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackController } from './feedback.controller';
import { PrismaService } from '../prisma.service';

jest.mock('../prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

describe('FeedbackController', () => {
  let controller: FeedbackController;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    process.env.FRONTEND_URL = 'https://cerniq.io';

    prisma = {
      feedback: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get<FeedbackController>(FeedbackController);
  });

  // ── recordNPS ──────────────────────────────────

  describe('GET /api/feedback/nps', () => {
    it('should redirect to thank-you with valid score', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);
      prisma.feedback.create.mockResolvedValue({ id: 'fb-1' });

      const result = await controller.recordNPS('9', 'job-1', 'inst-1');

      expect(result.url).toContain('/thank-you?score=9');
      expect(result.statusCode).toBe(302);
      expect(prisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobId: 'job-1',
          institutionId: 'inst-1',
          npsScore: 9,
        }),
      });
    });

    it('should redirect with error for invalid score (out of range)', async () => {
      const result = await controller.recordNPS('11', 'j', 'i');

      expect(result.url).toContain('error=invalid_score');
      expect(prisma.feedback.create).not.toHaveBeenCalled();
    });

    it('should redirect with error for NaN score', async () => {
      const result = await controller.recordNPS('abc', 'j', 'i');

      expect(result.url).toContain('error=invalid_score');
    });

    it('should redirect with error for negative score', async () => {
      const result = await controller.recordNPS('-1', 'j', 'i');

      expect(result.url).toContain('error=invalid_score');
    });

    it('should update existing feedback instead of creating duplicate', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        id: 'fb-existing',
        npsScore: 5,
      });
      prisma.feedback.update.mockResolvedValue({
        id: 'fb-existing',
        npsScore: 8,
      });

      const result = await controller.recordNPS('8', 'job-1', 'inst-1');

      expect(result.url).toContain('score=8');
      expect(prisma.feedback.update).toHaveBeenCalledWith({
        where: { id: 'fb-existing' },
        data: expect.objectContaining({ npsScore: 8 }),
      });
      expect(prisma.feedback.create).not.toHaveBeenCalled();
    });

    it('should accept score 0 (valid NPS score)', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);
      prisma.feedback.create.mockResolvedValue({ id: 'fb-new' });

      const result = await controller.recordNPS('0', 'job-1', '');

      expect(result.url).toContain('score=0');
    });

    it('should accept score 10 (max NPS score)', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);
      prisma.feedback.create.mockResolvedValue({ id: 'fb-new' });

      const result = await controller.recordNPS('10', 'job-1', '');

      expect(result.url).toContain('score=10');
    });
  });

  // ── addComment ─────────────────────────────────

  describe('POST /api/feedback/:id/comment', () => {
    it('should add comment to existing feedback', async () => {
      prisma.feedback.findUnique.mockResolvedValue({ id: 'fb-1' });
      prisma.feedback.update.mockResolvedValue({ id: 'fb-1' });

      const result = await controller.addComment('fb-1', {
        comment: 'Great report!',
        contactOk: true,
      });

      expect(result.success).toBe(true);
      expect(prisma.feedback.update).toHaveBeenCalledWith({
        where: { id: 'fb-1' },
        data: { comment: 'Great report!', contactOk: true },
      });
    });

    it('should throw when feedback not found', async () => {
      prisma.feedback.findUnique.mockResolvedValue(null);

      await expect(
        controller.addComment('fb-bad', { comment: 'test' }),
      ).rejects.toThrow('Feedback not found');
    });

    it('should default contactOk to false when not provided', async () => {
      prisma.feedback.findUnique.mockResolvedValue({ id: 'fb-1' });
      prisma.feedback.update.mockResolvedValue({ id: 'fb-1' });

      await controller.addComment('fb-1', { comment: 'Good' });

      expect(prisma.feedback.update).toHaveBeenCalledWith({
        where: { id: 'fb-1' },
        data: expect.objectContaining({ contactOk: false }),
      });
    });
  });

  // ── addCommentByJob ────────────────────────────

  describe('POST /api/feedback/comment', () => {
    it('should update existing feedback for job', async () => {
      prisma.feedback.findFirst.mockResolvedValue({ id: 'fb-1' });
      prisma.feedback.update.mockResolvedValue({ id: 'fb-1' });

      const result = await controller.addCommentByJob({
        jobId: 'job-1',
        comment: 'Very helpful',
        contactOk: true,
      });

      expect(result.success).toBe(true);
    });

    it('should create new feedback when none exists for job', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);
      prisma.feedback.create.mockResolvedValue({ id: 'fb-new' });

      const result = await controller.addCommentByJob({
        jobId: 'job-new',
        comment: 'First feedback',
      });

      expect(result.success).toBe(true);
      expect(prisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobId: 'job-new',
          comment: 'First feedback',
        }),
      });
    });

    it('should throw when jobId is not provided', async () => {
      await expect(
        controller.addCommentByJob({ comment: 'orphan' }),
      ).rejects.toThrow('jobId is required');
    });
  });

  // ── getStats (NPS calculation) ─────────────────

  describe('GET /api/feedback/admin/stats', () => {
    it('should compute NPS from scores', async () => {
      prisma.feedback.findMany.mockResolvedValue([
        { npsScore: 10 }, // promoter
        { npsScore: 9 }, // promoter
        { npsScore: 8 }, // passive
        { npsScore: 7 }, // passive
        { npsScore: 5 }, // detractor
      ]);

      const stats = await controller.getStats();

      expect(stats.responseCount).toBe(5);
      expect(stats.promoters).toBe(2);
      expect(stats.passives).toBe(2);
      expect(stats.detractors).toBe(1);
      // NPS = ((2 - 1) / 5) * 100 = 20
      expect(stats.npsScore).toBe(20);
      expect(stats.averageScore).toBe(7.8);
    });

    it('should return zero stats with no responses', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);

      const stats = await controller.getStats();

      expect(stats.responseCount).toBe(0);
      expect(stats.npsScore).toBe(0);
      expect(stats.averageScore).toBe(0);
    });

    it('should handle all promoters (NPS = 100)', async () => {
      prisma.feedback.findMany.mockResolvedValue([
        { npsScore: 10 },
        { npsScore: 9 },
        { npsScore: 10 },
      ]);

      const stats = await controller.getStats();

      expect(stats.npsScore).toBe(100);
      expect(stats.detractors).toBe(0);
    });

    it('should handle all detractors (NPS = -100)', async () => {
      prisma.feedback.findMany.mockResolvedValue([
        { npsScore: 3 },
        { npsScore: 1 },
        { npsScore: 6 },
      ]);

      const stats = await controller.getStats();

      expect(stats.npsScore).toBe(-100);
      expect(stats.promoters).toBe(0);
    });
  });

  // Coverage: lines 83-84 — recordNPS catch block (server error)
  describe('recordNPS error handling', () => {
    it('should redirect to thank-you with error on server error', async () => {
      prisma.feedback.findFirst.mockRejectedValue(new Error('DB down'));

      const result = await controller.recordNPS('9', 'job-1', 'inst-1');

      expect(result.url).toContain('error=server_error');
      expect(result.statusCode).toBe(302);
    });
  });

  // Coverage: lines 119-124 — addComment catch block
  describe('addComment error handling', () => {
    it('should throw BadRequestException on unexpected error', async () => {
      prisma.feedback.findUnique.mockResolvedValue({ id: 'fb-1' });
      prisma.feedback.update.mockRejectedValue(new Error('DB write failed'));

      await expect(
        controller.addComment('fb-1', { comment: 'test', contactOk: false }),
      ).rejects.toThrow('Failed to save comment');
    });
  });

  // Coverage: lines 171-175 — addCommentByJob catch block
  describe('addCommentByJob error handling', () => {
    it('should throw BadRequestException on unexpected error', async () => {
      prisma.feedback.findFirst.mockRejectedValue(new Error('DB error'));

      await expect(
        controller.addCommentByJob({ jobId: 'job-1', comment: 'test' }),
      ).rejects.toThrow('Failed to save comment');
    });
  });

  // Coverage: lines 223-227 — getStats catch block
  describe('getStats error handling', () => {
    it('should return zero stats on error', async () => {
      prisma.feedback.findMany.mockRejectedValue(new Error('DB unavailable'));

      const stats = await controller.getStats();

      expect(stats.averageScore).toBe(0);
      expect(stats.responseCount).toBe(0);
      expect(stats.npsScore).toBe(0);
    });
  });
});
