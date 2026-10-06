import { Injectable, Logger } from '@nestjs/common';

/**
 * Slack notification service for sales alerts.
 * Sends webhook messages to a Slack channel when key events happen:
 * - New lead submitted
 * - Demo completed
 * - Checkout started/completed
 * - High-priority lead detected
 * - Prospect outreach sent
 *
 * Set SLACK_WEBHOOK_URL env var to enable.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly webhookUrl = process.env.SLACK_WEBHOOK_URL;

  async sendAlert(alert: {
    type:
      | 'new_lead'
      | 'demo_completed'
      | 'checkout_started'
      | 'checkout_completed'
      | 'hot_lead'
      | 'outreach_sent';
    title: string;
    details: Record<string, string | number | null>;
    urgency?: 'low' | 'medium' | 'high';
  }): Promise<boolean> {
    if (!this.webhookUrl) {
      this.logger.debug(
        `Slack alert skipped (no SLACK_WEBHOOK_URL): ${alert.type}`,
      );
      return false;
    }

    const emoji: Record<string, string> = {
      new_lead: ':inbox_tray:',
      demo_completed: ':tada:',
      checkout_started: ':credit_card:',
      checkout_completed: ':money_with_wings:',
      hot_lead: ':fire:',
      outreach_sent: ':envelope:',
    };

    const color: Record<string, string> = {
      low: '#36a64f',
      medium: '#daa520',
      high: '#ff0000',
    };

    const fields = Object.entries(alert.details)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => ({
        title: k
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (s: string) => s.toUpperCase()),
        value: String(v),
        short: String(v).length < 30,
      }));

    const payload = {
      text: `${emoji[alert.type] || ':bell:'} *${alert.title}*`,
      attachments: [
        {
          color: color[alert.urgency || 'low'],
          fields,
          footer: 'CERNIQ Sales Engine',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(`Slack webhook failed: ${response.status}`);
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.warn(`Slack webhook error: ${err.message}`);
      return false;
    }
  }

  // Convenience methods for common alerts

  async notifyNewLead(lead: {
    name: string;
    email: string;
    institution: string;
    type: string;
    priority: string;
  }) {
    return this.sendAlert({
      type: 'new_lead',
      title: `New Lead: ${lead.institution}`,
      details: {
        Name: lead.name,
        Email: lead.email,
        Institution: lead.institution,
        Type: lead.type,
        Priority: lead.priority,
      },
      urgency:
        lead.priority === 'HIGH'
          ? 'high'
          : lead.priority === 'MEDIUM'
            ? 'medium'
            : 'low',
    });
  }

  async notifyCheckoutCompleted(data: {
    email: string;
    institution: string;
    tier: string;
    amount: number;
  }) {
    return this.sendAlert({
      type: 'checkout_completed',
      title: `Payment Received: ${data.institution}`,
      details: {
        Email: data.email,
        Institution: data.institution,
        Tier: data.tier,
        Amount: `$${data.amount}`,
      },
      urgency: 'high',
    });
  }

  async notifyHotLead(data: {
    name: string;
    institution: string;
    score: number;
    reason: string;
  }) {
    return this.sendAlert({
      type: 'hot_lead',
      title: `HOT Lead Detected: ${data.institution} (Score: ${data.score})`,
      details: {
        Name: data.name,
        Institution: data.institution,
        Score: data.score,
        Reason: data.reason,
      },
      urgency: 'high',
    });
  }
}
