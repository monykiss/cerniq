import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type EwsSnapshot } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  AssetEWSService,
  type EWSIndicator,
  type EWSResult,
} from '../asset-ews.service';
import { DataGap, dataGap } from '../reports/data-gap';

/**
 * EWS persistence + trend + alert layer (Wave 1, W1.3).
 *
 * `AssetEWSService.computeEWS` is an on-demand number; this service turns it
 * into a product surface (roadmap W1.3): one persisted snapshot per
 * institution per DAY (idempotent upsert — a re-run updates, never
 * duplicates), a trend delta vs the prior snapshot, and threshold-crossing
 * alerts a board can act on.
 *
 * D1 throughout:
 *   - a composite the compute layer refused to grade persists honestly as
 *     `compositeScore: null` + `DATA_UNAVAILABLE` — history never backfills
 *     a fabricated score;
 *   - DATA_UNAVAILABLE is never compared numerically — grading loss and
 *     restoration are their own alert types, not deltas;
 *   - an indicator only raises an escalation alert when it was MEASURED in
 *     both snapshots (an unwired indicator coming online is not a
 *     deterioration);
 *   - the compute layer's gaps ride along on the persisted row, never
 *     dropped.
 *
 * `nowFn` is the same public test seam as PrMacroFeedService — specs pin it
 * for deterministic snapshot dates; production uses real time.
 */

/** Composite-score drop (points, day over day) that raises an alert. DISCLOSED config. */
export const EWS_COMPOSITE_DROP_ALERT_POINTS = 10;

export interface EwsAlert {
  type:
    | 'composite_band_change'
    | 'grading_lost'
    | 'grading_restored'
    | 'indicator_escalation'
    | 'composite_drop';
  severity: 'info' | 'warning' | 'critical';
  indicatorId?: string;
  from: string;
  to: string;
  /** Bilingual (es / en), matching the repo's disclosure convention. */
  message: string;
}

export interface EwsTrend {
  priorSnapshotId: string | null;
  compositeDelta: number | null;
  bandTransition: string | null;
}

export interface EwsCaptureResult {
  snapshot: EwsSnapshot;
  result: EWSResult;
  trend: EwsTrend;
  alerts: EwsAlert[];
}

export interface EwsTrendView {
  status: 'ok' | 'data_unavailable';
  latest: EwsSnapshot | null;
  prior: EwsSnapshot | null;
  trend: EwsTrend | null;
  alerts: EwsAlert[];
  gaps?: DataGap[];
}

/** Band severity rank for worsening detection (composite level). */
const BAND_RANK: Record<string, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
/** Indicator-level rank (lowercase variant used by EWSIndicator). */
const INDICATOR_RANK: Record<string, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

@Injectable()
export class EwsSnapshotService {
  private readonly logger = new Logger(EwsSnapshotService.name);

  /** Test seam: pin for deterministic snapshot dates (specs). */
  nowFn: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ews: AssetEWSService,
  ) {}

  /**
   * Compute the EWS now and persist it as today's snapshot (UTC calendar
   * day). Idempotent per day: a second capture the same day overwrites the
   * row in place — the unique (institutionId, snapshotDate) key is the
   * dedup, so a manual capture and the scheduled one never double-count.
   */
  async captureSnapshot(
    institutionId: string,
    opts: { source?: 'scheduled' | 'manual' } = {},
  ): Promise<EwsCaptureResult> {
    const result = await this.ews.computeEWS(institutionId);
    const snapshotDate = this.utcDay(this.nowFn());

    const prior = await this.prisma.ewsSnapshot.findFirst({
      where: { institutionId, snapshotDate: { lt: snapshotDate } },
      orderBy: { snapshotDate: 'desc' },
    });

    const { trend, alerts } = this.detectTrendAndAlerts(prior, result);

    const measuredWeight = result.indicators
      .filter((i) => i.value !== null)
      .reduce((s, i) => s + i.weight, 0);

    const common = {
      computedAt: this.nowFn(),
      compositeScore: result.compositeScore,
      alertLevel: result.alertLevel,
      anomalyScore: result.anomalyScore,
      measuredWeight,
      // type-rationale: EWSIndicator[]/DataGap[]/EwsAlert[] are plain JSON
      // shapes persisted verbatim; Prisma's InputJsonValue is the storage type
      indicators: result.indicators as unknown as Prisma.InputJsonValue,
      gaps: result.gaps
        ? (result.gaps as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      source: opts.source ?? 'manual',
      priorSnapshotId: trend.priorSnapshotId,
      compositeDelta: trend.compositeDelta,
      bandTransition: trend.bandTransition,
      alertsRaised:
        alerts.length > 0
          ? (alerts as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    };

    const snapshot = await this.prisma.ewsSnapshot.upsert({
      where: {
        institutionId_snapshotDate: { institutionId, snapshotDate },
      },
      create: { institutionId, snapshotDate, ...common },
      update: common,
    });

    if (alerts.length > 0) {
      this.logger.warn({
        event: 'ews_alerts_raised',
        institutionId,
        alertCount: alerts.length,
        critical: alerts.filter((a) => a.severity === 'critical').length,
        bandTransition: trend.bandTransition,
      });
    }

    return { snapshot, result, trend, alerts };
  }

  /** Persisted snapshot history, newest first. */
  async getHistory(institutionId: string, limit = 90): Promise<EwsSnapshot[]> {
    return this.prisma.ewsSnapshot.findMany({
      where: { institutionId },
      orderBy: { snapshotDate: 'desc' },
      take: limit,
    });
  }

  /**
   * Latest snapshot + its stored trend/alerts, with the prior row for
   * context. D1: no history → an honest data_unavailable view with a gap,
   * never a throw and never an empty-but-OK shape.
   */
  async getTrend(institutionId: string): Promise<EwsTrendView> {
    const rows = await this.prisma.ewsSnapshot.findMany({
      where: { institutionId },
      orderBy: { snapshotDate: 'desc' },
      take: 2,
    });

    if (rows.length === 0) {
      return {
        status: 'data_unavailable',
        latest: null,
        prior: null,
        trend: null,
        alerts: [],
        gaps: [
          dataGap('ews.history', 'EWS_INPUTS_INSUFFICIENT', {
            severity: 'WARNING',
            action:
              'Aún no hay snapshots EWS persistidos — ejecute una captura (POST /ews/snapshot) o espere la corrida diaria programada. / No persisted EWS snapshots yet — run a capture (POST /ews/snapshot) or wait for the scheduled daily run.',
            context: { institutionId },
          }),
        ],
      };
    }

    const latest = rows[0];
    return {
      status: 'ok',
      latest,
      prior: rows[1] ?? null,
      trend: {
        priorSnapshotId: latest.priorSnapshotId,
        compositeDelta: latest.compositeDelta,
        bandTransition: latest.bandTransition,
      },
      // type-rationale: alertsRaised is our own EwsAlert[] JSON round-tripped
      // through Prisma's JsonValue storage type
      alerts: (latest.alertsRaised as unknown as EwsAlert[] | null) ?? [],
    };
  }

  // ─── internals ───

  private detectTrendAndAlerts(
    prior: EwsSnapshot | null,
    current: EWSResult,
  ): { trend: EwsTrend; alerts: EwsAlert[] } {
    if (!prior) {
      return {
        trend: {
          priorSnapshotId: null,
          compositeDelta: null,
          bandTransition: null,
        },
        alerts: [],
      };
    }

    const alerts: EwsAlert[] = [];
    const priorLevel = prior.alertLevel as string;
    const curLevel = current.alertLevel;
    const priorGraded = priorLevel !== 'DATA_UNAVAILABLE';
    const curGraded = curLevel !== 'DATA_UNAVAILABLE';

    const bandTransition =
      priorLevel !== curLevel ? `${priorLevel}→${curLevel}` : null;

    // ── Composite band movement (both graded) ──
    if (priorGraded && curGraded && bandTransition) {
      const worsened = BAND_RANK[curLevel] > BAND_RANK[priorLevel];
      alerts.push({
        type: 'composite_band_change',
        severity: worsened
          ? curLevel === 'RED'
            ? 'critical'
            : 'warning'
          : 'info',
        from: priorLevel,
        to: curLevel,
        message: worsened
          ? `La banda compuesta EWS empeoró ${priorLevel}→${curLevel} — revise los indicadores en deterioro. / The EWS composite band worsened ${priorLevel}→${curLevel} — review the deteriorating indicators.`
          : `La banda compuesta EWS mejoró ${priorLevel}→${curLevel}. / The EWS composite band improved ${priorLevel}→${curLevel}.`,
      });
    }

    // ── Grading lost / restored (D1: never a numeric comparison) ──
    if (priorGraded && !curGraded) {
      alerts.push({
        type: 'grading_lost',
        severity: 'warning',
        from: priorLevel,
        to: 'DATA_UNAVAILABLE',
        message:
          'El EWS dejó de poder calificarse (datos insuficientes) — el pipeline de datos se degradó desde la última captura. / The EWS can no longer be graded (insufficient data) — the data pipeline degraded since the last capture.',
      });
    } else if (!priorGraded && curGraded) {
      alerts.push({
        type: 'grading_restored',
        severity: 'info',
        from: 'DATA_UNAVAILABLE',
        to: curLevel,
        message: `El EWS vuelve a calificarse (${curLevel}). / The EWS is gradable again (${curLevel}).`,
      });
    }

    // ── Composite point drop (both scores present) ──
    const compositeDelta =
      prior.compositeScore !== null && current.compositeScore !== null
        ? current.compositeScore - prior.compositeScore
        : null;
    if (
      compositeDelta !== null &&
      compositeDelta <= -EWS_COMPOSITE_DROP_ALERT_POINTS
    ) {
      alerts.push({
        type: 'composite_drop',
        severity: 'warning',
        from: String(prior.compositeScore),
        to: String(current.compositeScore),
        message: `El puntaje compuesto EWS cayó ${-compositeDelta} puntos (umbral divulgado: ${EWS_COMPOSITE_DROP_ALERT_POINTS}). / The EWS composite score dropped ${-compositeDelta} points (disclosed threshold: ${EWS_COMPOSITE_DROP_ALERT_POINTS}).`,
      });
    }

    // ── Per-indicator escalations (measured in BOTH snapshots only) ──
    const priorIndicators = this.parseIndicators(prior.indicators);
    for (const cur of current.indicators) {
      const prev = priorIndicators.find((p) => p.id === cur.id);
      if (!prev) continue;
      const prevRank = INDICATOR_RANK[prev.alertLevel];
      const curRank = INDICATOR_RANK[cur.alertLevel];
      // data_unavailable on either side is not in the rank map → skipped:
      // an indicator coming online (or going dark) is not an escalation.
      if (prevRank === undefined || curRank === undefined) continue;
      if (curRank > prevRank) {
        alerts.push({
          type: 'indicator_escalation',
          severity: cur.alertLevel === 'red' ? 'critical' : 'warning',
          indicatorId: cur.id,
          from: prev.alertLevel,
          to: cur.alertLevel,
          message: `"${cur.nameEs}" escaló ${prev.alertLevel}→${cur.alertLevel} (valor ${cur.value}). / "${cur.name}" escalated ${prev.alertLevel}→${cur.alertLevel} (value ${cur.value}).`,
        });
      }
    }

    return {
      trend: {
        priorSnapshotId: prior.id,
        compositeDelta,
        bandTransition,
      },
      alerts,
    };
  }

  /** Narrow the persisted JSON back to EWSIndicator[] (shape we wrote). */
  private parseIndicators(raw: Prisma.JsonValue): EWSIndicator[] {
    if (!Array.isArray(raw)) return [];
    // type-rationale: round-tripping our own persisted EWSIndicator[] JSON;
    // Array.isArray is the structural guard
    return raw as unknown as EWSIndicator[];
  }

  /** UTC calendar day of a timestamp (the daily idempotency key). */
  private utcDay(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }
}
