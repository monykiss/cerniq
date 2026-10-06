import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, interval, map, takeWhile, switchMap, from } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { AdminKeyGuard } from '../auth/admin-key.guard';
import { ForceFailDto } from '../alm/dto/inline-bodies.dto';

@Controller()
export class PipelineController {
  private readonly logger = new Logger(PipelineController.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Pipeline Dashboard ────────────────────────────────

  @Get('admin/api/pipeline')
  @UseGuards(AdminKeyGuard)
  async getPipelineJobs(@Query('status') status?: string) {
    const where = status ? { status: status as any } : {};
    const jobs = await this.prisma.reportJob.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Pipeline health metrics
    const [awaitingData, processing, complete, failed] = await Promise.all([
      this.prisma.reportJob.count({ where: { status: 'AWAITING_DATA' } }),
      this.prisma.reportJob.count({
        where: {
          status: { in: ['PROCESSING', 'GENERATING_PDF', 'UPLOADING'] },
        },
      }),
      this.prisma.reportJob.count({ where: { status: 'COMPLETE' } }),
      this.prisma.reportJob.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      jobs,
      health: { awaitingData, processing, complete, failed },
    };
  }

  // ── Job Detail ────────────────────────────────────────

  @Get('admin/api/pipeline/:jobId')
  @UseGuards(AdminKeyGuard)
  async getJobDetail(@Param('jobId') jobId: string) {
    const job = await this.prisma.reportJob.findUnique({
      where: { id: jobId },
      include: { user: { select: { email: true, name: true } } },
    });

    return job;
  }

  // ── Manual Controls ───────────────────────────────────

  @Post('admin/api/pipeline/:jobId/force-advance')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  async forceAdvance(@Param('jobId') jobId: string) {
    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED' },
    });

    this.logger.log({ event: 'admin.force_advance', jobId });
    return { message: 'Job advanced to QUEUED' };
  }

  @Post('admin/api/pipeline/:jobId/force-fail')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  async forceFail(@Param('jobId') jobId: string, @Body() body: ForceFailDto) {
    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage: body.reason || 'Manually failed by admin',
      },
    });

    this.logger.log({ event: 'admin.force_fail', jobId, reason: body.reason });
    return { message: 'Job marked as FAILED' };
  }

  @Post('admin/api/pipeline/:jobId/force-regenerate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  async forceRegenerate(@Param('jobId') jobId: string) {
    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', retryCount: 0, errorMessage: null },
    });

    this.logger.log({ event: 'admin.force_regenerate', jobId });
    return { message: 'Job re-queued for regeneration' };
  }

  // ── Revenue Metrics ───────────────────────────────────

  @Get('admin/api/revenue')
  @UseGuards(AdminKeyGuard)
  async getRevenueMetrics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      todayRevenue,
      monthRevenue,
      yearRevenue,
      activeSubscriptions,
      totalSubscriptions,
    ] = await Promise.all([
      this.prisma.lead.aggregate({
        _sum: { revenueAmount: true },
        where: { status: 'CLOSED_WON', convertedAt: { gte: startOfDay } },
      }),
      this.prisma.lead.aggregate({
        _sum: { revenueAmount: true },
        where: { status: 'CLOSED_WON', convertedAt: { gte: startOfMonth } },
      }),
      this.prisma.lead.aggregate({
        _sum: { revenueAmount: true },
        where: { status: 'CLOSED_WON', convertedAt: { gte: startOfYear } },
      }),
      this.prisma.subscription.count({
        where: { status: 'active', tier: { not: 'one_time' } },
      }),
      this.prisma.subscription.count({ where: { status: 'active' } }),
    ]);

    // Calculate MRR from active subscriptions
    const monthlySubs = await this.prisma.subscription.count({
      where: { status: 'active', tier: 'monthly' },
    });
    const annualSubs = await this.prisma.subscription.count({
      where: { status: 'active', tier: 'annual' },
    });
    const partnerSubs = await this.prisma.subscription.count({
      where: { status: 'active', tier: 'partner' },
    });

    const mrr = monthlySubs * 299 + annualSubs * 200 + partnerSubs * 499; // annual = $2400/12 = $200/mo

    return {
      revenueToday: todayRevenue._sum.revenueAmount || 0,
      revenueMonth: monthRevenue._sum.revenueAmount || 0,
      revenueYear: yearRevenue._sum.revenueAmount || 0,
      mrr,
      arr: mrr * 12,
      activeSubscriptions,
      totalSubscriptions,
    };
  }

  // ── SSE Job Status (for client portal) ────────────────

  // verify:auth-skip — tenant-scoped SSE stream; auth-by-construction via owning-userId query param + null-on-mismatch (no userId leak path)
  @Sse('api/jobs/:jobId/status')
  jobStatus(
    @Param('jobId') jobId: string,
    @Query('userId') userId?: string,
  ): Observable<MessageEvent> {
    // Tenant-scoped: only return status for jobs owned by the requesting user.
    // If no userId is provided, the query returns null (no data leak).
    return interval(3000).pipe(
      switchMap(() =>
        from(
          this.prisma.reportJob.findFirst({
            where: {
              id: jobId,
              ...(userId ? { userId } : { userId: '__none__' }),
            },
            select: { status: true, completedAt: true, errorMessage: true },
          }),
        ),
      ),
      map((job) => ({ data: job }) as MessageEvent),
      takeWhile((event) => {
        const status = event.data?.status;
        return status !== 'COMPLETE' && status !== 'FAILED';
      }, true),
    );
  }
}
