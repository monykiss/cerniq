import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  RateAlert,
  RateAlertThreshold,
  SetThresholdParams,
  SetThresholdParamsSchema,
} from './realtime-alm.dto';

@Injectable()
export class RateAlertService {
  private readonly logger = new Logger(RateAlertService.name);

  /**
   * In-memory threshold store, keyed by `${institutionId}:${metric}`.
   * Persisted to the database when the threshold table exists.
   */
  private readonly thresholds = new Map<string, RateAlertThreshold>();

  /** Active (un-cleared) alerts, keyed by `${institutionId}:${metric}:${level}`. */
  private readonly activeAlerts = new Map<string, RateAlert>();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Threshold CRUD ────────────────────────────────────────

  /**
   * Return all configured thresholds for an institution.
   */
  async getThresholds(institutionId: string): Promise<RateAlertThreshold[]> {
    // Try DB first
    try {
      const rows = await (this.prisma as any).rateAlertThreshold?.findMany({
        where: { institutionId },
      });
      if (rows && rows.length > 0) return rows;
    } catch {
      /* table may not exist */
    }

    // Fallback to in-memory
    const results: RateAlertThreshold[] = [];
    for (const [key, t] of this.thresholds) {
      if (key.startsWith(`${institutionId}:`)) results.push(t);
    }
    return results;
  }

  /**
   * Create or update an alert threshold for a specific metric.
   */
  async setThreshold(
    institutionId: string,
    params: SetThresholdParams,
  ): Promise<RateAlertThreshold> {
    const validated = SetThresholdParamsSchema.parse(params);
    const key = `${institutionId}:${validated.metric}`;
    const now = new Date().toISOString();

    const threshold: RateAlertThreshold = {
      institutionId,
      metric: validated.metric,
      warnLevel: validated.warnLevel,
      breachLevel: validated.breachLevel,
      direction: validated.direction,
      notifyEmail: validated.notifyEmail ?? false,
      notifyWebhook: validated.notifyWebhook ?? false,
      createdAt: this.thresholds.get(key)?.createdAt ?? now,
      updatedAt: now,
    };

    this.thresholds.set(key, threshold);

    // Best-effort DB persistence
    try {
      const table = (this.prisma as any).rateAlertThreshold;
      if (table) {
        await table.upsert({
          where: {
            institutionId_metric: { institutionId, metric: validated.metric },
          },
          create: threshold,
          update: threshold,
        });
      }
    } catch {
      /* table may not exist */
    }

    this.logger.log(
      `Threshold set: ${key} → WARN=${validated.warnLevel} BREACH=${validated.breachLevel} (${validated.direction})`,
    );
    return threshold;
  }

  /**
   * Remove a threshold for a specific metric.
   */
  async removeThreshold(institutionId: string, metric: string): Promise<void> {
    const key = `${institutionId}:${metric}`;
    this.thresholds.delete(key);

    // Clear any related active alerts
    this.activeAlerts.delete(`${key}:WARN`);
    this.activeAlerts.delete(`${key}:BREACH`);

    // Best-effort DB deletion
    try {
      const table = (this.prisma as any).rateAlertThreshold;
      if (table) {
        await table.deleteMany({ where: { institutionId, metric } });
      }
    } catch {
      /* table may not exist */
    }

    this.logger.log(`Threshold removed: ${key}`);
  }

  // ─── Alert Evaluation ──────────────────────────────────────

  /**
   * Check a map of metric→value against configured thresholds
   * and return any alerts that fire.
   */
  async checkThresholds(
    institutionId: string,
    metrics: Record<string, number>,
  ): Promise<RateAlert[]> {
    const thresholds = await this.getThresholds(institutionId);
    const alerts: RateAlert[] = [];

    for (const t of thresholds) {
      const currentValue = metrics[t.metric];
      if (currentValue === undefined) continue;

      const breached = this.isBreached(
        currentValue,
        t.breachLevel,
        t.direction,
      );
      const warned = this.isBreached(currentValue, t.warnLevel, t.direction);

      if (breached) {
        const alert = this.buildAlert(
          t.metric,
          'BREACH',
          currentValue,
          t.breachLevel,
          t.direction,
        );
        alerts.push(alert);
        this.activeAlerts.set(`${institutionId}:${t.metric}:BREACH`, alert);
      } else if (warned) {
        const alert = this.buildAlert(
          t.metric,
          'WARN',
          currentValue,
          t.warnLevel,
          t.direction,
        );
        alerts.push(alert);
        this.activeAlerts.set(`${institutionId}:${t.metric}:WARN`, alert);
      } else {
        // Clear alerts if back within thresholds
        this.activeAlerts.delete(`${institutionId}:${t.metric}:WARN`);
        this.activeAlerts.delete(`${institutionId}:${t.metric}:BREACH`);
      }
    }

    return alerts;
  }

  /**
   * Return all currently active (un-cleared) alerts for an institution.
   */
  async getActiveAlerts(institutionId: string): Promise<RateAlert[]> {
    const results: RateAlert[] = [];
    for (const [key, alert] of this.activeAlerts) {
      if (key.startsWith(`${institutionId}:`)) results.push(alert);
    }
    return results;
  }

  // ─── Internals ─────────────────────────────────────────────

  private isBreached(
    value: number,
    level: number,
    direction: 'ABOVE' | 'BELOW',
  ): boolean {
    return direction === 'ABOVE' ? value >= level : value <= level;
  }

  private buildAlert(
    metric: string,
    level: 'WARN' | 'BREACH',
    currentValue: number,
    threshold: number,
    direction: 'ABOVE' | 'BELOW',
  ): RateAlert {
    const dirLabel = direction === 'ABOVE' ? 'exceeded' : 'dropped below';
    const dirLabelEs = direction === 'ABOVE' ? 'excedio' : 'cayo por debajo de';
    const levelLabel = level === 'BREACH' ? 'BREACH' : 'WARNING';
    const levelLabelEs = level === 'BREACH' ? 'ALERTA CRITICA' : 'ADVERTENCIA';

    return {
      metric,
      level,
      currentValue,
      threshold,
      direction,
      message: `${levelLabel}: ${metric} ${dirLabel} threshold (${currentValue.toFixed(4)} vs ${threshold.toFixed(4)})`,
      messageEs: `${levelLabelEs}: ${metric} ${dirLabelEs} el umbral (${currentValue.toFixed(4)} vs ${threshold.toFixed(4)})`,
    };
  }
}
