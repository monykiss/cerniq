import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class PipelineHealthMonitor {
  private readonly logger = new Logger(PipelineHealthMonitor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 * * * *') // Every hour
  async checkStuckJobs() {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const stuckJobs = await this.prisma.reportJob.findMany({
      where: {
        status: 'PROCESSING',
        processingStartedAt: { lt: thirtyMinAgo },
      },
      include: { user: true },
    });

    for (const job of stuckJobs) {
      this.logger.error({
        event: 'pipeline.job.stuck',
        jobId: job.id,
        elapsed: '30+ min',
      });

      if (job.retryCount < 3) {
        await this.prisma.reportJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', retryCount: { increment: 1 } },
        });
        this.logger.log({
          event: 'pipeline.job.auto_retry',
          jobId: job.id,
          attempt: job.retryCount + 1,
        });
      } else {
        await this.prisma.reportJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Max retries exceeded — manual intervention required',
          },
        });

        await this.email.sendJobFailedAlert({
          jobId: job.id,
          institutionName: job.institutionName,
          error: 'Max retries exceeded after 3 attempts',
          clientEmail: job.user?.email || 'unknown',
        });
      }
    }
  }

  @Cron('0 12 * * *') // 8am AST (12:00 UTC)
  async dailyHealthReport() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [pendingJobs, failedJobs, newLeads, pendingFollowUps] =
      await Promise.all([
        this.prisma.reportJob.count({ where: { status: 'AWAITING_DATA' } }),
        this.prisma.reportJob.count({
          where: { status: 'FAILED', createdAt: { gte: sevenDaysAgo } },
        }),
        this.prisma.lead.count({
          where: { status: 'NEW', createdAt: { gte: oneDayAgo } },
        }),
        this.prisma.lead.count({
          where: {
            nextFollowUp: { lte: new Date() },
            status: { notIn: ['CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED'] },
          },
        }),
      ]);

    await this.email.sendDailyOperationsReport({
      pendingJobs,
      failedJobs,
      newLeads,
      pendingFollowUps,
    });

    this.logger.log({
      event: 'daily.health_report',
      pendingJobs,
      failedJobs,
      newLeads,
      pendingFollowUps,
    });
  }
}
