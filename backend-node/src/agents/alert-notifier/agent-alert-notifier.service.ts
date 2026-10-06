import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../../email/email.service';
import {
  AgentEventBusService,
  AGENT_EVENT,
} from '../runner/agent-event-bus.service';

// AgentAlertNotifierService listens for completed Risk Monitor runs and
// emails the CFO on every CRITICAL or HIGH alert. This is the regulatory-
// grade notification pipeline (Vol.3 Sprint 2 Day 9): a cooperativa CFO
// must be alerted within minutes when a liquidity breach or capital erosion
// is detected.
//
// Architecture:
//   RUN_COMPLETED event → query new alerts for that run → filter severity
//   → send bilingual email per alert via Resend (existing EmailService)
//
// We subscribe via AgentEventBusService (in-process EventEmitter) which is
// advisory — a lost event means the email doesn't fire on that specific
// run, but the alert is persisted in the DB and visible in the dashboard.
// The Risk Monitor's daily cadence means the next scan will re-emit if the
// condition persists and the dedup key hasn't changed.
//
// Future: Slack/webhook integration, configurable severity thresholds per
// institution, digest mode (daily summary instead of per-alert).

@Injectable()
export class AgentAlertNotifierService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AgentAlertNotifierService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly bus: AgentEventBusService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.bus.on(
      AGENT_EVENT.RUN_COMPLETED,
      (payload: unknown) => {
        const p = payload as { runId?: string } | undefined;
        if (p?.runId) {
          this.onRunCompleted(p.runId).catch((err) =>
            this.logger.error(
              `alert notification failed for run ${p.runId}`,
              err,
            ),
          );
        }
      },
    );
    this.logger.log('Alert notifier subscribed to RUN_COMPLETED events');
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  async onRunCompleted(runId: string): Promise<void> {
    const alerts = await this.prisma.agentAlert.findMany({
      where: {
        runId,
        severity: { in: ['CRITICAL', 'HIGH'] },
        status: 'OPEN',
      },
      orderBy: { severity: 'asc' },
    });

    if (alerts.length === 0) return;

    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { institutionId: true, agentId: true },
    });
    if (!run?.institutionId) return;

    const institution = await this.prisma.institution.findUnique({
      where: { id: run.institutionId },
      select: {
        name: true,
        contactEmail: true,
        contactName: true,
        preferredLanguage: true,
        workspace: {
          select: { owner: { select: { email: true, name: true } } },
        },
      },
    });
    if (!institution) return;

    const recipientEmail =
      institution.contactEmail ?? institution.workspace?.owner?.email;
    if (!recipientEmail) {
      this.logger.warn(
        `no email for institution ${run.institutionId} — skipping alert notification`,
      );
      return;
    }

    const recipientName =
      institution.contactName ?? institution.workspace?.owner?.name ?? 'CFO';
    const lang = institution.preferredLanguage ?? 'es';

    for (const alert of alerts) {
      await this.sendAlertEmail({
        to: recipientEmail,
        name: recipientName,
        institutionName: institution.name,
        language: lang,
        severity: String(alert.severity),
        metric: alert.metric,
        finding: alert.finding,
        findingEs: alert.findingEs ?? alert.finding,
        recommendation: alert.recommendation,
        regulatoryRef: alert.regulatoryRef,
        alertId: alert.id,
      });

      // notifiedAt column pending schema migration — for now the email
      // send is logged and the alert's updatedAt auto-stamps on any write.
      this.logger.debug(`notified ${recipientEmail} for alert ${alert.id}`);
    }

    this.logger.log(
      `sent ${alerts.length} alert email(s) for run ${runId} to ${recipientEmail}`,
    );
  }

  private async sendAlertEmail(data: {
    to: string;
    name: string;
    institutionName: string;
    language: string;
    severity: string;
    metric: string;
    finding: string;
    findingEs: string;
    recommendation: string;
    regulatoryRef: string | null;
    alertId: string;
  }): Promise<void> {
    const isCritical = data.severity === 'CRITICAL';
    const severityColor = isCritical ? '#DC2626' : '#F59E0B';
    const severityLabel = isCritical ? 'CRITICA / CRITICAL' : 'ALTA / HIGH';
    const frontendUrl = (
      process.env.FRONTEND_URL || 'https://cerniq.io'
    ).replace(/\/+$/, '');
    const dashboardUrl = `${frontendUrl}/agents/alerts`;

    // Deterministic dispatch: prefer EmailService.sendAgentAlert when it
    // exists, otherwise fall back to the inline Resend path. The previous
    // `await X?.() ?? fallback` form would double-send if sendAgentAlert
    // resolves to `undefined` (the idiomatic return of a send helper),
    // because `undefined ?? fallback` then fires fallback as well.
    const agentAlertFn = (
      this.email as {
        sendAgentAlert?: (payload: {
          to: string;
          severity: string;
          metric: string;
          finding: string;
          recommendation: string;
          institutionName: string;
          dashboardUrl: string;
        }) => Promise<unknown>;
      }
    ).sendAgentAlert;
    if (typeof agentAlertFn === 'function') {
      await agentAlertFn.call(this.email, {
        to: data.to,
        severity: data.severity,
        metric: data.metric,
        finding: data.finding,
        recommendation: data.recommendation,
        institutionName: data.institutionName,
        dashboardUrl,
      });
      return;
    }
    await this.sendViaResendDirect(data, {
      severityColor,
      severityLabel,
      dashboardUrl,
    });
  }

  private async sendViaResendDirect(
    data: {
      to: string;
      name: string;
      institutionName: string;
      language: string;
      severity: string;
      metric: string;
      finding: string;
      findingEs: string;
      recommendation: string;
      regulatoryRef: string | null;
      alertId: string;
    },
    ui: { severityColor: string; severityLabel: string; dashboardUrl: string },
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.log(
        `[DRY RUN] Alert email to ${data.to}: ${data.severity} — ${data.metric}`,
      );
      return;
    }

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const regRef = data.regulatoryRef
      ? `<p style="margin-top:8px;font-size:12px;color:#64748B;">Ref: ${data.regulatoryRef}</p>`
      : '';

    await resend.emails.send({
      from: `CERNIQ Alerts <alerts@${process.env.EMAIL_FROM_DOMAIN || 'example.com'}>`,
      ...(process.env.OPS_NOTIFY_EMAIL
        ? { replyTo: process.env.OPS_NOTIFY_EMAIL }
        : {}),
      to: data.to,
      subject: `⚠ ${data.severity} — ${data.metric} — ${data.institutionName}`,
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Georgia,serif;">
<div style="max-width:580px;margin:0 auto;">
  <div style="background:#1B3A6B;padding:24px 32px;border-radius:8px 8px 0 0;">
    <span style="color:#FFFFFF;font-size:22px;font-weight:bold;">CERNIQ</span>
    <span style="color:${ui.severityColor};font-size:13px;margin-left:12px;font-weight:bold;">
      ■ ALERTA ${ui.severityLabel}
    </span>
  </div>
  <div style="background:#FFF;padding:32px;border:1px solid #E2E8F0;border-top:none;line-height:1.7;color:#1E293B;font-size:15px;">
    <p style="margin-top:0;">Hola ${data.name},</p>
    <p>Se ha detectado una alerta de severidad <strong style="color:${ui.severityColor}">${data.severity}</strong>
    para <strong>${data.institutionName}</strong>.</p>

    <div style="background:#FEF2F2;border-left:4px solid ${ui.severityColor};padding:16px;margin:16px 0;border-radius:4px;">
      <strong>Métrica:</strong> ${data.metric}<br>
      <strong>Hallazgo:</strong> ${data.findingEs}
    </div>

    <p><strong>Recomendación:</strong> ${data.recommendation}</p>
    ${regRef}

    <hr style="border:none;border-top:2px solid #E2E8F0;margin:24px 0;">

    <p>Hi ${data.name},</p>
    <p>A <strong style="color:${ui.severityColor}">${data.severity}</strong> severity alert
    has been detected for <strong>${data.institutionName}</strong>.</p>

    <div style="background:#FEF2F2;border-left:4px solid ${ui.severityColor};padding:16px;margin:16px 0;border-radius:4px;">
      <strong>Metric:</strong> ${data.metric}<br>
      <strong>Finding:</strong> ${data.finding}
    </div>

    <p><strong>Recommendation:</strong> ${data.recommendation}</p>
    ${regRef}

    <div style="margin:28px 0;text-align:center;">
      <a href="${ui.dashboardUrl}" style="background:#E8A020;color:#FFF;padding:16px 36px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
        Ver en el panel / View in dashboard
      </a>
    </div>
  </div>
  <div style="background:#F1F5F9;padding:16px 32px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0;border-top:none;">
    <p style="margin:0;font-size:11px;color:#64748B;">
      CERNIQ &middot; KLYTICS LLC &middot; San Juan, Puerto Rico &middot; alerts@cerniq.io
    </p>
  </div>
</div>
</body></html>`,
    });
  }
}
