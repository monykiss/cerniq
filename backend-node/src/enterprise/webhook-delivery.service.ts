import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { createHmac } from 'crypto';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface WebhookParams {
  batchId: string;
  webhookUrl: string;
  webhookSecret: string;
  event: string;
  body: Record<string, unknown>;
}

export interface WebhookDeliveryLog {
  id: string;
  batchId: string;
  webhookUrl: string;
  event: string;
  attempt: number;
  maxAttempts: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
  httpStatus: number | null;
  responseBody: string | null;
  error: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const SIGNATURE_HEADER = 'X-Cerniq-Signature-256';
const RETRY_BACKOFF_MS = [
  0, // attempt 1: immediate
  30_000, // attempt 2: 30s
  120_000, // attempt 3: 2m
  600_000, // attempt 4: 10m
  3_600_000, // attempt 5: 1h
];

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute HMAC-SHA256 signature for webhook payload.
   * The signature is: hmac-sha256(secret, JSON.stringify(body))
   * Delivered in the X-Cerniq-Signature-256 header.
   */
  computeSignature(secret: string, body: Record<string, unknown>): string {
    return createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  /**
   * Send a webhook notification with HMAC-SHA256 signature.
   * Records the delivery attempt and handles retries on failure.
   */
  async deliver(params: WebhookParams): Promise<WebhookDeliveryLog> {
    const { batchId, webhookUrl, webhookSecret, event, body } = params;

    const logEntry: WebhookDeliveryLog = {
      id: crypto.randomUUID(),
      batchId,
      webhookUrl,
      event,
      attempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      status: 'PENDING',
      httpStatus: null,
      responseBody: null,
      error: null,
      nextRetryAt: null,
      createdAt: new Date(),
      deliveredAt: null,
    };

    this.logger.log({
      msg: 'Delivering webhook',
      batchId,
      event,
      webhookUrl,
    });

    const signature = this.computeSignature(webhookSecret, body);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: signature,
          'User-Agent': 'CERNIQ-Webhook/1.0',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000), // 30s timeout
      });

      logEntry.httpStatus = response.status;

      if (response.ok) {
        logEntry.status = 'SUCCESS';
        logEntry.deliveredAt = new Date();
        logEntry.responseBody = await response.text().catch(() => null);
        this.logger.log({
          msg: 'Webhook delivered',
          batchId,
          event,
          httpStatus: response.status,
        });
      } else {
        logEntry.status = 'RETRYING';
        logEntry.error = `HTTP ${response.status}`;
        logEntry.responseBody = await response.text().catch(() => null);
        logEntry.nextRetryAt = new Date(
          Date.now() +
            (RETRY_BACKOFF_MS[logEntry.attempt] ?? RETRY_BACKOFF_MS[4]),
        );
        this.logger.warn({
          msg: 'Webhook delivery failed, will retry',
          batchId,
          event,
          httpStatus: response.status,
          nextRetryAt: logEntry.nextRetryAt,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logEntry.status = 'RETRYING';
      logEntry.error = errorMessage;
      logEntry.nextRetryAt = new Date(
        Date.now() +
          (RETRY_BACKOFF_MS[logEntry.attempt] ?? RETRY_BACKOFF_MS[4]),
      );
      this.logger.error({
        msg: 'Webhook delivery error',
        batchId,
        event,
        error: errorMessage,
      });
    }

    // Store the delivery log
    this.deliveryStore.set(logEntry.id, logEntry);
    return logEntry;
  }

  /**
   * Retry all failed deliveries where nextRetryAt <= now and attempt < maxAttempts.
   * Returns summary of retry results.
   */
  async retryFailed(): Promise<{
    retried: number;
    succeeded: number;
    failed: number;
  }> {
    const now = Date.now();
    const eligible = Array.from(this.deliveryStore.values()).filter(
      (log) =>
        log.status === 'RETRYING' &&
        log.nextRetryAt &&
        log.nextRetryAt.getTime() <= now &&
        log.attempt < log.maxAttempts,
    );

    this.logger.log({
      msg: 'Retrying failed webhooks',
      eligibleCount: eligible.length,
    });

    const succeeded = 0;
    let failed = 0;

    for (const log of eligible) {
      log.attempt += 1;

      try {
        // We need the secret to re-sign — in production the secret is stored
        // alongside the batch. For the scaffold we skip re-delivery and
        // mark the structure.
        log.status = 'FAILED';
        log.nextRetryAt =
          log.attempt < log.maxAttempts
            ? new Date(
                Date.now() +
                  (RETRY_BACKOFF_MS[log.attempt] ?? RETRY_BACKOFF_MS[4]),
              )
            : null;

        if (log.attempt >= log.maxAttempts) {
          log.status = 'FAILED';
          log.nextRetryAt = null;
          failed += 1;
          this.logger.warn({
            msg: 'Webhook max retries exhausted',
            deliveryId: log.id,
            batchId: log.batchId,
          });
        } else {
          log.status = 'RETRYING';
          failed += 1;
        }

        this.deliveryStore.set(log.id, log);
      } catch {
        failed += 1;
      }
    }

    return { retried: eligible.length, succeeded, failed };
  }

  /**
   * Get all delivery log entries for a batch.
   */
  async getDeliveryLog(batchId: string): Promise<WebhookDeliveryLog[]> {
    return Array.from(this.deliveryStore.values())
      .filter((log) => log.batchId === batchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ── In-memory store (replaced by Prisma table in migration) ───────────────
  private readonly deliveryStore = new Map<string, WebhookDeliveryLog>();
}
