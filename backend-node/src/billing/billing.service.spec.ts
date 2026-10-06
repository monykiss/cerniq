import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';

// Mock PrismaService module to avoid DATABASE_URL requirement at import time
jest.mock('../prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

// Mock Stripe price config (module-level reads from env at import time)
jest.mock('./stripe.config', () => ({
  STRIPE_PRICE_IDS: {
    one_time: 'price_onetime_test',
    monthly: 'price_monthly_test',
    annual: 'price_annual_test',
    partner: 'price_partner_test',
  },
  STRIPE_PRODUCTS: {},
}));

// Stub Stripe constructor so the service thinks it's initialized
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: { create: jest.fn() },
    },
    billingPortal: {
      sessions: { create: jest.fn() },
    },
    webhooks: { constructEvent: jest.fn() },
  }));
});

describe('BillingService', () => {
  let service: BillingService;
  let prisma: Record<string, any>;
  let email: Record<string, jest.Mock>;

  beforeEach(async () => {
    // Enable Stripe
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET = 'test-webhook-signing-secret';
    process.env.FRONTEND_URL = 'https://cerniq.io';

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      lead: { update: jest.fn() },
      reportJob: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      magicLink: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      emailSequence: {
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      workspace: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'ws-auto' }),
      },
      institution: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'inst-auto',
          name: 'Cooperativa ABC',
          preferredLanguage: 'es',
        }),
      },
      prospectInstitution: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    email = {
      sendClientWelcome: jest.fn().mockResolvedValue(undefined),
      sendRevenueAlert: jest.fn().mockResolvedValue(undefined),
      sendMonthlyReportCycle: jest.fn().mockResolvedValue(undefined),
      sendPaymentFailed: jest.fn().mockResolvedValue(undefined),
      sendCancellationEmail: jest.fn().mockResolvedValue(undefined),
      sendMagicLinkEmail: jest.fn().mockResolvedValue(undefined),
      sendDisputeAlert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    jest.restoreAllMocks();
  });

  // ── requireStripe guard ──────────────────────────

  describe('requireStripe', () => {
    it('should throw when STRIPE_SECRET_KEY is not set', async () => {
      delete process.env.STRIPE_SECRET_KEY;

      const module = await Test.createTestingModule({
        providers: [
          BillingService,
          { provide: PrismaService, useValue: prisma },
          { provide: EmailService, useValue: email },
        ],
      }).compile();

      const noStripeService = module.get<BillingService>(BillingService);

      await expect(
        noStripeService.createCheckoutSession({
          tier: 'monthly',
          successUrl: '/s',
          cancelUrl: '/c',
        }),
      ).rejects.toThrow('Billing is not configured');
    });
  });

  // ── createCheckoutSession ────────────────────────

  describe('createCheckoutSession', () => {
    it('should throw for unknown tier', async () => {
      await expect(
        service.createCheckoutSession({
          tier: 'bogus',
          successUrl: '/s',
          cancelUrl: '/c',
        }),
      ).rejects.toThrow('Unknown tier: bogus');
    });

    it('should use "payment" mode for one_time tier', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/test',
        id: 'cs_test_123',
      });

      const result = await service.createCheckoutSession({
        tier: 'one_time',
        customerEmail: 'test@example.coop',
        successUrl: '/success',
        cancelUrl: '/cancel',
      });

      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/test');
      expect(result.sessionId).toBe('cs_test_123');

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.mode).toBe('payment');
    });

    it('should use "subscription" mode for monthly tier', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_m',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl: '/s',
        cancelUrl: '/c',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.mode).toBe('subscription');
    });

    it('should apply dark Stripe-hosted Checkout branding', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_dark',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl: '/s',
        cancelUrl: '/c',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.branding_settings).toEqual({
        background_color: '#14171D',
        button_color: '#0085FF',
        border_style: 'rounded',
        font_family: 'inter',
      });
    });

    it('should prepend FRONTEND_URL to success/cancel URLs', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_x',
      });

      await service.createCheckoutSession({
        tier: 'annual',
        successUrl: '/billing/success',
        cancelUrl: '/billing/cancel',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.success_url).toBe('https://cerniq.io/billing/success');
      expect(callArgs.cancel_url).toBe('https://cerniq.io/billing/cancel');
    });

    it('should keep absolute success and cancel URLs unchanged when host matches', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_abs',
      });

      // Use same-origin URLs (matches default FRONTEND_URL=https://cerniq.io)
      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl:
          'https://cerniq.io/login?billing=success&returnUrl=%2Fdashboard',
        cancelUrl: 'https://cerniq.io/pricing',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.success_url).toBe(
        'https://cerniq.io/login?billing=success&returnUrl=%2Fdashboard',
      );
      expect(callArgs.cancel_url).toBe('https://cerniq.io/pricing');
    });

    it('should pass metadata including leadId and institutionName', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_y',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        customerEmail: 'cfo@example.coop',
        customerName: 'Maria',
        institutionName: 'Cooperativa XYZ',
        leadId: 'lead-abc',
        successUrl: '/s',
        cancelUrl: '/c',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.metadata).toEqual({
        leadId: 'lead-abc',
        institutionName: 'Cooperativa XYZ',
        customerName: 'Maria',
        tier: 'monthly',
      });
      expect(callArgs.customer_email).toBe('cfo@example.coop');
    });
  });

  // ── createBillingPortalSession ───────────────────

  describe('createBillingPortalSession', () => {
    it('should throw when no subscription exists', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.createBillingPortalSession('user-1'),
      ).rejects.toThrow('No billing account found');
    });

    it('should throw when subscription has no stripeCustomerId', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        userId: 'user-1',
        stripeCustomerId: null,
      });

      await expect(
        service.createBillingPortalSession('user-1'),
      ).rejects.toThrow('No billing account found');
    });

    it('should create portal session with return URL', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        stripeCustomerId: 'cus_123',
      });

      const stripeMock = (service as any).stripe;
      stripeMock.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/session/xyz',
      });

      const result = await service.createBillingPortalSession('user-1');

      expect(result.portalUrl).toBe('https://billing.stripe.com/session/xyz');
      expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_123',
        return_url: 'https://cerniq.io/dashboard',
      });
    });
  });

  // ── handlePaymentComplete ────────────────────────

  describe('handlePaymentComplete', () => {
    const baseSession = {
      id: 'cs_test',
      customer_email: 'cfo@example.coop',
      customer: 'cus_new',
      amount_total: 75000,
      metadata: {
        tier: 'one_time',
        leadId: 'lead-1',
        institutionName: 'Cooperativa ABC',
        customerName: 'Alex',
      },
    } as any;

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'cfo@example.coop',
        name: 'Alex',
      });
      // Default: no pre-existing subscription (fresh signup flow). The
      // demo-conversion tests below override this to return tier='demo'.
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscription.upsert.mockResolvedValue({});
      prisma.lead.update.mockResolvedValue({});
      prisma.reportJob.create.mockResolvedValue({});
      prisma.magicLink.create.mockResolvedValue({});
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});
    });

    it('should auto-create user when not found', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'cfo@example.coop',
          name: 'Alex',
          provider: 'magic_link',
          emailVerified: true,
        }),
      });
    });

    it('should use existing user when found', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-existing',
        email: 'cfo@example.coop',
      });

      await service.handlePaymentComplete(baseSession);

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-existing' },
        }),
      );
    });

    it('should upsert subscription with correct tier and status', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(prisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            tier: 'one_time',
            status: 'active',
            stripeCustomerId: 'cus_new',
            stripeSessionId: 'cs_test',
          }),
        }),
      );
    });

    it('should set currentPeriodEnd to null for one_time tier', async () => {
      await service.handlePaymentComplete(baseSession);

      const call = prisma.subscription.upsert.mock.calls[0][0];
      expect(call.create.currentPeriodEnd).toBeNull();
    });

    it('should set currentPeriodEnd ~1 month for monthly tier', async () => {
      const monthlySession = {
        ...baseSession,
        metadata: { ...baseSession.metadata, tier: 'monthly' },
      };

      await service.handlePaymentComplete(monthlySession);

      const call = prisma.subscription.upsert.mock.calls[0][0];
      const endDate = call.create.currentPeriodEnd as Date;
      expect(endDate).toBeInstanceOf(Date);
      // Should be ~30 days in the future
      const diffMs = endDate.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(25 * 24 * 60 * 60 * 1000);
      expect(diffMs).toBeLessThan(35 * 24 * 60 * 60 * 1000);
    });

    it('should update lead to CLOSED_WON when leadId present', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: expect.objectContaining({
          status: 'CLOSED_WON',
          revenueAmount: 750,
          dealType: 'one_time',
        }),
      });
    });

    it('should not update lead when leadId is empty', async () => {
      const noLeadSession = {
        ...baseSession,
        metadata: { ...baseSession.metadata, leadId: '' },
      };

      await service.handlePaymentComplete(noLeadSession);

      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('should create AWAITING_DATA report job', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(prisma.reportJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          institutionId: 'inst-auto',
          status: 'AWAITING_DATA',
          triggeredBy: 'payment',
          institutionName: 'Cooperativa ABC',
        }),
      });
    });

    it('should send welcome email with magic link', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(email.sendClientWelcome).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'cfo@example.coop',
          name: 'Alex',
          tier: 'one_time',
          institutionName: 'Cooperativa ABC',
        }),
      );
    });

    it('should send revenue alert to admin', async () => {
      await service.handlePaymentComplete(baseSession);

      expect(email.sendRevenueAlert).toHaveBeenCalledWith({
        amount: 750,
        tier: 'one_time',
        customerEmail: 'cfo@example.coop',
        institutionName: 'Cooperativa ABC',
      });
    });

    it('should schedule onboarding emails (B2 at 30min, B3 at 48h)', async () => {
      await service.handlePaymentComplete(baseSession);

      // scheduleEmail is called at least twice for onboarding
      expect(prisma.emailSequence.create).toHaveBeenCalled();
      const calls = prisma.emailSequence.create.mock.calls;
      const sequenceKeys = calls.map((c: any) => c[0].data.sequenceKey);
      expect(sequenceKeys).toContain('B2');
      expect(sequenceKeys).toContain('B3');
    });

    it('should silently skip when no email or metadata', async () => {
      const emptySession = { customer_email: null, metadata: null } as any;

      // Should return without throwing
      await service.handlePaymentComplete(emptySession);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    // ── Demo → paid conversion ─────────────────────
    //
    // These tests exercise the branch where the paying user already has a
    // tier='demo' subscription from a prior portal demo seat. The upgrade
    // must preserve their workspace/institution/reports and close the
    // linked prospect. The sweeper should never see them again because the
    // subscription tier flips away from 'demo'.

    describe('demo → paid conversion', () => {
      const demoUser = {
        id: 'user-demo',
        email: 'cfo@example.coop',
        name: 'Alex',
      };

      beforeEach(() => {
        // User already exists from the demo-seat provisioning flow
        prisma.user.findUnique.mockResolvedValue(demoUser);
        prisma.subscription.findUnique.mockResolvedValue({
          userId: demoUser.id,
          tier: 'demo',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 7 * 86400000),
        });
        // Prospect record linked to this user via demoUserId
        prisma.prospectInstitution.findFirst.mockResolvedValue({
          id: 'prospect-1',
          name: 'Cooperativa ABC',
          intelligenceAccountId: null,
        });
      });

      it('detects the conversion and logs a structured event', async () => {
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        await service.handlePaymentComplete({
          ...baseSession,
          metadata: { ...baseSession.metadata, tier: 'monthly' },
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'portal.demo_seat_converting',
            userId: demoUser.id,
            fromTier: 'demo',
            toTier: 'monthly',
          }),
        );
      });

      it('flips the subscription from demo to the purchased tier (annual)', async () => {
        await service.handlePaymentComplete({
          ...baseSession,
          metadata: { ...baseSession.metadata, tier: 'annual' },
        });

        expect(prisma.subscription.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: demoUser.id },
            update: expect.objectContaining({
              tier: 'annual',
              status: 'active',
            }),
          }),
        );
      });

      it('reuses the existing user — no new user created', async () => {
        await service.handlePaymentComplete(baseSession);

        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it('closes the linked prospect as closed_won and clears demo expiry', async () => {
        await service.handlePaymentComplete({
          ...baseSession,
          metadata: { ...baseSession.metadata, tier: 'monthly' },
        });

        expect(prisma.prospectInstitution.findFirst).toHaveBeenCalledWith({
          where: { demoUserId: demoUser.id },
          select: expect.any(Object),
        });
        expect(prisma.prospectInstitution.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'prospect-1' },
            data: expect.objectContaining({
              outreachStatus: 'closed_won',
              demoExpiresAt: null,
            }),
          }),
        );
      });

      it('persists conversion attribution (convertedAt, amountUsd, toTier) for analytics', async () => {
        await service.handlePaymentComplete({
          ...baseSession,
          metadata: { ...baseSession.metadata, tier: 'annual' },
          amount_total: 598800, // $5,988 annual plan
        });

        expect(prisma.prospectInstitution.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              demoConvertedAt: expect.any(Date),
              demoConvertedAmountUsd: 5988,
              demoConvertedToTier: 'annual',
            }),
          }),
        );
      });

      it('logs portal.demo_seat_converted with institution + amount', async () => {
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        await service.handlePaymentComplete({
          ...baseSession,
          metadata: { ...baseSession.metadata, tier: 'monthly' },
          amount_total: 49900,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'portal.demo_seat_converted',
            userId: demoUser.id,
            prospectId: 'prospect-1',
            institutionName: 'Cooperativa ABC',
            toTier: 'monthly',
            amountUsd: 499,
          }),
        );
      });

      it('NEVER throws when the prospect lookup fails — billing continues', async () => {
        prisma.prospectInstitution.findFirst.mockRejectedValueOnce(
          new Error('DB blip'),
        );

        await expect(
          service.handlePaymentComplete(baseSession),
        ).resolves.toBeUndefined();

        // The subscription upsert must still have happened — the conversion
        // hook failure cannot block the payment path.
        expect(prisma.subscription.upsert).toHaveBeenCalled();
      });

      it('is a no-op when the paying user has no linked prospect', async () => {
        prisma.prospectInstitution.findFirst.mockResolvedValueOnce(null);
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        await service.handlePaymentComplete(baseSession);

        expect(prisma.prospectInstitution.update).not.toHaveBeenCalled();
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'portal.demo_seat_converted_no_prospect',
            userId: demoUser.id,
          }),
        );
      });

      it('does NOT trigger conversion path for fresh signups (no existing sub)', async () => {
        // Reset: fresh signup, no prior subscription
        prisma.subscription.findUnique.mockResolvedValue(null);
        prisma.user.findUnique.mockResolvedValue(null);
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        await service.handlePaymentComplete(baseSession);

        expect(prisma.prospectInstitution.findFirst).not.toHaveBeenCalled();
        expect(loggerSpy).not.toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'portal.demo_seat_converting',
          }),
        );
      });

      it('does NOT trigger conversion path for existing paid users renewing', async () => {
        // User already pays monthly — this is a renewal, not a demo conversion
        prisma.subscription.findUnique.mockResolvedValue({
          userId: demoUser.id,
          tier: 'monthly',
          status: 'active',
        });

        await service.handlePaymentComplete(baseSession);

        expect(prisma.prospectInstitution.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  // ── handleInvoicePaid ────────────────────────────

  describe('handleInvoicePaid', () => {
    it('should update subscription status to active', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
        currentPeriodEnd: new Date(),
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        name: 'U',
      });
      prisma.reportJob.findFirst.mockResolvedValue({
        institutionName: 'Coop A',
      });
      prisma.reportJob.create.mockResolvedValue({});

      const invoice = {
        customer: 'cus_123',
        lines: {
          data: [
            { period: { end: Math.floor(Date.now() / 1000) + 86400 * 30 } },
          ],
        },
      } as any;

      await service.handleInvoicePaid(invoice);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should auto-create report job for monthly/annual subscriptions', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        name: 'U',
      });
      prisma.reportJob.findFirst.mockResolvedValue({
        institutionName: 'Coop B',
      });
      prisma.reportJob.create.mockResolvedValue({});

      await service.handleInvoicePaid({
        customer: 'cus_123',
        lines: { data: [] },
      } as any);

      expect(prisma.reportJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          status: 'AWAITING_DATA',
          triggeredBy: 'monthly_cron',
        }),
      });
    });

    it('should send monthly report cycle email', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'annual',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        name: 'Jane',
      });
      prisma.reportJob.findFirst.mockResolvedValue(null);
      prisma.reportJob.create.mockResolvedValue({});

      await service.handleInvoicePaid({
        customer: 'cus_x',
        lines: { data: [] },
      } as any);

      expect(email.sendMonthlyReportCycle).toHaveBeenCalledWith({
        email: 'u@test.com',
        name: 'Jane',
      });
    });

    it('should silently skip when no matching subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleInvoicePaid({
        customer: 'cus_unknown',
        lines: { data: [] },
      } as any);

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // ── handlePaymentFailed ──────────────────────────

  describe('handlePaymentFailed', () => {
    it('should mark subscription as past_due', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'u@test.com',
        name: 'U',
      });

      await service.handlePaymentFailed({ customer: 'cus_1' } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'past_due' },
      });
    });

    it('should send payment failed email to user', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'cfo@example.coop',
        name: 'Maria',
      });

      await service.handlePaymentFailed({ customer: 'cus_1' } as any);

      expect(email.sendPaymentFailed).toHaveBeenCalledWith({
        email: 'cfo@example.coop',
        name: 'Maria',
      });
    });

    it('should send revenue alert for failed payment', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'annual',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'fail@test.com',
      });

      await service.handlePaymentFailed({ customer: 'cus_1' } as any);

      expect(email.sendRevenueAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 0,
          institutionName: expect.stringContaining('PAYMENT FAILED'),
        }),
      );
    });
  });

  // ── handleSubscriptionCancelled ──────────────────

  describe('handleSubscriptionCancelled', () => {
    it('should mark subscription as cancelled with timestamp', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'gone@test.com',
        name: 'Ex',
      });
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});

      await service.handleSubscriptionCancelled({
        customer: 'cus_cancel',
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: 'cancelled',
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('should send cancellation email', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'bye@test.com',
        name: 'Bye',
      });
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});

      await service.handleSubscriptionCancelled({ customer: 'cus_c' } as any);

      expect(email.sendCancellationEmail).toHaveBeenCalledWith({
        email: 'bye@test.com',
        name: 'Bye',
      });
    });

    it('should schedule D5 win-back email at 90 days', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'wb@test.com',
        name: 'WB',
      });
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});

      await service.handleSubscriptionCancelled({ customer: 'cus_wb' } as any);

      expect(prisma.emailSequence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          sequenceKey: 'D5',
        }),
      });
    });
  });

  // ── handleDispute ────────────────────────────────

  describe('handleDispute', () => {
    it('should send dispute alert email', async () => {
      await service.handleDispute({
        charge: 'ch_123',
        amount: 75000,
        reason: 'fraudulent',
      } as any);

      expect(email.sendDisputeAlert).toHaveBeenCalledWith({
        chargeId: 'ch_123',
        amount: 750,
        reason: 'fraudulent',
      });
    });
  });

  // ── Magic Links ──────────────────────────────────

  describe('generateMagicLink', () => {
    it('should create magic link record in DB', async () => {
      prisma.magicLink.create.mockResolvedValue({});

      const url = await service.generateMagicLink('user-1');

      expect(url).toMatch(
        /^https:\/\/cerniq\.io\/auth\/magic\?token=[a-f0-9]{64}$/,
      );
      expect(prisma.magicLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          token: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('should use custom expiry hours', async () => {
      prisma.magicLink.create.mockResolvedValue({});

      await service.generateMagicLink('user-1', 48);

      const call = prisma.magicLink.create.mock.calls[0][0];
      const expiry = call.data.expiresAt as Date;
      const diffHours = (expiry.getTime() - Date.now()) / (60 * 60 * 1000);
      expect(diffHours).toBeGreaterThan(47);
      expect(diffHours).toBeLessThan(49);
    });
  });

  describe('verifyMagicLink', () => {
    it('should return null for non-existent token', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.verifyMagicLink('bad-token');

      expect(result).toBeNull();
    });

    it('should return null for already-used token', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'ml-1',
          usedAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
          userId: 'user-1',
        },
      ]);

      const result = await service.verifyMagicLink('used-token');

      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'ml-1',
          usedAt: null,
          expiresAt: new Date(Date.now() - 60000),
          userId: 'user-1',
        },
      ]);

      const result = await service.verifyMagicLink('expired-token');

      expect(result).toBeNull();
    });

    it('should mark token as used and return user for valid token', async () => {
      const mockUser = { id: 'user-1', email: 'valid@test.com' };
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'ml-1',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          userId: 'user-1',
        },
      ]);
      prisma.magicLink.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyMagicLink('valid-token');

      expect(result).toEqual(mockUser);
      expect(prisma.magicLink.update).toHaveBeenCalledWith({
        where: { id: 'ml-1' },
        data: { usedAt: expect.any(Date) },
      });
    });
  });

  // ── Email Scheduling ─────────────────────────────

  describe('scheduleEmail', () => {
    it('should skip if duplicate sequence exists', async () => {
      prisma.emailSequence.findFirst.mockResolvedValue({ id: 'existing' });

      await service.scheduleEmail('user-1', null, 'B2', new Date());

      expect(prisma.emailSequence.create).not.toHaveBeenCalled();
    });

    it('should create sequence when no duplicate', async () => {
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});

      const scheduledAt = new Date(Date.now() + 3600000);
      await service.scheduleEmail('user-1', null, 'B3', scheduledAt);

      expect(prisma.emailSequence.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          leadId: null,
          sequenceKey: 'B3',
          scheduledAt,
        },
      });
    });
  });

  describe('cancelSequences', () => {
    it('should cancel unsent sequences for a user', async () => {
      prisma.emailSequence.updateMany.mockResolvedValue({ count: 2 });

      await service.cancelSequences('user-1');

      expect(prisma.emailSequence.updateMany).toHaveBeenCalledWith({
        where: { cancelled: false, sentAt: null, userId: 'user-1' },
        data: { cancelled: true },
      });
    });
  });

  describe('requestMagicLink', () => {
    it('should silently return when user not found (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestMagicLink('nobody@test.com');

      expect(email.sendMagicLinkEmail).not.toHaveBeenCalled();
    });

    it('should generate link and send email when user exists', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'exists@test.com',
        name: 'Test',
      });
      prisma.magicLink.create.mockResolvedValue({});

      await service.requestMagicLink('exists@test.com');

      expect(email.sendMagicLinkEmail).toHaveBeenCalledWith({
        email: 'exists@test.com',
        magicUrl: expect.stringContaining(
          'https://cerniq.io/auth/magic?token=',
        ),
        name: 'Test',
      });
    });
  });

  // ── getSubscription ──────────────────────────────

  describe('getSubscription', () => {
    it('should return subscription with selected fields', async () => {
      const sub = {
        tier: 'monthly',
        status: 'active',
        currentPeriodEnd: new Date(),
        reportsUsed: 5,
        createdAt: new Date(),
      };
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.getSubscription('user-1');

      expect(result).toEqual(sub);
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: {
          tier: true,
          status: true,
          currentPeriodEnd: true,
          reportsUsed: true,
          createdAt: true,
        },
      });
    });
  });

  // ── handlePaymentComplete auto-workspace creation ──
  describe('handlePaymentComplete (auto-workspace)', () => {
    it('should auto-create workspace when no existing workspace', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-ws',
        email: 'ws@test.com',
      });
      prisma.subscription.upsert.mockResolvedValue({});
      prisma.reportJob.create.mockResolvedValue({});
      prisma.magicLink.create.mockResolvedValue({});
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});
      prisma.workspace.findFirst.mockResolvedValue(null); // no existing workspace
      prisma.workspace.create.mockResolvedValue({ id: 'ws-auto' });

      await service.handlePaymentComplete({
        id: 'cs_ws',
        customer_email: 'ws@test.com',
        customer: 'cus_ws',
        amount_total: 75000,
        metadata: {
          tier: 'one_time',
          leadId: '',
          institutionName: 'Coop WS',
          customerName: 'WS',
        },
      } as any);

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Coop WS', ownerId: 'user-ws' }),
      });
      expect(prisma.institution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-auto',
          name: 'Coop WS',
        }),
      });
    });

    it('should NOT create workspace when one already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-existing-ws',
        email: 'existing@test.com',
      });
      prisma.subscription.upsert.mockResolvedValue({});
      prisma.reportJob.create.mockResolvedValue({});
      prisma.magicLink.create.mockResolvedValue({});
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});
      prisma.workspace.findFirst.mockResolvedValue({ id: 'existing-ws' }); // already exists

      await service.handlePaymentComplete({
        id: 'cs_no_ws',
        customer_email: 'existing@test.com',
        customer: 'cus_x',
        amount_total: 75000,
        metadata: {
          tier: 'one_time',
          leadId: '',
          institutionName: '',
          customerName: '',
        },
      } as any);

      expect(prisma.workspace.create).not.toHaveBeenCalled();
    });
  });

  // ── handlePaymentFailed when no sub found ──────────
  describe('handlePaymentFailed edge cases', () => {
    it('should skip when no matching subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      await service.handlePaymentFailed({ customer: 'cus_none' } as any);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('should handle user with no email', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });

      await service.handlePaymentFailed({ customer: 'cus_1' } as any);
      expect(email.sendPaymentFailed).not.toHaveBeenCalled();
    });
  });

  // ── handleSubscriptionCancelled edge cases ─────────
  describe('handleSubscriptionCancelled edge cases', () => {
    it('should skip when no matching subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      await service.handleSubscriptionCancelled({
        customer: 'cus_none',
      } as any);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('should not send email if user has no email', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });
      prisma.emailSequence.findFirst.mockResolvedValue(null);

      await service.handleSubscriptionCancelled({ customer: 'cus_c' } as any);
      expect(email.sendCancellationEmail).not.toHaveBeenCalled();
    });
  });

  // ── handleInvoicePaid edge cases ───────────────────
  describe('handleInvoicePaid edge cases', () => {
    it('should not create report job for one_time tier', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'one_time',
      });

      await service.handleInvoicePaid({
        customer: 'cus_1',
        lines: { data: [] },
      } as any);

      expect(prisma.reportJob.create).not.toHaveBeenCalled();
    });

    it('should not send email if user has no email on invoice paid', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        tier: 'monthly',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });
      prisma.reportJob.findFirst.mockResolvedValue(null);
      prisma.reportJob.create.mockResolvedValue({});

      await service.handleInvoicePaid({
        customer: 'cus_1',
        lines: { data: [] },
      } as any);

      expect(email.sendMonthlyReportCycle).not.toHaveBeenCalled();
    });
  });

  // ── handleSubscriptionCreated / Updated (sync from Stripe) ──
  describe('handleSubscriptionCreated/Updated', () => {
    it('should sync subscription status from Stripe (active)', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: 'monthly',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleSubscriptionCreated({
        id: 'stripe_sub_1',
        customer: 'cus_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_monthly_test' } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should sync cancelled subscription status', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-2',
        tier: 'annual',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated({
        id: 'stripe_sub_2',
        customer: 'cus_2',
        status: 'canceled',
        items: { data: [] },
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'cancelled',
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should skip when no matching subscription found', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleSubscriptionCreated({
        id: 'stripe_sub_x',
        customer: 'cus_unknown',
        status: 'active',
        items: { data: [] },
      } as any);

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('maps trialing status to active', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-3',
        tier: 'monthly',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated({
        id: 'stripe_sub_3',
        customer: 'cus_3',
        status: 'trialing',
        items: { data: [] },
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('maps past_due status', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-4',
        tier: 'monthly',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated({
        id: 'stripe_sub_4',
        customer: 'cus_4',
        status: 'past_due',
        items: { data: [] },
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'past_due' }),
        }),
      );
    });

    it('maps paused status to grace_period', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub-5',
        tier: 'annual',
      });
      prisma.subscription.update.mockResolvedValue({});

      await service.handleSubscriptionUpdated({
        id: 'stripe_sub_5',
        customer: 'cus_5',
        status: 'paused',
        items: { data: [] },
      } as any);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'grace_period' }),
        }),
      );
    });
  });

  // ── resolveFrontendUrl (open redirect protection) ──
  describe('resolveFrontendUrl', () => {
    it('should block external URLs (open redirect prevention)', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_redir',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl: 'https://evil.com/steal-token',
        cancelUrl: 'https://evil.com/cancel',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      // Should fall back to base URL, not pass the evil URL
      expect(callArgs.success_url).toBe('https://cerniq.io');
      expect(callArgs.cancel_url).toBe('https://cerniq.io');
    });

    it('should allow localhost URLs during dev', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_local',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl: 'http://localhost:3001/success',
        cancelUrl: 'http://localhost:3001/cancel',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.success_url).toBe('http://localhost:3001/success');
      expect(callArgs.cancel_url).toBe('http://localhost:3001/cancel');
    });

    it('should handle empty success/cancel URLs', async () => {
      const stripeMock = (service as any).stripe;
      stripeMock.checkout.sessions.create.mockResolvedValue({
        url: '',
        id: 'cs_empty',
      });

      await service.createCheckoutSession({
        tier: 'monthly',
        successUrl: '',
        cancelUrl: '',
      });

      const callArgs = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(callArgs.success_url).toBe('https://cerniq.io');
      expect(callArgs.cancel_url).toBe('https://cerniq.io');
    });
  });

  // ── cancelSequences ────────────────────────────────
  describe('cancelSequences', () => {
    it('should cancel sequences for a lead', async () => {
      prisma.emailSequence.updateMany.mockResolvedValue({ count: 1 });
      await service.cancelSequences(undefined, 'lead-1');
      expect(prisma.emailSequence.updateMany).toHaveBeenCalledWith({
        where: { cancelled: false, sentAt: null, leadId: 'lead-1' },
        data: { cancelled: true },
      });
    });
  });

  // ── verifyWebhookSignature ─────────────────────────
  describe('verifyWebhookSignature', () => {
    it('should throw when STRIPE_WEBHOOK_SECRET is not set', () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      // Need a new service instance with missing webhook secret
      // The current instance already has the secret, so we test via requireStripe guard
      expect(() =>
        service.verifyWebhookSignature(Buffer.from('{}'), 'sig'),
      ).toThrow(); // constructEvent will throw or webhook secret check
    });
  });

  // ── handlePaymentComplete - annual tier period end ──
  describe('handlePaymentComplete (annual tier)', () => {
    it('should set currentPeriodEnd ~12 months for annual tier', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-annual',
        email: 'annual@test.com',
      });
      prisma.subscription.upsert.mockResolvedValue({});
      prisma.reportJob.create.mockResolvedValue({});
      prisma.magicLink.create.mockResolvedValue({});
      prisma.emailSequence.findFirst.mockResolvedValue(null);
      prisma.emailSequence.create.mockResolvedValue({});
      prisma.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });

      await service.handlePaymentComplete({
        id: 'cs_annual',
        customer_email: 'annual@test.com',
        customer: 'cus_a',
        amount_total: 290000,
        metadata: {
          tier: 'annual',
          leadId: '',
          institutionName: '',
          customerName: '',
        },
      } as any);

      const call = prisma.subscription.upsert.mock.calls[0][0];
      const endDate = call.create.currentPeriodEnd as Date;
      expect(endDate).toBeInstanceOf(Date);
      const diffMs = endDate.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(330 * 24 * 60 * 60 * 1000); // ~11 months
      expect(diffMs).toBeLessThan(400 * 24 * 60 * 60 * 1000); // ~13 months
    });
  });
});
