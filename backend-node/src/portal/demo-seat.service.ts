import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from '../alm/alm-enterprise.service';
import { CossecDataPullService } from '../alm/data-pull/cossec-data-pull.service';
import { NCUADataPullService } from '../alm/data-pull/ncua-data-pull.service';
import { BillingService } from '../billing/billing.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { DemoSeatEngagementService } from './demo-seat-engagement.service';

const DEFAULT_DEMO_TTL_DAYS = 14;
const DEMO_USER_PROVIDER = 'demo_seat';
const DEMO_TRIGGERED_BY = 'demo_provision';

// Tiers we'll never downgrade to demo when reusing an existing user. The
// platform admin and any paying customer is protected even if their email is
// (re)used as a contact email on a prospect record.
const PROTECTED_TIERS = new Set(['one_time', 'monthly', 'annual', 'partner']);

export interface DemoSeatProvisionInput {
  prospectId: string;
  contactEmail?: string;
  contactName?: string;
  ttlDays?: number;
  preferredLanguage?: 'en' | 'es';
  /** When true, also fires sendDemoPortalReady email to the prospect */
  sendEmail?: boolean;
}

export interface DemoSeatProvisionResult {
  prospectId: string;
  userId: string;
  workspaceId: string;
  institutionId: string;
  reportJobId: string;
  magicLinkUrl: string;
  expiresAt: string;
  provisionedAt: string;
  contactEmail: string;
  reused: boolean;
  source: 'cossec_public_filings' | 'ncua_5300';
  asOfQuarter: string | null;
  disclosure: string;
  reportPortalUrl: string;
  /**
   * False when an existing user already had a protected (paid) subscription
   * that we left untouched. The user still gets a fresh ReportJob and magic
   * link, but their tier was NOT changed to 'demo'. This is the platform-admin
   * and existing-customer safeguard.
   */
  subscriptionUpdated: boolean;
}

interface BalanceSheetItemInput {
  category: 'asset' | 'liability';
  subcategory: string;
  name: string;
  balance: number;
  rate: number;
  duration: number;
  rateType: string;
}

interface PublicDataPayload {
  source: 'cossec_public_filings' | 'ncua_5300';
  institutionName: string;
  institutionType: 'cooperativa' | 'credit_union';
  primaryRegulator: 'COSSEC' | 'NCUA';
  preferredLanguage: 'es' | 'en';
  totalAssetsMillions: number;
  asOfDate: string;
  asOfQuarter: string | null;
  disclosure: string;
  items: BalanceSheetItemInput[];
}

@Injectable()
export class DemoSeatService {
  private readonly logger = new Logger(DemoSeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly cossecDataPull: CossecDataPullService,
    private readonly ncuaDataPull: NCUADataPullService,
    private readonly billing: BillingService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly engagement: DemoSeatEngagementService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Provision (or re-provision) a portal seat for a prospect using only
   * publicly-sourced data. Idempotent: re-running for the same prospect
   * refreshes the report job and extends the TTL but preserves the user.
   */
  async provisionFromProspect(
    input: DemoSeatProvisionInput,
  ): Promise<DemoSeatProvisionResult> {
    const prospect = await this.prisma.prospectInstitution.findUnique({
      where: { id: input.prospectId },
    });
    if (!prospect) {
      throw new NotFoundException(`Prospect ${input.prospectId} not found`);
    }

    const contactEmail = this.normalizeEmail(
      input.contactEmail || prospect.contactEmail,
    );
    if (!contactEmail) {
      throw new BadRequestException(
        'Prospect has no contact email. Provide one via input.contactEmail or update the prospect record.',
      );
    }

    const ttlDays = Math.max(
      1,
      Math.min(60, input.ttlDays ?? DEFAULT_DEMO_TTL_DAYS),
    );
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000);

    const publicData = await this.fetchPublicData(
      prospect,
      input.preferredLanguage,
    );

    // 1. User (idempotent by email)
    const user = await this.upsertDemoUser({
      email: contactEmail,
      name: input.contactName || prospect.contactName || prospect.name,
    });

    // 2. Workspace
    const workspace = await this.upsertDemoWorkspace(user.id, prospect.name);

    // 3. Subscription (tier=demo, status=active, currentPeriodEnd=expiresAt)
    //    NEVER overwrites a paid subscription — protects platform admin and real customers.
    const subscriptionUpdated = await this.upsertDemoSubscription(
      user.id,
      expiresAt,
    );

    // 4. Institution + balance sheet items (idempotent by workspace + name)
    const institution = await this.upsertInstitution({
      workspaceId: workspace.id,
      name: publicData.institutionName,
      type: publicData.institutionType,
      totalAssets: publicData.totalAssetsMillions,
      reportingDate: publicData.asOfDate,
      primaryRegulator: publicData.primaryRegulator,
      preferredLanguage: publicData.preferredLanguage,
    });

    await this.almEnterprise.importBalanceSheetItems(
      institution.id,
      publicData.items,
    );

    // 5. Report job (always create a fresh QUEUED job; pipeline cron will pick it up)
    const reportJob = await this.prisma.reportJob.create({
      data: {
        userId: user.id,
        institutionId: institution.id,
        institutionName: publicData.institutionName,
        status: 'QUEUED',
        analysisPeriod:
          publicData.asOfQuarter ||
          `Q${Math.ceil((new Date().getMonth() + 1) / 3)}-${new Date().getFullYear()}`,
        triggeredBy: DEMO_TRIGGERED_BY,
        reportLang: publicData.preferredLanguage,
        submittedAt: new Date(),
      },
    });

    // 6. Magic link (24h longer than TTL so prospect has buffer to log in)
    const magicLinkUrl = await this.billing.generateMagicLink(
      user.id,
      ttlDays * 24 + 24,
    );

    // 7. Persist provisioning trail on the prospect
    const reused = Boolean(prospect.demoUserId);
    await this.prisma.prospectInstitution.update({
      where: { id: prospect.id },
      data: {
        demoUserId: user.id,
        demoReportJobId: reportJob.id,
        demoMagicLinkUrl: magicLinkUrl,
        demoProvisionedAt: new Date(),
        demoExpiresAt: expiresAt,
        publicDataSource: prospect.publicDataSource || publicData.source,
        outreachStatus:
          prospect.outreachStatus === 'closed'
            ? prospect.outreachStatus
            : 'portal_provisioned',
      },
    });

    // 8. Audit
    this.audit.log({
      userId: user.id,
      institutionId: institution.id,
      action: 'demo_seat_provisioned',
      resource: 'prospect_institution',
      resourceId: prospect.id,
      metadata: {
        reused,
        source: publicData.source,
        ttlDays,
        contactEmail,
      },
    });

    this.logger.log({
      event: 'portal.demo_seat_provisioned',
      prospectId: prospect.id,
      userId: user.id,
      reportJobId: reportJob.id,
      source: publicData.source,
      reused,
    });

    // Record the provisioning event in the engagement log (fire-and-forget)
    void this.engagement.recordEvent({
      prospectInstitutionId: prospect.id,
      userId: user.id,
      eventType: 'provisioned',
      metadata: {
        reused,
        source: publicData.source,
        ttlDays,
        institutionName: publicData.institutionName,
        asOfQuarter: publicData.asOfQuarter,
      },
    });

    // 9. Optional email notification
    if (input.sendEmail) {
      try {
        await this.email.sendDemoPortalReady({
          email: contactEmail,
          name: input.contactName || prospect.contactName || prospect.name,
          institutionName: publicData.institutionName,
          magicLinkUrl,
          asOfQuarter: publicData.asOfQuarter || 'recent quarter',
          disclosure: publicData.disclosure,
          expiresAt,
          language: publicData.preferredLanguage,
        });
        void this.engagement.recordEvent({
          prospectInstitutionId: prospect.id,
          userId: user.id,
          eventType: 'email_sent',
          metadata: {
            email: contactEmail,
            template: 'demo_portal_ready',
            language: publicData.preferredLanguage,
          },
        });
      } catch (err: any) {
        this.logger.warn({
          event: 'portal.demo_seat_email_failed',
          prospectId: prospect.id,
          error: err?.message || 'unknown',
        });
      }
    }

    const reportPortalUrl = `${this.frontendUrl()}/portal/reports/${reportJob.id}`;

    return {
      prospectId: prospect.id,
      userId: user.id,
      workspaceId: workspace.id,
      institutionId: institution.id,
      reportJobId: reportJob.id,
      magicLinkUrl,
      expiresAt: expiresAt.toISOString(),
      provisionedAt: new Date().toISOString(),
      contactEmail,
      reused,
      source: publicData.source,
      asOfQuarter: publicData.asOfQuarter,
      disclosure: publicData.disclosure,
      reportPortalUrl,
      subscriptionUpdated,
    };
  }

  /**
   * Mark a demo seat as last-viewed. Called from the portal session loader
   * so admins can see engagement.
   */
  async markViewed(userId: string): Promise<void> {
    await this.prisma.prospectInstitution.updateMany({
      where: { demoUserId: userId },
      data: { demoLastViewedAt: new Date() },
    });
  }

  /**
   * Look up a demo seat by user id (used by portal home to render the demo
   * banner with provenance and days-remaining).
   */
  async getDemoSeatForUser(userId: string) {
    return this.prisma.prospectInstitution.findFirst({
      where: { demoUserId: userId },
      select: {
        id: true,
        name: true,
        publicDataSource: true,
        demoExpiresAt: true,
        demoProvisionedAt: true,
        demoReportJobId: true,
      },
    });
  }

  /**
   * Sweep expired demo seats and flip their subscription to cancelled.
   *
   * Safeguards (why this is safe to run on a loop):
   *   1. Only touches subscriptions where tier='demo' — protected paid tiers
   *      are invisible to this query.
   *   2. Only touches subscriptions whose currentPeriodEnd is strictly in
   *      the past, so there's never any flakiness near the expiry boundary.
   *   3. Emits one audit log entry per expired seat so there's a paper
   *      trail in the admin dashboard.
   *   4. Idempotent: running a second time finds nothing to do.
   *
   * Does NOT delete users, workspaces, institutions, or report jobs — the
   * prospect's data stays in the demo workspace so a re-provisioning call
   * can pick right back up where they left off. The access revocation is
   * the entire enforcement mechanism.
   */
  async sweepExpired(
    now: Date = new Date(),
  ): Promise<{ scanned: number; expired: number; expiredIds: string[] }> {
    const expiredProspects = await this.prisma.prospectInstitution.findMany({
      where: {
        demoUserId: { not: null },
        demoExpiresAt: { lt: now },
      },
      select: {
        id: true,
        name: true,
        demoUserId: true,
        demoExpiresAt: true,
      },
    });

    if (expiredProspects.length === 0) {
      return { scanned: 0, expired: 0, expiredIds: [] };
    }

    const expiredIds: string[] = [];
    let expired = 0;

    for (const prospect of expiredProspects) {
      if (!prospect.demoUserId) continue;

      const subscription = await this.prisma.subscription.findUnique({
        where: { userId: prospect.demoUserId },
      });

      // Only cancel actual demo subscriptions — never touch a paid tier
      if (!subscription || subscription.tier !== 'demo') continue;
      if (subscription.status === 'cancelled') continue;

      await this.prisma.subscription.update({
        where: { userId: prospect.demoUserId },
        data: {
          status: 'cancelled',
          cancelledAt: now,
        },
      });

      this.audit.log({
        userId: prospect.demoUserId,
        action: 'demo_seat_expired',
        resource: 'prospect_institution',
        resourceId: prospect.id,
        metadata: {
          institutionName: prospect.name,
          expiredAt: prospect.demoExpiresAt?.toISOString() || null,
        },
      });
      void this.engagement.recordEvent({
        prospectInstitutionId: prospect.id,
        userId: prospect.demoUserId,
        eventType: 'expired',
        metadata: {
          institutionName: prospect.name,
          expiredAt: prospect.demoExpiresAt?.toISOString() || null,
        },
      });

      this.logger.log({
        event: 'portal.demo_seat_expired',
        prospectId: prospect.id,
        userId: prospect.demoUserId,
      });

      expiredIds.push(prospect.id);
      expired++;
    }

    return { scanned: expiredProspects.length, expired, expiredIds };
  }

  /**
   * Send T-3 expiry reminder emails to demo seats approaching their TTL.
   *
   * Scans for seats where `demoExpiresAt` falls between `now + 48h` and
   * `now + 96h` — a 2-day window that guarantees every seat gets exactly
   * one reminder regardless of when the daily cron fires within that day.
   * Dedup via EmailSequence table (sequenceKey='demo_expiry_reminder' per
   * userId) — running the cron twice in a day is a no-op.
   *
   * NEVER throws. Each per-seat failure is logged and continues — one
   * broken email doesn't block the rest of the batch.
   *
   * Returns { scanned, sent, skipped } counts for observability.
   */
  async sendExpiryReminders(
    now: Date = new Date(),
  ): Promise<{ scanned: number; sent: number; skipped: number }> {
    const windowStart = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 96 * 60 * 60 * 1000);

    const candidates = await this.prisma.prospectInstitution.findMany({
      where: {
        demoUserId: { not: null },
        demoConvertedAt: null, // skip already-converted seats
        demoExpiresAt: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
      select: {
        id: true,
        name: true,
        demoUserId: true,
        contactEmail: true,
        contactName: true,
        demoExpiresAt: true,
      },
    });

    if (candidates.length === 0) {
      return { scanned: 0, sent: 0, skipped: 0 };
    }

    let sent = 0;
    let skipped = 0;

    for (const seat of candidates) {
      if (!seat.demoUserId || !seat.contactEmail) {
        skipped++;
        continue;
      }

      try {
        // Dedup: skip if we already queued a reminder for this seat
        const alreadySent = await this.prisma.emailSequence.findFirst({
          where: {
            userId: seat.demoUserId,
            sequenceKey: 'demo_expiry_reminder',
          },
        });
        if (alreadySent) {
          skipped++;
          continue;
        }

        // Double-check the user still has an active demo subscription —
        // they might have converted between scan and send.
        const subscription = await this.prisma.subscription.findUnique({
          where: { userId: seat.demoUserId },
        });
        if (!subscription || subscription.tier !== 'demo') {
          skipped++;
          continue;
        }

        const expiresMs = seat.demoExpiresAt?.getTime() || 0;
        const daysRemaining = Math.max(
          1,
          Math.ceil((expiresMs - now.getTime()) / 86400_000),
        );
        const frontendUrl = this.frontendUrl();

        await this.email.sendDemoExpiryReminder({
          email: seat.contactEmail,
          name: seat.contactName || seat.name,
          institutionName: seat.name,
          magicLinkUrl: `${frontendUrl}/portal/login`,
          upgradeUrl: `${frontendUrl}/portal/billing`,
          daysRemaining,
          language: 'es',
        });

        // Record the reminder so we don't re-send tomorrow
        await this.prisma.emailSequence.create({
          data: {
            userId: seat.demoUserId,
            sequenceKey: 'demo_expiry_reminder',
            scheduledAt: now,
            sentAt: now,
            metadata: {
              prospectId: seat.id,
              institutionName: seat.name,
              daysRemaining,
            },
          },
        });

        this.audit.log({
          userId: seat.demoUserId,
          action: 'demo_seat_expiry_reminder_sent',
          resource: 'prospect_institution',
          resourceId: seat.id,
          metadata: { daysRemaining, email: seat.contactEmail },
        });

        sent++;
      } catch (err: any) {
        this.logger.warn({
          event: 'portal.demo_seat_reminder_failed',
          prospectId: seat.id,
          error: err?.message || 'unknown',
        });
        skipped++;
      }
    }

    this.logger.log({
      event: 'portal.demo_seat_reminder_batch',
      scanned: candidates.length,
      sent,
      skipped,
    });

    return { scanned: candidates.length, sent, skipped };
  }

  /**
   * List demo seats for the admin dashboard. Supports status filtering
   * (active / expired / all) and sorts by expiry descending so newest
   * provisioning shows first.
   */
  async listAdminDemoSeats(
    filter: 'active' | 'expired' | 'all' = 'all',
    now: Date = new Date(),
  ) {
    const baseWhere = { demoUserId: { not: null } } as const;
    const where =
      filter === 'active'
        ? { ...baseWhere, demoExpiresAt: { gte: now } }
        : filter === 'expired'
          ? { ...baseWhere, demoExpiresAt: { lt: now } }
          : baseWhere;

    const seats = await this.prisma.prospectInstitution.findMany({
      where,
      orderBy: [{ demoProvisionedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        contactEmail: true,
        contactName: true,
        institutionType: true,
        location: true,
        publicDataSource: true,
        demoUserId: true,
        demoReportJobId: true,
        demoProvisionedAt: true,
        demoExpiresAt: true,
        demoLastViewedAt: true,
        demoMagicLinkUrl: true,
        outreachStatus: true,
      },
    });

    // Annotate each seat with days-remaining and status for the UI
    return seats.map((seat: (typeof seats)[number]) => {
      const expiresAt = seat.demoExpiresAt?.getTime() || 0;
      const diffMs = expiresAt - now.getTime();
      const daysRemaining =
        expiresAt > 0 ? Math.max(0, Math.ceil(diffMs / 86400_000)) : null;
      const isExpired = expiresAt > 0 && diffMs <= 0;

      return {
        prospectId: seat.id,
        institutionName: seat.name,
        contactEmail: seat.contactEmail,
        contactName: seat.contactName,
        institutionType: seat.institutionType,
        location: seat.location,
        publicDataSource: seat.publicDataSource,
        demoUserId: seat.demoUserId,
        reportJobId: seat.demoReportJobId,
        provisionedAt: seat.demoProvisionedAt?.toISOString() || null,
        expiresAt: seat.demoExpiresAt?.toISOString() || null,
        lastViewedAt: seat.demoLastViewedAt?.toISOString() || null,
        magicLinkUrl: seat.demoMagicLinkUrl,
        outreachStatus: seat.outreachStatus,
        daysRemaining,
        status: isExpired ? 'expired' : 'active',
        hasBeenViewed: seat.demoLastViewedAt !== null,
      };
    });
  }

  // ─── Public-data fetchers ───────────────────────────────────

  private async fetchPublicData(
    prospect: {
      name: string;
      institutionType: string;
      publicDataSource: string | null;
      publicDataIdentifier: string | null;
    },
    preferredLanguageOverride?: 'en' | 'es',
  ): Promise<PublicDataPayload> {
    const source = (prospect.publicDataSource || '').toLowerCase();

    if (source === 'cossec' || prospect.institutionType === 'cooperativa') {
      const slug =
        prospect.publicDataIdentifier ||
        this.cossecDataPull.resolveSlugForName(prospect.name);
      if (!slug) {
        throw new BadRequestException(
          `No COSSEC snapshot for "${prospect.name}". Add a snapshot in cossec-2025q4.ts or set publicDataIdentifier.`,
        );
      }
      const data = await this.cossecDataPull.pullBySlug(slug);
      return {
        source: 'cossec_public_filings',
        institutionName: data.institutionName,
        institutionType: 'cooperativa',
        primaryRegulator: 'COSSEC',
        preferredLanguage: preferredLanguageOverride || 'es',
        totalAssetsMillions: data.totalAssets,
        asOfDate: data.asOfDate,
        asOfQuarter: data.asOfQuarter,
        disclosure: data.disclosure,
        items: data.items.map((item) => ({
          category: item.category,
          subcategory: item.subcategory,
          name: item.name,
          balance: item.balance,
          rate: item.rate,
          duration: item.duration,
          rateType: item.rateType,
        })),
      };
    }

    // Default: NCUA charter pull (US credit unions / CPA-served institutions)
    const charter = prospect.publicDataIdentifier;
    if (!charter) {
      throw new BadRequestException(
        `Prospect "${prospect.name}" needs a publicDataIdentifier (NCUA charter number) to provision a demo seat.`,
      );
    }
    const data = await this.ncuaDataPull.pullByCharterNumber(charter);
    return {
      source: 'ncua_5300',
      institutionName: data.institutionName,
      institutionType: 'credit_union',
      primaryRegulator: 'NCUA',
      preferredLanguage: preferredLanguageOverride || 'en',
      totalAssetsMillions: data.totalAssets,
      asOfDate: data.asOfDate,
      asOfQuarter: null,
      disclosure: `PRELIMINARY — Built from NCUA 5300 call report, ${new Date(
        data.asOfDate,
      )
        .toISOString()
        .slice(0, 10)}`,
      items: data.items.map((item) => ({
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate,
        duration: item.duration,
        rateType: item.rateType,
      })),
    };
  }

  // ─── Idempotent upserts ─────────────────────────────────────

  private async upsertDemoUser(input: { email: string; name: string }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      // Promote to demo_seat provider only if it was never claimed by a real user
      if (existing.provider === DEMO_USER_PROVIDER || !existing.passwordHash) {
        return existing;
      }
      // Real account already exists for this email — reuse it without changing provider
      this.logger.log({
        event: 'portal.demo_seat_reusing_real_user',
        userId: existing.id,
      });
      return existing;
    }

    return this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        provider: DEMO_USER_PROVIDER,
        emailVerified: true,
        role: 'OWNER',
      },
    });
  }

  private async upsertDemoWorkspace(userId: string, prospectName: string) {
    const existing = await this.prisma.workspace.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;

    return this.prisma.workspace.create({
      data: {
        name: `${prospectName} Workspace`,
        ownerId: userId,
      },
    });
  }

  /**
   * Returns true if the subscription was created or extended as a demo seat,
   * false if the user already had a protected (paid) subscription that we
   * intentionally left untouched.
   *
   * This is the paid-account safeguard: if an existing paying user's (or a
   * platform admin's) email ever appears as a prospect contact, we will never
   * overwrite their real subscription with tier='demo'.
   */
  private async upsertDemoSubscription(
    userId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const existing = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (existing && PROTECTED_TIERS.has(existing.tier)) {
      this.logger.log({
        event: 'portal.demo_seat_subscription_protected',
        userId,
        existingTier: existing.tier,
      });
      return false;
    }

    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        tier: 'demo',
        status: 'active',
        currentPeriodEnd: expiresAt,
      },
      update: {
        tier: 'demo',
        status: 'active',
        currentPeriodEnd: expiresAt,
      },
    });
    return true;
  }

  private async upsertInstitution(input: {
    workspaceId: string;
    name: string;
    type: string;
    totalAssets: number;
    reportingDate: string;
    primaryRegulator: 'COSSEC' | 'NCUA';
    preferredLanguage: 'en' | 'es';
  }) {
    const existing = await this.prisma.institution.findFirst({
      where: { workspaceId: input.workspaceId, name: input.name },
    });
    if (existing) {
      return this.prisma.institution.update({
        where: { id: existing.id },
        data: {
          totalAssets: input.totalAssets,
          reportingDate: new Date(input.reportingDate),
          primaryRegulator: input.primaryRegulator,
          preferredLanguage: input.preferredLanguage,
        },
      });
    }
    return this.almEnterprise.createInstitution(input);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private normalizeEmail(email?: string | null) {
    return (email || '').trim().toLowerCase();
  }

  private frontendUrl() {
    return (process.env.FRONTEND_URL || 'https://cerniq.io').replace(/\/$/, '');
  }
}
