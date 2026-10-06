import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpStatus,
  Logger,
  BadRequestException,
  HttpCode,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminKeyGuard } from '../auth/admin-key.guard';
import { PrismaService } from '../prisma.service';

@Controller('api/feedback')
export class FeedbackController {
  private readonly logger = new Logger(FeedbackController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/feedback/nps?score=X&jobId=Y&institutionId=Z
   * Public endpoint (no auth) — accessed from email links.
   * Records NPS score and redirects to frontend thank-you page.
   */
  // verify:auth-skip — public NPS scoring landed from email tracking links; throttled 10/min/IP
  @Get('nps')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 NPS submissions per minute per IP
  @Redirect()
  async recordNPS(
    @Query('score') scoreStr: string,
    @Query('jobId') jobId: string,
    @Query('institutionId') institutionId: string,
  ) {
    const frontendUrl = (process.env.FRONTEND_URL || 'https://cerniq.io')
      .trim()
      .replace(/\/+$/, '');

    try {
      const score = parseInt(scoreStr, 10);
      if (isNaN(score) || score < 0 || score > 10) {
        return {
          url: `${frontendUrl}/thank-you?error=invalid_score`,
          statusCode: HttpStatus.FOUND,
        };
      }

      // Check if feedback already exists for this job
      const existing = jobId
        ? await this.prisma.feedback.findFirst({ where: { jobId } })
        : null;

      if (existing) {
        await this.prisma.feedback.update({
          where: { id: existing.id },
          data: { npsScore: score, respondedAt: new Date() },
        });
        this.logger.log({
          event: 'nps.updated',
          feedbackId: existing.id,
          score,
        });
      } else {
        await this.prisma.feedback.create({
          data: {
            jobId: jobId || null,
            institutionId: institutionId || null,
            npsScore: score,
            respondedAt: new Date(),
          },
        });
        this.logger.log({ event: 'nps.recorded', jobId, score });
      }

      return {
        url: `${frontendUrl}/thank-you?score=${score}&jobId=${jobId || ''}`,
        statusCode: HttpStatus.FOUND,
      };
    } catch (error: any) {
      this.logger.error({ event: 'nps.record.failed', error: error.message });
      return {
        url: `${frontendUrl}/thank-you?error=server_error`,
        statusCode: HttpStatus.FOUND,
      };
    }
  }

  /**
   * POST /api/feedback/:id/comment
   * Public endpoint — allows submitting a follow-up comment after NPS score.
   */
  // verify:auth-skip — public follow-up comment after NPS scoring; feedback row is the auth surface (must exist)
  @Post(':id/comment')
  @HttpCode(HttpStatus.OK)
  async addComment(
    @Param('id') id: string,
    @Body() body: { comment?: string; contactOk?: boolean },
  ) {
    try {
      const feedback = await this.prisma.feedback.findUnique({ where: { id } });
      if (!feedback) {
        throw new BadRequestException('Feedback not found');
      }

      const updated = await this.prisma.feedback.update({
        where: { id },
        data: {
          comment: body.comment || null,
          contactOk: body.contactOk ?? false,
        },
      });

      this.logger.log({ event: 'feedback.comment.added', feedbackId: id });
      return { success: true, id: updated.id };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error({
        event: 'feedback.comment.failed',
        id,
        error: error.message,
      });
      throw new BadRequestException('Failed to save comment');
    }
  }

  /**
   * POST /api/feedback/comment
   * Public endpoint — allows submitting a comment by jobId (for thank-you page).
   */
  // verify:auth-skip — public comment-by-jobId from the post-NPS thank-you page
  @Post('comment')
  @HttpCode(HttpStatus.OK)
  async addCommentByJob(
    @Body() body: { jobId?: string; comment?: string; contactOk?: boolean },
  ) {
    try {
      if (!body.jobId) {
        throw new BadRequestException('jobId is required');
      }

      let feedback = await this.prisma.feedback.findFirst({
        where: { jobId: body.jobId },
      });

      if (feedback) {
        feedback = await this.prisma.feedback.update({
          where: { id: feedback.id },
          data: {
            comment: body.comment || null,
            contactOk: body.contactOk ?? false,
          },
        });
      } else {
        feedback = await this.prisma.feedback.create({
          data: {
            jobId: body.jobId,
            comment: body.comment || null,
            contactOk: body.contactOk ?? false,
          },
        });
      }

      this.logger.log({
        event: 'feedback.comment.added_by_job',
        jobId: body.jobId,
      });
      return { success: true, id: feedback.id };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error({
        event: 'feedback.comment_by_job.failed',
        error: error.message,
      });
      throw new BadRequestException('Failed to save comment');
    }
  }

  /**
   * GET /api/feedback/admin/stats
   * Returns NPS stats: average, count, promoters, passives, detractors.
   * Protected: requires ADMIN_KEY.
   */
  @Get('admin/stats')
  @UseGuards(AdminKeyGuard)
  async getStats() {
    try {
      const allFeedback = await this.prisma.feedback.findMany({
        where: { npsScore: { not: null } },
        select: { npsScore: true },
      });

      if (allFeedback.length === 0) {
        return {
          averageScore: 0,
          responseCount: 0,
          promoters: 0,
          passives: 0,
          detractors: 0,
          npsScore: 0,
        };
      }

      const scores = allFeedback.map((f: any) => f.npsScore!);
      const promoters = scores.filter((s: number) => s >= 9).length;
      const passives = scores.filter((s: number) => s >= 7 && s <= 8).length;
      const detractors = scores.filter((s: number) => s <= 6).length;
      const averageScore =
        scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
      const npsScore = Math.round(
        ((promoters - detractors) / scores.length) * 100,
      );

      return {
        averageScore: Math.round(averageScore * 10) / 10,
        responseCount: scores.length,
        promoters,
        passives,
        detractors,
        npsScore,
      };
    } catch (error: any) {
      this.logger.error({
        event: 'feedback.stats.failed',
        error: error.message,
      });
      return {
        averageScore: 0,
        responseCount: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        npsScore: 0,
      };
    }
  }
}
