import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { EmailService } from './email.service';

/**
 * Email Sequence Processor — fires scheduled lifecycle emails.
 *
 * Sequence Keys:
 *   A1 — Lead nurture: sample report teaser (24h after lead)
 *   A2 — Lead nurture: follow-up with pricing (72h)
 *   A3 — Lead nurture: urgency / exam-season (7d)
 *   B1 — Onboarding: welcome (fired immediately by billing webhook)
 *   B2 — Onboarding: data submission reminder (30 min post-purchase)
 *   B3 — Onboarding: check-in (48h post-purchase)
 *   C1 — Report ready (fired by pipeline worker)
 *   C2 — Report follow-up: how to use (24h after delivery)
 *   D1 — Retention: monthly cycle reminder (fired by invoice.paid)
 *   D5 — Win-back (90d after cancellation)
 *   E1 — operator alerts (fired inline, not scheduled)
 */
@Injectable()
export class EmailSequenceProcessor {
  private readonly logger = new Logger(EmailSequenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes
  async processDueSequences() {
    const due = await this.prisma.emailSequence.findMany({
      where: {
        sentAt: null,
        cancelled: false,
        scheduledAt: { lte: new Date() },
      },
      take: 20,
      orderBy: { scheduledAt: 'asc' },
    });

    if (!due.length) return;

    this.logger.log({ event: 'sequence.processing', count: due.length });

    for (const seq of due) {
      try {
        await this.fireSequence(seq);

        await this.prisma.emailSequence.update({
          where: { id: seq.id },
          data: { sentAt: new Date() },
        });

        this.logger.log({
          event: 'sequence.sent',
          id: seq.id,
          key: seq.sequenceKey,
        });
      } catch (err: any) {
        this.logger.error({
          event: 'sequence.failed',
          id: seq.id,
          key: seq.sequenceKey,
          error: err.message,
        });
      }
    }
  }

  private async fireSequence(seq: {
    sequenceKey: string;
    userId: string | null;
    leadId: string | null;
    metadata: any;
  }) {
    // Resolve user context
    let user: { email: string; name: string | null } | null = null;
    if (seq.userId) {
      user = await this.prisma.user.findUnique({
        where: { id: seq.userId },
        select: { email: true, name: true },
      });
    }

    // Resolve lead context
    let lead: { email: string; name: string; institutionName: string } | null =
      null;
    if (seq.leadId) {
      lead = await this.prisma.lead.findUnique({
        where: { id: seq.leadId },
        select: { email: true, name: true, institutionName: true },
      });
    }

    const email = user?.email || lead?.email;
    if (!email) {
      this.logger.warn({
        event: 'sequence.no_recipient',
        id: seq.sequenceKey,
        userId: seq.userId,
        leadId: seq.leadId,
      });
      return;
    }

    const name = user?.name || lead?.name || '';

    switch (seq.sequenceKey) {
      case 'B2':
        // Data submission reminder (30 min after purchase)
        await this.email.sendDataSubmissionReminder({ email, name });
        break;

      case 'B3':
        // Check-in (48h after purchase)
        await this.email.sendOnboardingCheckIn({ email, name });
        break;

      case 'C2':
        // Report follow-up (24h after delivery)
        await this.email.sendReportFollowUp({
          email,
          name,
          institutionName: lead?.institutionName || '',
        });
        break;

      case 'D5':
        // Win-back (90d after cancellation)
        await this.email.sendWinBackEmail({ email, name });
        break;

      case 'A1':
        // Lead nurture: teaser
        await this.email.sendLeadNurtureTeaser({
          email,
          name,
          institutionName: lead?.institutionName || '',
        });
        break;

      case 'A2':
        // Lead nurture: pricing follow-up
        await this.email.sendLeadNurturePricing({ email, name });
        break;

      case 'NPS':
        // NPS survey — handled directly by pipeline worker sendNPSSurveys cron
        // If it reaches here, it was already sent inline; skip gracefully.
        this.logger.log({
          event: 'sequence.nps.skip',
          note: 'NPS sent inline by cron',
        });
        break;

      default:
        this.logger.warn({
          event: 'sequence.unknown_key',
          key: seq.sequenceKey,
        });
    }
  }
}
