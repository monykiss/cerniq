import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';
import { STRIPE_PRICE_IDS } from './stripe.config';

type BillingTier = 'one_time' | 'monthly' | 'annual' | 'partner';

const CHECKOUT_DARK_BRANDING: Stripe.Checkout.SessionCreateParams.BrandingSettings =
  {
    background_color: '#14171D',
    button_color: '#0085FF',
    border_style: 'rounded',
    font_family: 'inter',
  };

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      this.logger.log('Stripe client initialized');
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set — billing disabled');
    }
  }

  private requireStripe(): Stripe {
    if (!this.stripe)
      throw new BadRequestException('Billing is not configured');
    return this.stripe;
  }

  // ── Checkout ──────────────────────────────────────────

  async createCheckoutSession(params: {
    tier: string;
    customerEmail?: string;
    customerName?: string;
    institutionName?: string;
    leadId?: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const stripe = this.requireStripe();
    const priceId = STRIPE_PRICE_IDS[params.tier];
    if (!priceId) throw new BadRequestException(`Unknown tier: ${params.tier}`);

    const mode = params.tier === 'one_time' ? 'payment' : 'subscription';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      branding_settings: CHECKOUT_DARK_BRANDING,
      customer_email: params.customerEmail,
      metadata: {
        leadId: params.leadId || '',
        institutionName: params.institutionName || '',
        customerName: params.customerName || '',
        tier: params.tier,
      },
      success_url: this.resolveFrontendUrl(params.successUrl),
      cancel_url: this.resolveFrontendUrl(params.cancelUrl),
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      locale: 'auto',
    });

    this.logger.log({
      event: 'checkout.created',
      tier: params.tier,
      sessionId: session.id,
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  // ── Billing Portal ────────────────────────────────────

  async createBillingPortalSession(userId: string) {
    const stripe = this.requireStripe();
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!sub?.stripeCustomerId) {
      throw new BadRequestException('No billing account found');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    return { portalUrl: session.url };
  }

  // ── Webhook Handlers ──────────────────────────────────

  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    const stripe = this.requireStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException('Webhook secret not configured');
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  async handlePaymentComplete(session: Stripe.Checkout.Session) {
    const {
      customer_email: customerEmail,
      metadata,
      customer,
      amount_total,
    } = session;
    if (!customerEmail || !metadata) return;

    const tier = (metadata.tier || 'one_time') as BillingTier;
    const institutionName = metadata.institutionName?.trim() || '';

    // 1. Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: customerEmail },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: customerEmail,
          name: metadata.customerName || null,
          provider: 'magic_link',
          emailVerified: true,
        },
      });
      this.logger.log({
        event: 'user.auto_created',
        email: customerEmail,
        tier,
      });
    }

    // 1b. Demo → paid conversion detection
    //
    // If the user already has a tier='demo' subscription, this checkout is a
    // conversion from the portal demo seat, not a fresh signup. We preserve
    // every existing artifact (workspace, institution, completed demo report)
    // so the prospect doesn't lose their data — the subscription upsert below
    // will simply overwrite tier='demo' with the paid tier. The post-upsert
    // hook then closes the originating prospect, marks the lead as won, and
    // audit-logs the conversion so operators can track demo-seat ROI in Sentry /
    // the admin dashboard.
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { userId: user.id },
    });
    const wasDemoConversion = existingSubscription?.tier === 'demo';
    if (wasDemoConversion) {
      this.logger.log({
        event: 'portal.demo_seat_converting',
        userId: user.id,
        email: customerEmail,
        fromTier: 'demo',
        toTier: tier,
      });
    }

    // 2. Upsert subscription
    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tier,
        stripeCustomerId: (customer as string) || null,
        stripeSessionId: session.id,
        status: 'active',
        currentPeriodEnd:
          tier === 'one_time'
            ? null
            : this.addMonths(new Date(), tier === 'annual' ? 12 : 1),
      },
      update: {
        tier,
        status: 'active',
        stripeCustomerId: (customer as string) || null,
        stripeSessionId: session.id,
        currentPeriodEnd:
          tier === 'one_time'
            ? null
            : this.addMonths(new Date(), tier === 'annual' ? 12 : 1),
      },
    });

    // 2b. Post-upgrade hook for demo → paid conversions
    if (wasDemoConversion) {
      await this.closeConvertedDemoProspect(user.id, tier, amount_total ?? 0);
    }

    // 3. Update lead if linked
    if (metadata.leadId) {
      await this.prisma.lead
        .update({
          where: { id: metadata.leadId },
          data: {
            status: 'CLOSED_WON',
            revenueAmount: (amount_total || 0) / 100,
            dealType: tier,
            convertedAt: new Date(),
          },
        })
        .catch(() => {
          this.logger.warn({
            event: 'lead.update_failed',
            leadId: metadata.leadId,
          });
        });
    }

    // 4. Auto-create workspace if none exists
    const workspace = await this.ensurePrimaryWorkspace(
      user.id,
      institutionName || 'My Institution',
    );
    const institution = await this.ensureInstitutionForWorkspace({
      workspaceId: workspace.id,
      institutionName,
    });

    // 5. Create report job for one-time / first report
    await this.prisma.reportJob.create({
      data: {
        userId: user.id,
        institutionId: institution?.id || null,
        institutionName: institution?.name || institutionName || 'Pending',
        reportLang: institution?.preferredLanguage || 'es',
        status: 'AWAITING_DATA',
        triggeredBy: 'payment',
      },
    });

    // 6. Generate magic link and send welcome email
    const magicUrl = await this.generateMagicLink(user.id);
    await this.email.sendClientWelcome({
      email: customerEmail,
      name: metadata.customerName || '',
      tier,
      magicUrl,
      institutionName: metadata.institutionName || '',
    });

    // 7. Revenue alert to the operator
    await this.email.sendRevenueAlert({
      amount: (amount_total || 0) / 100,
      tier,
      customerEmail,
      institutionName: metadata.institutionName || '',
    });

    // 8. Schedule onboarding emails (B1 immediate, B2 at 30 min, B3 at 48h)
    await this.scheduleEmail(user.id, null, 'B1', new Date()); // immediate
    await this.scheduleEmail(
      user.id,
      null,
      'B2',
      new Date(Date.now() + 30 * 60 * 1000),
    ); // 30 min
    await this.scheduleEmail(
      user.id,
      null,
      'B3',
      new Date(Date.now() + 48 * 60 * 60 * 1000),
    ); // 48h

    this.logger.log({
      event: 'payment.complete',
      userId: user.id,
      tier,
      amount: (amount_total || 0) / 100,
    });
  }

  async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    await this.syncSubscriptionFromStripe(subscription, 'subscription.created');
  }

  async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    await this.syncSubscriptionFromStripe(subscription, 'subscription.updated');
  }

  async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'active',
        currentPeriodEnd: invoice.lines.data[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000)
          : sub.currentPeriodEnd,
      },
    });

    // Auto-create new report job for monthly/annual
    if (sub.tier === 'monthly' || sub.tier === 'annual') {
      const user = await this.prisma.user.findUnique({
        where: { id: sub.userId },
      });
      const latestJob = await this.prisma.reportJob.findFirst({
        where: { userId: sub.userId },
        orderBy: { createdAt: 'desc' },
      });
      const institution = latestJob?.institutionId
        ? await this.prisma.institution.findUnique({
            where: { id: latestJob.institutionId },
          })
        : await this.findLatestInstitutionForUser(sub.userId);

      await this.prisma.reportJob.create({
        data: {
          userId: sub.userId,
          institutionId: institution?.id || latestJob?.institutionId || null,
          institutionName:
            institution?.name || latestJob?.institutionName || 'Pending',
          reportLang:
            institution?.preferredLanguage || latestJob?.reportLang || 'es',
          status: 'AWAITING_DATA',
          triggeredBy: 'monthly_cron',
        },
      });

      if (user?.email) {
        await this.email.sendMonthlyReportCycle({
          email: user.email,
          name: user.name || '',
        });
      }
    }

    this.logger.log({ event: 'invoice.paid', customerId });
  }

  async handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'past_due' },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: sub.userId },
    });
    if (user?.email) {
      await this.email.sendPaymentFailed({
        email: user.email,
        name: user.name || '',
      });
    }

    // Alert the operator
    await this.email.sendRevenueAlert({
      amount: 0,
      tier: sub.tier,
      customerEmail: user?.email || 'unknown',
      institutionName: `PAYMENT FAILED — ${user?.email}`,
    });

    this.logger.warn({
      event: 'payment.failed',
      userId: sub.userId,
      customerId,
    });
  }

  async handleSubscriptionCancelled(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: sub.userId },
    });
    if (user?.email) {
      await this.email.sendCancellationEmail({
        email: user.email,
        name: user.name || '',
      });
    }

    // Schedule win-back email (90 days)
    if (user) {
      await this.scheduleEmail(
        user.id,
        null,
        'D5',
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      );
    }

    this.logger.log({
      event: 'subscription.cancelled',
      userId: sub.userId,
      customerId,
    });
  }

  private async ensurePrimaryWorkspace(userId: string, fallbackName: string) {
    const existingWorkspace = await this.prisma.workspace.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });

    if (existingWorkspace) {
      return existingWorkspace;
    }

    const createdWorkspace = await this.prisma.workspace.create({
      data: {
        name: fallbackName || 'My Institution',
        ownerId: userId,
      },
    });

    this.logger.log({
      event: 'workspace.auto_created',
      userId,
      institutionName: fallbackName || 'My Institution',
    });

    return createdWorkspace;
  }

  private async ensureInstitutionForWorkspace(input: {
    workspaceId: string;
    institutionName?: string;
  }) {
    const institutionName = input.institutionName?.trim();
    if (!institutionName) {
      return null;
    }

    const existingInstitution = await this.prisma.institution.findFirst({
      where: {
        workspaceId: input.workspaceId,
        name: institutionName,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existingInstitution) {
      return existingInstitution;
    }

    return this.prisma.institution.create({
      data: {
        workspaceId: input.workspaceId,
        name: institutionName,
        type: 'cooperativa',
        totalAssets: 0,
        currency: 'USD',
        reportingDate: new Date(),
        primaryRegulator: 'COSSEC',
        preferredLanguage: 'es',
      },
    });
  }

  private async findLatestInstitutionForUser(userId: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (workspaces.length === 0) {
      return null;
    }

    return this.prisma.institution.findFirst({
      where: {
        workspaceId: {
          in: workspaces.map((workspace: { id: string }) => workspace.id),
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async handleDispute(dispute: Stripe.Dispute) {
    await this.email.sendDisputeAlert({
      chargeId: dispute.charge as string,
      amount: dispute.amount / 100,
      reason: dispute.reason,
    });
    this.logger.error({
      event: 'dispute.created',
      chargeId: dispute.charge,
      reason: dispute.reason,
    });
  }

  // ── Magic Links ───────────────────────────────────────

  async generateMagicLink(userId: string, expiryHours = 24): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    await this.prisma.magicLink.create({
      data: { userId, token, expiresAt },
    });

    return `${process.env.FRONTEND_URL}/auth/magic?token=${token}`;
  }

  async verifyMagicLink(token: string) {
    const links = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        id,
        user_id AS "userId",
        expires_at AS "expiresAt",
        used_at AS "usedAt"
      FROM magic_links
      WHERE token = ${token}
      LIMIT 1
    `)) as Array<{
      id: string;
      userId: string;
      expiresAt: Date;
      usedAt: Date | null;
    }>;
    const link = links[0] || null;

    if (!link || link.usedAt || new Date() > new Date(link.expiresAt)) {
      return null;
    }

    await this.prisma.magicLink.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: link.userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
    if (!user) {
      return null;
    }

    // Update lastLoginAt timestamp for magic link login
    await this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {
        /* best-effort */
      });

    return user;
  }

  // ── Email Sequence Scheduling ─────────────────────────

  async scheduleEmail(
    userId: string | null,
    leadId: string | null,
    sequenceKey: string,
    scheduledAt: Date,
  ) {
    // Check for duplicates
    const existing = await this.prisma.emailSequence.findFirst({
      where: { userId, leadId, sequenceKey, cancelled: false },
    });
    if (existing) return;

    await this.prisma.emailSequence.create({
      data: { userId, leadId, sequenceKey, scheduledAt },
    });
  }

  async cancelSequences(userId?: string, leadId?: string) {
    const where: any = { cancelled: false, sentAt: null };
    if (userId) where.userId = userId;
    if (leadId) where.leadId = leadId;

    await this.prisma.emailSequence.updateMany({
      where,
      data: { cancelled: true },
    });
  }

  async requestMagicLink(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const magicUrl = await this.generateMagicLink(user.id);
    await this.email.sendMagicLinkEmail({
      email,
      magicUrl,
      name: user.name || '',
    });
  }

  async getSubscription(userId: string) {
    return this.prisma.subscription.findUnique({
      where: { userId },
      select: {
        tier: true,
        status: true,
        currentPeriodEnd: true,
        reportsUsed: true,
        createdAt: true,
      },
    });
  }

  // ── Demo → Paid Conversion Helper ────────────────────
  //
  // When a prospect who was provisioned via the portal demo-seat flow runs
  // checkout and pays, we want every artifact they already have (workspace,
  // institution, completed demo report, portal sessions) to survive the
  // upgrade. The subscription upsert in handlePaymentComplete already flips
  // their tier from 'demo' to the purchased tier — this helper handles the
  // other side-effects: closing the prospect record, logging the conversion
  // as a structured event so admin dashboards + Sentry can surface it, and
  // resetting the demo expiry fields to null so the sweeper ignores them.
  //
  // Idempotent: if no prospect is linked to this user, it's a no-op.

  private async closeConvertedDemoProspect(
    userId: string,
    toTier: BillingTier,
    amountTotal: number,
  ): Promise<void> {
    try {
      const prospect = await this.prisma.prospectInstitution.findFirst({
        where: { demoUserId: userId },
        select: {
          id: true,
          name: true,
          intelligenceAccountId: true,
        },
      });
      if (!prospect) {
        this.logger.log({
          event: 'portal.demo_seat_converted_no_prospect',
          userId,
        });
        return;
      }

      const amountUsd = amountTotal / 100;
      await this.prisma.prospectInstitution.update({
        where: { id: prospect.id },
        data: {
          outreachStatus: 'closed_won',
          // Keep demoUserId + demoReportJobId for historical attribution,
          // but clear the expiry so the sweeper stops scanning this row.
          demoExpiresAt: null,
          // Persist attribution fields so DemoSeatAnalyticsService can
          // compute funnel metrics + revenue without re-joining Lead.
          demoConvertedAt: new Date(),
          demoConvertedAmountUsd: amountUsd,
          demoConvertedToTier: toTier,
        },
      });

      this.logger.log({
        event: 'portal.demo_seat_converted',
        userId,
        prospectId: prospect.id,
        institutionName: prospect.name,
        toTier,
        amountUsd: amountTotal / 100,
      });
    } catch (err: any) {
      // Never throw from the billing webhook path — log and continue so the
      // subscription upgrade still succeeds even if prospect attribution fails.
      this.logger.error({
        event: 'portal.demo_seat_conversion_hook_failed',
        userId,
        error: err?.message || 'unknown',
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  private resolveFrontendUrl(pathOrUrl: string): string {
    const baseUrl = (process.env.FRONTEND_URL || 'https://cerniq.io')
      .trim()
      .replace(/\/+$/, '');
    const trimmed = (pathOrUrl || '').trim();

    if (!trimmed) {
      return baseUrl;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      // Prevent open redirect — only allow URLs under cerniq.io / cerniqtech.com / FRONTEND_URL
      try {
        const allowed = new URL(baseUrl);
        const provided = new URL(trimmed);
        const isSameHost = provided.host === allowed.host;
        const isCerniqDomain =
          /^([a-z0-9-]+\.)*(cerniq\.io|cerniqtech\.com)$/i.test(provided.host);
        const isLocalDev = /^localhost(:\d+)?$/.test(provided.host);
        if (isSameHost || isCerniqDomain || isLocalDev) {
          return trimmed;
        }
        this.logger.warn({
          event: 'checkout.url_rejected',
          provided: trimmed,
          allowed: allowed.host,
        });
      } catch {
        // Invalid URL — fall through to baseUrl
      }
      return baseUrl;
    }

    return `${baseUrl}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  }

  private resolveSubscriptionStatus(
    status: Stripe.Subscription.Status,
  ): 'active' | 'past_due' | 'cancelled' | 'grace_period' {
    switch (status) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
      case 'unpaid':
      case 'incomplete':
        return 'past_due';
      case 'paused':
        return 'grace_period';
      case 'canceled':
      case 'incomplete_expired':
        return 'cancelled';
      default:
        return 'active';
    }
  }

  private resolveTierFromPriceId(
    subscription: Stripe.Subscription,
  ): BillingTier | null {
    const priceId = subscription.items?.data?.[0]?.price?.id;
    if (!priceId) return null;
    const match = Object.entries(STRIPE_PRICE_IDS).find(
      ([, configuredPriceId]) => configuredPriceId === priceId,
    );
    if (!match) return null;
    return match[0] as BillingTier;
  }

  private async syncSubscriptionFromStripe(
    subscription: Stripe.Subscription,
    eventName: string,
  ) {
    const customerId = subscription.customer as string;
    const sub = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    const status = this.resolveSubscriptionStatus(subscription.status);
    const nextTier = this.resolveTierFromPriceId(subscription);
    const periodEndUnix = (subscription as any).current_period_end as
      | number
      | undefined;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        stripeSubscriptionId: subscription.id,
        status,
        ...(nextTier ? { tier: nextTier } : {}),
        ...(periodEndUnix
          ? { currentPeriodEnd: new Date(periodEndUnix * 1000) }
          : {}),
        ...(status === 'cancelled'
          ? { cancelledAt: new Date() }
          : { cancelledAt: null }),
      },
    });

    this.logger.log({
      event: eventName,
      customerId,
      subscriptionId: subscription.id,
      status,
      tier: nextTier || sub.tier,
    });
  }
}
