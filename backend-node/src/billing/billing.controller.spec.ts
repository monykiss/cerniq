import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';

describe('BillingController', () => {
  let controller: BillingController;
  let billingService: jest.Mocked<
    Pick<
      BillingService,
      | 'createCheckoutSession'
      | 'verifyWebhookSignature'
      | 'handlePaymentComplete'
      | 'handleSubscriptionCreated'
      | 'handleSubscriptionUpdated'
      | 'handleInvoicePaid'
      | 'handlePaymentFailed'
      | 'handleSubscriptionCancelled'
      | 'handleDispute'
      | 'createBillingPortalSession'
      | 'getSubscription'
      | 'verifyMagicLink'
      | 'requestMagicLink'
    >
  >;
  let authService: jest.Mocked<Pick<AuthService, 'generateTokens'>>;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    const mockBillingService = {
      createCheckoutSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      handlePaymentComplete: jest.fn(),
      handleSubscriptionCreated: jest.fn(),
      handleSubscriptionUpdated: jest.fn(),
      handleInvoicePaid: jest.fn(),
      handlePaymentFailed: jest.fn(),
      handleSubscriptionCancelled: jest.fn(),
      handleDispute: jest.fn(),
      createBillingPortalSession: jest.fn(),
      getSubscription: jest.fn(),
      verifyMagicLink: jest.fn(),
      requestMagicLink: jest.fn(),
    };

    const mockAuditService = {
      log: jest.fn(),
    };

    const mockAuthService = {
      generateTokens: jest.fn(),
    };

    const mockPrismaService = {
      processedWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
    billingService = module.get(BillingService);
    authService = module.get(AuthService);
    auditService = module.get(AuditService);
  });

  describe('POST /api/billing/checkout', () => {
    it('should create a checkout session with valid DTO', async () => {
      const dto = {
        tier: 'monthly' as const,
        customerEmail: 'test@example.com',
        customerName: 'Test User',
        institutionName: 'Test University',
        successUrl: '/success',
        cancelUrl: '/cancel',
      };
      const expected = {
        checkoutUrl: 'https://checkout.stripe.com/xxx',
        sessionId: 'sess_123',
      };
      billingService.createCheckoutSession.mockResolvedValue(expected);

      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
      const result = await controller.createCheckout(dto, req);

      expect(result).toEqual(expected);
    });

    it('should pass tier, customerEmail, customerName, and institutionName to service', async () => {
      const dto = {
        tier: 'annual' as const,
        customerEmail: 'client@uni.edu',
        customerName: 'Jane Doe',
        institutionName: 'State University',
        successUrl: '/ok',
        cancelUrl: '/nope',
      };
      billingService.createCheckoutSession.mockResolvedValue({
        checkoutUrl: '',
        sessionId: '',
      });

      await controller.createCheckout(dto, { ip: '1.2.3.4', headers: {} });

      expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
        tier: 'annual',
        customerEmail: 'client@uni.edu',
        customerName: 'Jane Doe',
        institutionName: 'State University',
        leadId: undefined,
        successUrl: '/ok',
        cancelUrl: '/nope',
      });
    });

    it('should fire an audit log on checkout', async () => {
      const dto = {
        tier: 'one_time' as const,
        customerEmail: 'audit@test.com',
        institutionName: 'Audit U',
        successUrl: '/s',
        cancelUrl: '/c',
      };
      billingService.createCheckoutSession.mockResolvedValue({
        checkoutUrl: '',
        sessionId: '',
      });

      await controller.createCheckout(dto, {
        ip: '10.0.0.1',
        headers: { 'user-agent': 'Mozilla' },
      });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_initiated',
          resource: 'subscription',
          metadata: expect.objectContaining({ tier: 'one_time' }),
        }),
      );
    });

    it('should propagate service errors for invalid tier', async () => {
      billingService.createCheckoutSession.mockRejectedValue(
        new BadRequestException('Unknown tier: invalid'),
      );

      const dto = {
        tier: 'invalid' as any,
        successUrl: '/s',
        cancelUrl: '/c',
      };

      await expect(
        controller.createCheckout(dto, { ip: '', headers: {} }),
      ).rejects.toThrow('Unknown tier: invalid');
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('should reject when stripe-signature header is missing', async () => {
      const req = { rawBody: Buffer.from('{}') };

      await expect(
        controller.handleWebhook(undefined as any, req),
      ).rejects.toThrow('Missing stripe-signature header');
    });

    it('should reject when stripe-signature header is empty string', async () => {
      const req = { rawBody: Buffer.from('{}') };

      await expect(controller.handleWebhook('', req)).rejects.toThrow(
        'Missing stripe-signature header',
      );
    });

    it('should reject when rawBody is not available', async () => {
      const req = { rawBody: undefined };

      await expect(controller.handleWebhook('sig_abc', req)).rejects.toThrow(
        'Raw body not available',
      );
    });

    it('should reject invalid webhook signature', async () => {
      billingService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('Signature verification failed');
      });

      const req = { rawBody: Buffer.from('payload') };

      await expect(controller.handleWebhook('sig_bad', req)).rejects.toThrow(
        'Invalid webhook signature',
      );
    });

    it('should process checkout.session.completed event with paid status', async () => {
      const session = { payment_status: 'paid', id: 'sess_1' };
      const event = {
        type: 'checkout.session.completed',
        id: 'evt_1',
        data: { object: session },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handlePaymentComplete.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handlePaymentComplete).toHaveBeenCalledWith(
        session,
      );
    });

    it('should not call handlePaymentComplete when payment_status is not paid', async () => {
      const session = { payment_status: 'unpaid', id: 'sess_2' };
      const event = {
        type: 'checkout.session.completed',
        id: 'evt_2',
        data: { object: session },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);

      const req = { rawBody: Buffer.from('body') };
      await controller.handleWebhook('sig_valid', req);

      expect(billingService.handlePaymentComplete).not.toHaveBeenCalled();
    });

    it('should process customer.subscription.created event', async () => {
      const sub = { id: 'sub_1', status: 'active' };
      const event = {
        type: 'customer.subscription.created',
        id: 'evt_sub_created',
        data: { object: sub },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleSubscriptionCreated.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handleSubscriptionCreated).toHaveBeenCalledWith(
        sub,
      );
    });

    it('should process customer.subscription.updated event', async () => {
      const sub = { id: 'sub_2', status: 'past_due' };
      const event = {
        type: 'customer.subscription.updated',
        id: 'evt_sub_updated',
        data: { object: sub },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleSubscriptionUpdated.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handleSubscriptionUpdated).toHaveBeenCalledWith(
        sub,
      );
    });

    it('should process customer.subscription.deleted event', async () => {
      const sub = { id: 'sub_3', status: 'canceled' };
      const event = {
        type: 'customer.subscription.deleted',
        id: 'evt_sub_deleted',
        data: { object: sub },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleSubscriptionCancelled.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handleSubscriptionCancelled).toHaveBeenCalledWith(
        sub,
      );
    });

    it('should process invoice.payment_succeeded event', async () => {
      const invoice = { id: 'in_1', amount_paid: 29900 };
      const event = {
        type: 'invoice.payment_succeeded',
        id: 'evt_inv_paid',
        data: { object: invoice },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleInvoicePaid.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handleInvoicePaid).toHaveBeenCalledWith(invoice);
    });

    it('should process invoice.payment_failed event', async () => {
      const invoice = { id: 'in_2', amount_due: 29900 };
      const event = {
        type: 'invoice.payment_failed',
        id: 'evt_inv_failed',
        data: { object: invoice },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handlePaymentFailed.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handlePaymentFailed).toHaveBeenCalledWith(invoice);
    });

    it('should process charge.dispute.created event', async () => {
      const dispute = { id: 'dp_1', charge: 'ch_123', reason: 'fraudulent' };
      const event = {
        type: 'charge.dispute.created',
        id: 'evt_dispute',
        data: { object: dispute },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleDispute.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handleDispute).toHaveBeenCalledWith(dispute);
    });

    it('should return received:true for unhandled event types', async () => {
      const event = {
        type: 'payment_intent.created',
        id: 'evt_unhandled',
        data: { object: {} },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
    });

    it('should skip duplicate events (idempotency via P2002 on marker insert)', async () => {
      // D17: insert-first-with-P2002-catch. The marker insert IS the
      // idempotency signal — no pre-check. If the unique constraint
      // fires, the event was already processed (or is being processed
      // concurrently) and the handler MUST NOT run.
      const event = {
        type: 'checkout.session.completed',
        id: 'evt_already_processed',
        data: { object: { payment_status: 'paid' } },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);

      const prisma = controller['prisma'] as any;
      // Simulate Prisma P2002 unique violation on the marker row.
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true, duplicate: true });
      // The critical assertion: handler side effects never fire on
      // duplicate events. Before D17 the handler ran twice under
      // concurrent replay.
      expect(billingService.handlePaymentComplete).not.toHaveBeenCalled();
    });

    it('should dispatch handler exactly once when marker insert succeeds (D17 happy-path guard)', async () => {
      const event = {
        type: 'checkout.session.completed',
        id: 'evt_fresh',
        data: {
          object: { payment_status: 'paid', id: 'cs_fresh' },
        },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      const prisma = controller['prisma'] as any;
      prisma.processedWebhookEvent.create.mockResolvedValue({
        id: 'evt_fresh',
        eventType: 'checkout.session.completed',
      });

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handlePaymentComplete).toHaveBeenCalledTimes(1);
      expect(prisma.processedWebhookEvent.create).toHaveBeenCalledTimes(1);
    });

    it('re-throws non-P2002 marker-insert errors so Stripe retries (DB outage case)', async () => {
      // Unlike P2002 (which is the idempotency signal), other Prisma
      // errors on the marker insert are real failures. The old
      // pattern's `.catch(err => log)` swallowed these silently,
      // which would have meant handler-ran-but-marker-missing: the
      // event would be re-processed on every Stripe retry. The new
      // code re-throws so Stripe's retry loop sees a 5xx and holds
      // the event until the DB comes back.
      const event = {
        type: 'invoice.payment_succeeded',
        id: 'evt_db_down',
        data: { object: { id: 'in_x' } },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      const prisma = controller['prisma'] as any;
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        Object.assign(new Error('connection refused'), { code: 'P1001' }),
      );

      const req = { rawBody: Buffer.from('body') };
      await expect(controller.handleWebhook('sig_valid', req)).rejects.toThrow(
        'connection refused',
      );
      // And the handler must NOT have run.
      expect(billingService.handleInvoicePaid).not.toHaveBeenCalled();
    });

    it('should return received:true even when handler throws (prevents Stripe retry storms)', async () => {
      const event = {
        type: 'invoice.payment_succeeded',
        id: 'evt_handler_error',
        data: { object: { id: 'in_err' } },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);
      billingService.handleInvoicePaid.mockRejectedValue(
        new Error('DB connection lost'),
      );

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      // Should still return 200 to prevent Stripe retry storms
      expect(result).toEqual({ received: true });
    });
  });

  describe('GET /api/billing/subscription', () => {
    it('should return subscription for authenticated user', async () => {
      const subscription = {
        tier: 'monthly',
        status: 'active',
        currentPeriodEnd: new Date('2026-04-15'),
        reportsUsed: 3,
        createdAt: new Date('2026-01-01'),
      };
      billingService.getSubscription.mockResolvedValue(subscription);

      const req = { user: { userId: 'user-123' } };
      const result = await controller.getSubscription(req);

      expect(result).toEqual(subscription);
    });

    it('should return free tier when no subscription exists', async () => {
      billingService.getSubscription.mockResolvedValue(null);

      const req = { user: { userId: 'user-456' } };
      const result = await controller.getSubscription(req);

      expect(result).toEqual({ tier: 'free', status: 'active' });
    });

    it('should query subscription using userId from request', async () => {
      billingService.getSubscription.mockResolvedValue(null);

      const req = { user: { userId: 'user-789' } };
      await controller.getSubscription(req);

      expect(billingService.getSubscription).toHaveBeenCalledWith('user-789');
    });
  });

  describe('POST /api/billing/portal', () => {
    it('should create billing portal session for authenticated user', async () => {
      const expected = { portalUrl: 'https://billing.stripe.com/portal/xxx' };
      billingService.createBillingPortalSession.mockResolvedValue(expected);

      const req = { user: { userId: 'user-abc' } };
      const result = await controller.getBillingPortal(req);

      expect(result).toEqual(expected);
    });

    it('should pass userId from request to service', async () => {
      billingService.createBillingPortalSession.mockResolvedValue({
        portalUrl: '',
      });

      const req = { user: { userId: 'user-def' } };
      await controller.getBillingPortal(req);

      expect(billingService.createBillingPortalSession).toHaveBeenCalledWith(
        'user-def',
      );
    });

    it('should propagate error when no billing account found', async () => {
      billingService.createBillingPortalSession.mockRejectedValue(
        new BadRequestException('No billing account found'),
      );

      const req = { user: { userId: 'user-no-billing' } };

      await expect(controller.getBillingPortal(req)).rejects.toThrow(
        'No billing account found',
      );
    });
  });

  describe('magic link auth', () => {
    it('redirects to /auth/expired when no token is provided', async () => {
      const req = { ip: '1.2.3.4', headers: {} };
      const res = { redirect: jest.fn(), cookie: jest.fn() };

      await controller.verifyMagicLink(undefined as any, req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/expired'),
      );
    });

    it('redirects to /auth/expired when the magic link is invalid', async () => {
      billingService.verifyMagicLink.mockResolvedValue(null);

      const req = { ip: '1.2.3.4', headers: {} };
      const res = { redirect: jest.fn(), cookie: jest.fn() };

      await controller.verifyMagicLink('bad-token', req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/auth/expired'),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure' }),
      );
    });

    it('sets the full auth cookie pair when a magic link is verified', async () => {
      process.env.FRONTEND_URL = 'https://cerniq.io';
      billingService.verifyMagicLink.mockResolvedValue({
        id: 'user-123',
        email: 'owner@cerniq.io',
        name: 'Owner',
      } as any);
      authService.generateTokens.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-123', email: 'owner@cerniq.io', name: 'Owner' },
      });

      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
      const res = {
        cookie: jest.fn(),
        redirect: jest.fn(),
      };

      await controller.verifyMagicLink('magic-token', req, res);

      expect(authService.generateTokens).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'owner@cerniq.io',
        name: 'Owner',
      });
      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.redirect).toHaveBeenCalledWith(
        'https://cerniq.io/auth/callback?returnUrl=%2Fdashboard',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'success' }),
      );
    });
  });

  describe('POST /auth/magic/request', () => {
    it('always returns a success message', async () => {
      billingService.requestMagicLink.mockResolvedValue(undefined);

      const result = await controller.requestMagicLink({
        email: 'test@test.com',
      });

      expect(result.message).toContain('If this email has an account');
    });

    it('still returns success when the service throws', async () => {
      billingService.requestMagicLink.mockRejectedValue(new Error('Internal'));

      const result = await controller.requestMagicLink({
        email: 'bad@test.com',
      });

      expect(result.message).toContain('If this email has an account');
    });
  });

  describe('POST /api/billing/webhook — edge cases', () => {
    it('handles a dedup race condition via P2002 on the marker insert (D17)', async () => {
      // Post-D17: the marker insert IS the idempotency lock, and
      // P2002 is the signal that we lost the race to another webhook
      // replay. Handler MUST NOT run, response says duplicate:true,
      // Stripe sees 200 and stops retrying.
      const event = {
        type: 'customer.subscription.created',
        id: 'evt_race',
        data: { object: { id: 'sub_race', status: 'active' } },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);

      const prisma = controller['prisma'] as any;
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint violation'), {
          code: 'P2002',
        }),
      );

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true, duplicate: true });
      expect(billingService.handleSubscriptionCreated).not.toHaveBeenCalled();
    });

    it('handles checkout.session.completed with a non-paid status gracefully', async () => {
      const session = { payment_status: 'no_payment_required', id: 'sess_np' };
      const event = {
        type: 'checkout.session.completed',
        id: 'evt_np',
        data: { object: session },
      };
      billingService.verifyWebhookSignature.mockReturnValue(event as any);

      const req = { rawBody: Buffer.from('body') };
      const result = await controller.handleWebhook('sig_valid', req);

      expect(result).toEqual({ received: true });
      expect(billingService.handlePaymentComplete).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/billing/checkout — with leadId', () => {
    it('passes leadId through to the service', async () => {
      const dto = {
        tier: 'monthly' as const,
        customerEmail: 'lead@test.com',
        customerName: 'Lead User',
        institutionName: 'Lead Uni',
        leadId: 'lead-123',
        successUrl: '/success',
        cancelUrl: '/cancel',
      };
      billingService.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/yyy',
        sessionId: 'sess_lead',
      });

      const req = { ip: '1.2.3.4', headers: {} };
      await controller.createCheckout(dto, req);

      expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: 'lead-123' }),
      );
    });
  });
});
