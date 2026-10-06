import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Req,
  Res,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CheckoutRequestDto } from './billing.dto';
import { AuthService } from '../auth/auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { AllowBlockedAccess } from '../auth/allow-blocked-access.decorator';
import {
  buildFrontendAuthCallbackRedirect,
  resolveFrontendUrl,
  setAuthCookies,
} from '../auth/auth-cookie.util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { SkipAuditLog } from '../common/decorators/audit-action.decorator';
@ApiTags('Billing')
@Controller()
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Checkout ──────────────────────────────────────────

  // verify:auth-skip — public checkout (pre-purchase lead-to-customer conversion); throttled 10/hour/IP; payment auth handled downstream by Stripe
  @Post('api/billing/checkout')
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @SkipAuditLog()
  @ApiOperation({
    summary: 'Create a Stripe checkout session for subscription purchase',
  })
  @ApiResponse({ status: 201, description: 'Checkout session URL returned' })
  @ApiResponse({ status: 400, description: 'Invalid checkout parameters' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded (max 10/hr)' })
  async createCheckout(@Body() body: CheckoutRequestDto, @Req() req: any) {
    const result = await this.billing.createCheckoutSession({
      tier: body.tier,
      customerEmail: body.customerEmail,
      customerName: body.customerName,
      institutionName: body.institutionName,
      leadId: body.leadId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });

    this.audit.log({
      action: 'payment_initiated',
      resource: 'subscription',
      metadata: {
        tier: body.tier,
        customerEmail: body.customerEmail,
        institutionName: body.institutionName,
      },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return result;
  }

  // ── Billing Portal (auth-protected) ───────────────────

  @Post('api/billing/portal')
  @UseGuards(AuthGuard)
  @AllowBlockedAccess()
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
    summary:
      'Create a Stripe billing portal session for subscription management',
  })
  @ApiResponse({ status: 201, description: 'Billing portal URL returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBillingPortal(@Req() req: any) {
    return this.billing.createBillingPortalSession(req.user.userId);
  }

  // ── Webhook liveness probe (UptimeRobot) ──────────────
  //
  // UptimeRobot hits this to confirm the webhook service is up without
  // pretending to be Stripe (which would require a valid signature).
  // Returns 200 quickly; does NOT touch DB. Kept separate from /health so
  // a DB or Redis blip doesn't page the on-call as "Stripe down".

  // verify:auth-skip — UptimeRobot liveness probe; isolated from /health to keep on-call signal clean
  @Get('api/billing/webhook/healthcheck')
  @SkipThrottle()
  @SkipAuditLog()
  webhookHealthcheck() {
    return {
      ok: true,
      service: 'stripe-webhook',
      timestamp: new Date().toISOString(),
    };
  }

  // ── Stripe Webhook (signature-verified, no auth) ──────

  // verify:auth-skip — Stripe webhook; auth surface is the `stripe-signature` HMAC verified inline against STRIPE_WEBHOOK_SECRET
  @Post('api/billing/webhook')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle incoming Stripe webhook events (signature-verified)',
  })
  @ApiHeader({
    name: 'stripe-signature',
    description: 'Stripe webhook signature header',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid webhook signature',
  })
  async handleWebhook(
    @Headers('stripe-signature') sig: string,
    @Req() req: any,
  ) {
    if (!sig) throw new BadRequestException('Missing stripe-signature header');

    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException('Raw body not available');

    let event;
    try {
      event = this.billing.verifyWebhookSignature(rawBody, sig);
    } catch (err: any) {
      this.logger.error({
        event: 'webhook.signature_failed',
        error: err.message,
      });
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log({
      event: 'webhook.received',
      type: event.type,
      id: event.id,
    });

    // Idempotency via insert-first-with-P2002-catch.
    //
    // The previous pattern — `findUnique`, then dispatch handler, then
    // `create` — had a check-then-act race: two concurrent Stripe
    // replays of the same event both passed the findUnique (neither
    // saw the other's marker yet), both dispatched the handler (real
    // DB writes happened twice — duplicate subscriptions, duplicate
    // report jobs, duplicate emails), then one inserted the marker
    // and the other hit P2002 and silently logged a "dedup_race". The
    // marker write was deduped but the side effects were not.
    //
    // The fix flips the race window from "between check and insert"
    // to zero: try the insert first. If it succeeds, we hold an
    // exclusive lock on this event via the unique constraint on
    // `processedWebhookEvent.id` — dispatch the handler. If it
    // fails with P2002, we lost the race (or it's a legitimate
    // replay); skip without dispatching. Only the winner executes
    // side effects.
    try {
      await this.prisma.processedWebhookEvent.create({
        data: { id: event.id, eventType: event.type },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === 'P2002') {
        this.logger.log({ event: 'webhook.duplicate_skipped', id: event.id });
        return { received: true, duplicate: true };
      }
      // Any other create error (DB down, connection lost) is a real
      // problem — surface as 500 so Stripe retries the webhook.
      this.logger.error({
        event: 'webhook.marker_insert_failed',
        id: event.id,
        error: (err as Error).message,
      });
      throw err;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.payment_status === 'paid') {
            await this.billing.handlePaymentComplete(session);
          }
          break;
        }
        case 'customer.subscription.created':
          await this.billing.handleSubscriptionCreated(event.data.object);
          break;
        case 'customer.subscription.updated':
          await this.billing.handleSubscriptionUpdated(event.data.object);
          break;
        case 'invoice.payment_succeeded':
          await this.billing.handleInvoicePaid(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.billing.handlePaymentFailed(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.billing.handleSubscriptionCancelled(event.data.object);
          break;
        case 'charge.dispute.created':
          await this.billing.handleDispute(event.data.object);
          break;
        default:
          this.logger.log({ event: 'webhook.unhandled', type: event.type });
      }
    } catch (err: unknown) {
      // Handler failed AFTER we claimed the event. Log it but return
      // 200 to prevent Stripe retry storms — the marker row is the
      // authoritative "we processed this" signal. Re-drives require
      // manual remediation (delete the marker, Stripe admin replay).
      this.logger.error({
        event: 'webhook.processing_error',
        type: event.type,
        id: event.id,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }

    return { received: true };
  }

  // ── Magic Link Auth ───────────────────────────────────

  // verify:auth-skip — magic-link verification (pre-auth); the JWT token in the query is the auth surface; throttled 10/15min/IP
  @Get('api/auth/magic')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiOperation({
    summary: 'Verify a magic link token and set authentication cookies',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to dashboard on success or auth/expired on failure',
  })
  async verifyMagicLink(
    @Query('token') token: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    return this.completeMagicLinkVerification(token, req, res);
  }

  // verify:auth-skip — legacy magic-link path (back-compat with older email templates); same JWT-token auth surface as /api/auth/magic
  @Get('auth/magic')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  async verifyMagicLinkLegacy(
    @Query('token') token: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    return this.completeMagicLinkVerification(token, req, res);
  }

  // verify:auth-skip — request magic-link email (pre-auth); throttled 3/hour/IP; always 200 to prevent email-enumeration
  @Post('api/auth/magic/request')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  async requestMagicLink(@Body() body: { email: string }) {
    return this.queueMagicLinkRequest(body.email);
  }

  // verify:auth-skip — legacy magic-link-request path (back-compat); same enumeration-safe behavior as /api/auth/magic/request
  @Post('auth/magic/request')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  async requestMagicLinkLegacy(@Body() body: { email: string }) {
    return this.queueMagicLinkRequest(body.email);
  }

  private async completeMagicLinkVerification(
    token: string,
    req: any,
    res: any,
  ) {
    const frontendUrl = resolveFrontendUrl();
    if (!token) {
      return res.redirect(`${frontendUrl}/auth/expired?returnUrl=%2Fdashboard`);
    }

    const user = await this.billing.verifyMagicLink(token);
    if (!user) {
      this.audit.log({
        action: 'login',
        resource: 'magic_link',
        outcome: 'failure',
        metadata: { reason: 'invalid_or_expired_token' },
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return res.redirect(`${frontendUrl}/auth/expired?returnUrl=%2Fdashboard`);
    }

    const tokens = await this.authService.generateTokens(user);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    this.audit.log({
      userId: user.id,
      action: 'login',
      resource: 'magic_link',
      outcome: 'success',
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return res.redirect(
      buildFrontendAuthCallbackRedirect('/dashboard', '/dashboard'),
    );
  }

  private async queueMagicLinkRequest(email: string) {
    // Always return success (don't reveal if email exists)
    try {
      await this.billing.requestMagicLink(email);
    } catch (err) {
      // Don't reveal account existence — but log for audit trail
      this.logger.warn(
        `Magic link request failed for ${email}: ${(err as Error).message}`,
      );
    }
    return { message: 'If this email has an account, a login link was sent.' };
  }

  // ── Subscription Info ─────────────────────────────────

  @Get('api/billing/subscription')
  @UseGuards(AuthGuard)
  @AllowBlockedAccess()
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({
    summary: 'Get current subscription details for the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Subscription tier and status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSubscription(@Req() req: any) {
    const sub = await this.billing.getSubscription(req.user.userId);
    return sub || { tier: 'free', status: 'active' };
  }
}
