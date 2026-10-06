import {
  EWS_COMPOSITE_DROP_ALERT_POINTS,
  EwsSnapshotService,
  type EwsAlert,
} from './ews-snapshot.service';
import type { EWSIndicator, EWSResult } from '../asset-ews.service';

/** Minimal measured indicator. */
function indicator(
  id: string,
  alertLevel: 'green' | 'yellow' | 'red' | 'data_unavailable',
  value: number | null = alertLevel === 'data_unavailable' ? null : 1,
): EWSIndicator {
  return {
    id,
    name: id,
    nameEs: id,
    value,
    trend: 'stable',
    alertLevel,
    weight: 10,
    contribution: alertLevel === 'green' ? 10 : alertLevel === 'yellow' ? 5 : 0,
  };
}

function ewsResult(overrides: Partial<EWSResult> = {}): EWSResult {
  return {
    compositeScore: 80,
    alertLevel: 'GREEN',
    indicators: [indicator('npl_ratio', 'green')],
    topDeteriorating: [],
    peerAlert: '',
    peerAlertEs: '',
    anomalyScore: 0.3,
    status: 'ok',
    ...overrides,
  };
}

/** A persisted prior row, as Prisma would return it. */
function priorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prior-1',
    institutionId: 'inst-1',
    snapshotDate: new Date('2026-07-08T00:00:00Z'),
    computedAt: new Date('2026-07-08T13:00:00Z'),
    compositeScore: 80,
    alertLevel: 'GREEN',
    anomalyScore: 0.3,
    measuredWeight: 57,
    indicators: [indicator('npl_ratio', 'green')],
    gaps: null,
    source: 'scheduled',
    priorSnapshotId: null,
    compositeDelta: null,
    bandTransition: null,
    alertsRaised: null,
    createdAt: new Date('2026-07-08T13:00:00Z'),
    ...overrides,
  };
}

const PINNED_NOW = new Date('2026-07-09T13:00:00Z');

describe('EwsSnapshotService — persist + trend + alert (W1.3)', () => {
  let prisma: {
    ewsSnapshot: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let ews: { computeEWS: jest.Mock };
  let svc: EwsSnapshotService;

  const capture = async (
    result: EWSResult,
    prior: ReturnType<typeof priorRow> | null,
    opts: { source?: 'scheduled' | 'manual' } = {},
  ) => {
    ews.computeEWS.mockResolvedValue(result);
    prisma.ewsSnapshot.findFirst.mockResolvedValue(prior);
    return svc.captureSnapshot('inst-1', opts);
  };

  beforeEach(() => {
    prisma = {
      ewsSnapshot: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve(create)),
      },
    };
    ews = { computeEWS: jest.fn() };
    // type-rationale: structural test doubles for the two injected services
    svc = new EwsSnapshotService(prisma as any, ews as any);
    svc.nowFn = () => PINNED_NOW;
  });

  describe('captureSnapshot', () => {
    it('first capture → no alerts, null trend, persisted with the UTC day key', async () => {
      const { trend, alerts } = await capture(ewsResult(), null);
      expect(alerts).toEqual([]);
      expect(trend).toEqual({
        priorSnapshotId: null,
        compositeDelta: null,
        bandTransition: null,
      });
      const call = prisma.ewsSnapshot.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        institutionId_snapshotDate: {
          institutionId: 'inst-1',
          snapshotDate: new Date('2026-07-09T00:00:00Z'),
        },
      });
      expect(call.create.compositeScore).toBe(80);
      expect(call.create.alertLevel).toBe('GREEN');
      expect(call.create.measuredWeight).toBe(10);
      expect(call.create.source).toBe('manual');
    });

    it('same-day recapture is an upsert (idempotent daily key), not a duplicate insert', async () => {
      await capture(ewsResult(), null, { source: 'scheduled' });
      const call = prisma.ewsSnapshot.upsert.mock.calls[0][0];
      // create and update carry the same payload — a re-run overwrites in place.
      expect(call.update.compositeScore).toBe(call.create.compositeScore);
      expect(call.update.source).toBe('scheduled');
      // prior lookup excludes today (lt, not lte) so a recapture never
      // computes trend against its own earlier run of the same day.
      const findArgs = prisma.ewsSnapshot.findFirst.mock.calls[0][0];
      expect(findArgs.where.snapshotDate).toEqual({
        lt: new Date('2026-07-09T00:00:00Z'),
      });
      expect(findArgs.orderBy).toEqual({ snapshotDate: 'desc' });
    });

    it('band worsening GREEN→YELLOW → warning composite_band_change + bandTransition', async () => {
      const { trend, alerts } = await capture(
        ewsResult({ compositeScore: 60, alertLevel: 'YELLOW' }),
        priorRow(),
      );
      expect(trend.bandTransition).toBe('GREEN→YELLOW');
      const band = alerts.find((a) => a.type === 'composite_band_change');
      expect(band?.severity).toBe('warning');
      expect(band?.from).toBe('GREEN');
      expect(band?.to).toBe('YELLOW');
    });

    it('band worsening into RED → critical', async () => {
      const { alerts } = await capture(
        ewsResult({ compositeScore: 30, alertLevel: 'RED' }),
        priorRow(),
      );
      const band = alerts.find((a) => a.type === 'composite_band_change');
      expect(band?.severity).toBe('critical');
    });

    it('band improvement → info, never warning', async () => {
      const { alerts } = await capture(
        ewsResult({ compositeScore: 80, alertLevel: 'GREEN' }),
        priorRow({ compositeScore: 60, alertLevel: 'YELLOW' }),
      );
      const band = alerts.find((a) => a.type === 'composite_band_change');
      expect(band?.severity).toBe('info');
    });

    it('grading lost (graded → DATA_UNAVAILABLE) → warning, and NO numeric delta (D1)', async () => {
      const { trend, alerts } = await capture(
        ewsResult({
          compositeScore: null,
          alertLevel: 'DATA_UNAVAILABLE',
          status: 'data_unavailable',
          indicators: [indicator('npl_ratio', 'data_unavailable')],
        }),
        priorRow(),
      );
      expect(alerts.some((a) => a.type === 'grading_lost')).toBe(true);
      expect(alerts.some((a) => a.type === 'composite_band_change')).toBe(
        false,
      ); // DATA_UNAVAILABLE is not a band movement
      expect(trend.compositeDelta).toBeNull();
    });

    it('grading restored (DATA_UNAVAILABLE → graded) → info', async () => {
      const { alerts } = await capture(
        ewsResult(),
        priorRow({ compositeScore: null, alertLevel: 'DATA_UNAVAILABLE' }),
      );
      const restored = alerts.find((a) => a.type === 'grading_restored');
      expect(restored?.severity).toBe('info');
      expect(restored?.to).toBe('GREEN');
    });

    it(`composite drop of ${EWS_COMPOSITE_DROP_ALERT_POINTS}+ points → composite_drop alert; smaller drop → none`, async () => {
      const big = await capture(
        ewsResult({ compositeScore: 80 - EWS_COMPOSITE_DROP_ALERT_POINTS }),
        priorRow(),
      );
      expect(big.alerts.some((a) => a.type === 'composite_drop')).toBe(true);
      expect(big.trend.compositeDelta).toBe(-EWS_COMPOSITE_DROP_ALERT_POINTS);

      const small = await capture(
        ewsResult({
          compositeScore: 80 - EWS_COMPOSITE_DROP_ALERT_POINTS + 1,
        }),
        priorRow(),
      );
      expect(small.alerts.some((a) => a.type === 'composite_drop')).toBe(false);
    });

    it('indicator escalation green→red → critical; green→yellow → warning', async () => {
      const { alerts } = await capture(
        ewsResult({
          indicators: [
            indicator('npl_ratio', 'red'),
            indicator('chargeoff_rate', 'yellow'),
          ],
        }),
        priorRow({
          indicators: [
            indicator('npl_ratio', 'green'),
            indicator('chargeoff_rate', 'green'),
          ],
        }),
      );
      const npl = alerts.find(
        (a) =>
          a.type === 'indicator_escalation' && a.indicatorId === 'npl_ratio',
      );
      const chg = alerts.find(
        (a) =>
          a.type === 'indicator_escalation' &&
          a.indicatorId === 'chargeoff_rate',
      );
      expect(npl?.severity).toBe('critical');
      expect(chg?.severity).toBe('warning');
    });

    it('an indicator coming online (data_unavailable → measured) is NOT an escalation (D1)', async () => {
      const { alerts } = await capture(
        ewsResult({ indicators: [indicator('ltv_re', 'red')] }),
        priorRow({ indicators: [indicator('ltv_re', 'data_unavailable')] }),
      );
      expect(alerts.some((a) => a.type === 'indicator_escalation')).toBe(false);
    });

    it('indicator improvement raises no escalation alert', async () => {
      const { alerts } = await capture(
        ewsResult({ indicators: [indicator('npl_ratio', 'green')] }),
        priorRow({ indicators: [indicator('npl_ratio', 'red')] }),
      );
      expect(alerts.some((a) => a.type === 'indicator_escalation')).toBe(false);
    });

    it('gaps from the compute layer are persisted, never dropped', async () => {
      const gaps = [
        {
          field: 'ews.indicator.ltv_re',
          reason: 'INDICATOR_NOT_WIRED',
          severity: 'WARNING',
        },
      ];
      // type-rationale: minimal DataGap literals for a persistence assertion
      await capture(ewsResult({ gaps: gaps as any }), null);
      const call = prisma.ewsSnapshot.upsert.mock.calls[0][0];
      expect(call.create.gaps).toEqual(gaps);
    });
  });

  describe('getTrend / getHistory', () => {
    it('getTrend with no persisted snapshots → data_unavailable + gap (D1, no throw)', async () => {
      prisma.ewsSnapshot.findMany.mockResolvedValue([]);
      const view = await svc.getTrend('inst-1');
      expect(view.status).toBe('data_unavailable');
      expect(view.latest).toBeNull();
      expect(view.gaps?.[0].reason).toBe('EWS_INPUTS_INSUFFICIENT');
    });

    it('getTrend returns latest + prior + the stored trend and alerts', async () => {
      const alerts: EwsAlert[] = [
        {
          type: 'composite_band_change',
          severity: 'warning',
          from: 'GREEN',
          to: 'YELLOW',
          message: 'x / y',
        },
      ];
      const latest = priorRow({
        id: 'latest-1',
        snapshotDate: new Date('2026-07-09T00:00:00Z'),
        compositeScore: 60,
        alertLevel: 'YELLOW',
        priorSnapshotId: 'prior-1',
        compositeDelta: -20,
        bandTransition: 'GREEN→YELLOW',
        alertsRaised: alerts,
      });
      prisma.ewsSnapshot.findMany.mockResolvedValue([latest, priorRow()]);
      const view = await svc.getTrend('inst-1');
      expect(view.status).toBe('ok');
      expect(view.trend).toEqual({
        priorSnapshotId: 'prior-1',
        compositeDelta: -20,
        bandTransition: 'GREEN→YELLOW',
      });
      expect(view.alerts).toEqual(alerts);
      expect(view.prior?.id).toBe('prior-1');
    });

    it('getHistory queries newest-first with the requested limit', async () => {
      prisma.ewsSnapshot.findMany.mockResolvedValue([]);
      await svc.getHistory('inst-1', 30);
      expect(prisma.ewsSnapshot.findMany).toHaveBeenCalledWith({
        where: { institutionId: 'inst-1' },
        orderBy: { snapshotDate: 'desc' },
        take: 30,
      });
    });
  });
});
