import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as crypto from 'crypto';
import * as net from 'net';

// ─── Webhook Event Types ────────────────────────────────────

export type WebhookEventType =
  | 'policy.breach'
  | 'rate.move'
  | 'compliance.deadline'
  | 'report.ready'
  | 'ews.alert'
  | 'analysis.complete'
  | 'camel.downgrade';

export interface WebhookDeliveryResult {
  subscriptionId: string;
  url: string;
  eventType: string;
  statusCode: number | null;
  success: boolean;
  error?: string;
  deliveredAt: string;
}

/**
 * Validate a webhook URL is safe from SSRF attacks.
 * Blocks: private IPs, localhost, cloud metadata endpoints, non-HTTPS in production.
 */
function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Invalid webhook URL');
  }

  // Must be HTTPS in production
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use HTTPS in production');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('Webhook URL must use HTTP or HTTPS');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and loopback
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    throw new BadRequestException('Webhook URL cannot target localhost');
  }

  // Block cloud metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal'
  ) {
    throw new BadRequestException(
      'Webhook URL cannot target cloud metadata services',
    );
  }

  // Block private/internal IP ranges
  if (net.isIP(hostname)) {
    const parts = hostname.split('.').map(Number);
    const isPrivate =
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254);
    if (isPrivate) {
      throw new BadRequestException(
        'Webhook URL cannot target private IP addresses',
      );
    }
  }
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Manage Subscriptions ─────────────────────────────────

  async createSubscription(
    institutionId: string,
    data: {
      url: string;
      events: WebhookEventType[];
    },
  ) {
    validateWebhookUrl(data.url);
    const secretKey = crypto.randomBytes(32).toString('hex');
    return this.prisma.webhookSubscription.create({
      data: {
        institutionId,
        url: data.url,
        events: data.events,
        secretKey,
      },
    });
  }

  async listSubscriptions(institutionId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { institutionId, isActive: true },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        lastDeliveredAt: true,
        failureCount: true,
        createdAt: true,
      },
      take: 100,
    });
  }

  async deleteSubscription(subscriptionId: string) {
    await this.prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  // ─── Dispatch Events (with exponential backoff retry) ────

  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000; // 1s, 2s, 4s

  async dispatchEvent(
    institutionId: string,
    eventType: WebhookEventType,
    payload: Record<string, any>,
  ): Promise<WebhookDeliveryResult[]> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { institutionId, isActive: true, events: { has: eventType } },
      take: 100,
    });

    const results: WebhookDeliveryResult[] = [];

    for (const sub of subscriptions) {
      const result = await this.deliverWithRetry(sub, eventType, payload);
      results.push(result);

      // Update subscription status
      if (result.success) {
        await this.prisma.webhookSubscription.update({
          where: { id: sub.id },
          data: { lastDeliveredAt: new Date(), failureCount: 0 },
        });
      } else {
        const newFailureCount = sub.failureCount + 1;
        await this.prisma.webhookSubscription.update({
          where: { id: sub.id },
          data: {
            failureCount: newFailureCount,
            isActive: newFailureCount < 10, // disable after 10 consecutive failures
          },
        });
        this.logger.warn(
          `Webhook ${sub.id} failed after ${WebhookService.MAX_RETRIES} retries (total failures: ${newFailureCount})`,
        );
      }
    }

    return results;
  }

  private async deliverWithRetry(
    subscription: any,
    eventType: string,
    payload: Record<string, any>,
  ): Promise<WebhookDeliveryResult> {
    let lastResult: WebhookDeliveryResult | null = null;

    for (let attempt = 0; attempt <= WebhookService.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = WebhookService.BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.logger.log(
          `Webhook retry ${attempt}/${WebhookService.MAX_RETRIES} for ${subscription.url}`,
        );
      }

      lastResult = await this.deliverWebhook(subscription, eventType, payload);
      if (lastResult.success) return lastResult;

      // Don't retry on 4xx (client errors) — only retry on 5xx and network failures
      if (
        lastResult.statusCode &&
        lastResult.statusCode >= 400 &&
        lastResult.statusCode < 500
      ) {
        return lastResult;
      }
    }

    return lastResult!;
  }

  // ─── Private: Deliver Single Webhook ──────────────────────

  private async deliverWebhook(
    subscription: any,
    eventType: string,
    payload: Record<string, any>,
  ): Promise<WebhookDeliveryResult> {
    // Defense in depth: re-validate URL before every delivery
    try {
      validateWebhookUrl(subscription.url);
    } catch {
      this.logger.warn({
        event: 'webhook.ssrf_blocked',
        url: subscription.url,
        subscriptionId: subscription.id,
      });
      return {
        subscriptionId: subscription.id,
        url: subscription.url,
        eventType,
        statusCode: null,
        success: false,
        error: 'URL blocked by SSRF policy',
        deliveredAt: new Date().toISOString(),
      };
    }

    const body = JSON.stringify({
      event: eventType,
      institutionId: subscription.institutionId,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const signature = crypto
      .createHmac('sha256', subscription.secretKey)
      .update(body)
      .digest('hex');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CERNIQ-Signature': `sha256=${signature}`,
          'X-CERNIQ-Event': eventType,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return {
        subscriptionId: subscription.id,
        url: subscription.url,
        eventType,
        statusCode: response.status,
        success: response.status >= 200 && response.status < 300,
        deliveredAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.warn(
        `Webhook delivery failed to ${subscription.url}: ${err.message}`,
      );
      return {
        subscriptionId: subscription.id,
        url: subscription.url,
        eventType,
        statusCode: null,
        success: false,
        error: err.message,
        deliveredAt: new Date().toISOString(),
      };
    }
  }
}
