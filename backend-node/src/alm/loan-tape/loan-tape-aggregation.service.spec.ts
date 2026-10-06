import {
  LoanTapeAggregationService,
  RECONCILE_TOLERANCE_PCT,
} from './loan-tape-aggregation.service';
import type { PrismaService } from '../../prisma.service';

const AS_OF = new Date('2026-06-30T00:00:00Z');

/** A LoanRecord as Prisma returns it (only the fields the rollup reads). */
function rec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r',
    segmentName: 'Hipotecas',
    balance: 100,
    rate: 0.06,
    maturityDate: new Date('2036-06-30T00:00:00Z'), // ~10y from AS_OF
    delinquencyDays: 0,
    municipio: 'Caguas',
    ...overrides,
  };
}

function makeService(records: unknown[], segments: unknown[] = []) {
  const loanRecord = { findMany: jest.fn().mockResolvedValue(records) };
  const loanSegment = { findMany: jest.fn().mockResolvedValue(segments) };
  // type-rationale: structural prisma double exposing only the two models read
  const svc = new LoanTapeAggregationService({
    loanRecord,
    loanSegment,
  } as unknown as PrismaService);
  return { svc, loanRecord, loanSegment };
}

describe('LoanTapeAggregationService — rollup + reconcile (W2.0)', () => {
  describe('rollUpToSegments', () => {
    it('D1: empty tape → data_unavailable, no silent zeros', async () => {
      const { svc } = makeService([]);
      const r = await svc.rollUpToSegments('inst-1', AS_OF);
      expect(r.status).toBe('data_unavailable');
      expect(r.segments).toEqual([]);
      expect(r.totals.recordCount).toBe(0);
      expect(r.gaps.length).toBeGreaterThan(0);
    });

    it('weighted rate is computed over COVERED records only — a null rate never contributes a phantom 0', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', balance: 100, rate: 0.06 }),
        rec({ id: 'L2', balance: 100, rate: null }), // no rate on the tape
        rec({ id: 'L3', balance: 50, rate: 0.08 }),
      ]);
      const r = await svc.rollUpToSegments('inst-1', AS_OF);
      const seg = r.segments[0];
      // (0.06*100 + 0.08*50) / 150 covered balance = 0.066667 — L2 excluded,
      // NOT averaged in as 0 (which would understate the portfolio rate).
      expect(seg.weightedAvgRate).toBeCloseTo(0.066667, 5);
      expect(seg.rateCoveragePct).toBe(60); // 150 of 250
      // …and the shortfall is disclosed, never imputed.
      expect(r.gaps.some((g) => g.field === 'loanTape.coverage.rate')).toBe(
        true,
      );
    });

    it('none of the segment carries a rate → weightedAvgRate is null (not 0)', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', rate: null }),
        rec({ id: 'L2', rate: null }),
      ]);
      const seg = (await svc.rollUpToSegments('inst-1', AS_OF)).segments[0];
      expect(seg.weightedAvgRate).toBeNull();
      expect(seg.rateCoveragePct).toBe(0);
    });

    it('weighted maturity (years to maturity) is balance-weighted over covered records', async () => {
      const { svc } = makeService([
        rec({
          id: 'L1',
          balance: 100,
          maturityDate: new Date('2036-06-30T00:00:00Z'),
        }), // ~10y
        rec({
          id: 'L3',
          balance: 50,
          maturityDate: new Date('2031-06-30T00:00:00Z'),
        }), // ~5y
        rec({ id: 'L2', balance: 100, maturityDate: null }),
      ]);
      const seg = (await svc.rollUpToSegments('inst-1', AS_OF)).segments[0];
      // (10*100 + 5*50) / 150 ≈ 8.33
      expect(seg.weightedAvgMaturity).toBeCloseTo(8.33, 1);
      expect(seg.maturityCoveragePct).toBe(60);
    });

    it('delinquency bands split covered balance by DPD; full coverage → no gap', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', balance: 100, delinquencyDays: 0 }),
        rec({ id: 'L3', balance: 50, delinquencyDays: 45 }), // 30–59
        rec({ id: 'L2', balance: 100, delinquencyDays: 95 }), // 90+
      ]);
      const r = await svc.rollUpToSegments('inst-1', AS_OF);
      const d = r.segments[0].delinquency;
      expect(d.coveragePct).toBe(100);
      expect(d.balance30to59).toBe(50);
      expect(d.balance60to89).toBe(0);
      expect(d.balance90plus).toBe(100);
      // 100% covered → NO delinquency coverage gap emitted.
      expect(
        r.gaps.some((g) => g.field === 'loanTape.coverage.delinquencyDays'),
      ).toBe(false);
    });

    it('municipio is never imputed — partial coverage surfaces a gap', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', balance: 100, municipio: 'Caguas' }),
        rec({ id: 'L2', balance: 100, municipio: null }),
      ]);
      const r = await svc.rollUpToSegments('inst-1', AS_OF);
      expect(r.segments[0].municipioCoveragePct).toBe(50);
      expect(
        r.gaps.some((g) => g.field === 'loanTape.coverage.municipio'),
      ).toBe(true);
    });

    it('groups by segment, sums totals, and sorts segments by balance desc', async () => {
      const { svc } = makeService([
        rec({ id: 'A1', segmentName: 'Auto', balance: 40 }),
        rec({ id: 'H1', segmentName: 'Hipotecas', balance: 100 }),
        rec({ id: 'H2', segmentName: 'Hipotecas', balance: 60 }),
      ]);
      const r = await svc.rollUpToSegments('inst-1', AS_OF);
      expect(r.totals.recordCount).toBe(3);
      expect(r.totals.balance).toBe(200);
      expect(r.segments.map((s) => s.segmentName)).toEqual([
        'Hipotecas',
        'Auto',
      ]);
      expect(r.segments[0].balance).toBe(160);
    });
  });

  describe('reconcileWithSegments', () => {
    const tape = [rec({ id: 'H1', segmentName: 'Hipotecas', balance: 250 })];

    it('tape within tolerance of the book → within=true, no drift gap', async () => {
      const { svc } = makeService(tape, [
        { segmentName: 'Hipotecas', balance: 250 },
      ]);
      const r = await svc.reconcileWithSegments('inst-1', AS_OF);
      const row = r.rows.find((x) => x.segmentName === 'Hipotecas');
      expect(row?.within).toBe(true);
      expect(row?.deltaPct).toBe(0);
      expect(
        r.gaps.some((g) => g.field.startsWith('loanTape.reconciliation.')),
      ).toBe(false);
    });

    it('tape drift beyond tolerance → within=false + a reconciliation gap', async () => {
      const { svc } = makeService(tape, [
        { segmentName: 'Hipotecas', balance: 300 },
      ]);
      const r = await svc.reconcileWithSegments('inst-1', AS_OF);
      const row = r.rows.find((x) => x.segmentName === 'Hipotecas');
      expect(row?.within).toBe(false);
      expect(Math.abs(row!.deltaPct!)).toBeGreaterThan(RECONCILE_TOLERANCE_PCT);
      expect(
        r.gaps.some((g) => g.field === 'loanTape.reconciliation.Hipotecas'),
      ).toBe(true);
    });

    it('segment present on only one side → gap (tape-only and book-only both flagged)', async () => {
      const { svc } = makeService(
        [rec({ id: 'A1', segmentName: 'Auto', balance: 40 })],
        [{ segmentName: 'Hipotecas', balance: 250 }],
      );
      const r = await svc.reconcileWithSegments('inst-1', AS_OF);
      const auto = r.rows.find((x) => x.segmentName === 'Auto');
      const hip = r.rows.find((x) => x.segmentName === 'Hipotecas');
      expect(auto?.segmentBalance).toBeNull(); // tape-only
      expect(hip?.tapeBalance).toBeNull(); // book-only
      expect(
        r.gaps.filter((g) => g.field.startsWith('loanTape.reconciliation.'))
          .length,
      ).toBeGreaterThanOrEqual(2);
    });

    it('no aggregate book at all → NO_LOAN_SEGMENTS gap, tape stands alone', async () => {
      const { svc } = makeService(tape, []);
      const r = await svc.reconcileWithSegments('inst-1', AS_OF);
      expect(r.gaps.some((g) => g.field === 'loanTape.reconciliation')).toBe(
        true,
      );
    });

    it('D1: empty tape → data_unavailable, does not query the segment book', async () => {
      const { svc, loanSegment } = makeService([]);
      const r = await svc.reconcileWithSegments('inst-1', AS_OF);
      expect(r.status).toBe('data_unavailable');
      expect(loanSegment.findMany).not.toHaveBeenCalled();
    });
  });
});
