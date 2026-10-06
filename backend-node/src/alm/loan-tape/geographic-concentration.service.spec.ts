import {
  CONCENTRATION_TOP_N,
  GeographicConcentrationService,
} from './geographic-concentration.service';
import type { PrismaService } from '../../prisma.service';

const AS_OF = new Date('2026-06-30T00:00:00Z');

function rec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r',
    balance: 100,
    municipio: 'Caguas',
    borrowerId: 'B-1',
    ...overrides,
  };
}

function makeService(records: unknown[]) {
  const loanRecord = { findMany: jest.fn().mockResolvedValue(records) };
  // type-rationale: structural prisma double exposing only loanRecord.findMany
  const svc = new GeographicConcentrationService({
    loanRecord,
  } as unknown as PrismaService);
  return { svc, loanRecord };
}

describe('GeographicConcentrationService — municipio + single-borrower (W2.2)', () => {
  it('D1: no loan tape → data_unavailable, nothing fabricated', async () => {
    const { svc } = makeService([]);
    const r = await svc.analyze('inst-1', AS_OF);
    expect(r.status).toBe('data_unavailable');
    expect(r.municipio.hhi).toBeNull();
    expect(r.singleBorrower.largestSharePct).toBeNull();
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  describe('municipio concentration', () => {
    it('computes HHI over covered shares and interprets the band', async () => {
      // 60/40 split across two municipios → HHI = 60^2 + 40^2 = 5200 (highly).
      const { svc } = makeService([
        rec({ id: 'L1', municipio: 'Caguas', balance: 60 }),
        rec({ id: 'L2', municipio: 'Ponce', balance: 40 }),
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.municipio.coveragePct).toBe(100);
      expect(r.municipio.hhi).toBe(5200);
      expect(r.municipio.hhiInterpretation).toBe('highly_concentrated');
      expect(r.municipio.largestSharePct).toBe(60);
      expect(r.municipio.distinctMunicipios).toBe(2);
      expect(r.municipio.exposures[0].municipio).toBe('Caguas');
    });

    it('a well-spread book reads as unconcentrated', async () => {
      // 10 equal municipios → HHI = 10 * 10^2 = 1000 (< 1500).
      const recs = Array.from({ length: 10 }, (_, i) =>
        rec({ id: `L${i}`, municipio: `M${i}`, balance: 100 }),
      );
      const r = await (await makeService(recs)).svc.analyze('inst-1', AS_OF);
      expect(r.municipio.hhi).toBe(1000);
      expect(r.municipio.hhiInterpretation).toBe('unconcentrated');
    });

    it('D1 HAZARD: no loan carries a municipio → HHI null + gap, NEVER a diversified 0', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', municipio: null, balance: 100 }),
        rec({ id: 'L2', municipio: null, balance: 100 }),
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.status).toBe('ok'); // records exist…
      expect(r.municipio.hhi).toBeNull(); // …but geography is unmeasurable
      expect(r.municipio.coveragePct).toBe(0);
      expect(r.gaps.some((g) => g.field === 'concentration.municipio')).toBe(
        true,
      );
    });

    it('partial municipio coverage → HHI over covered only + a coverage gap (never imputed)', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', municipio: 'Caguas', balance: 100 }),
        rec({ id: 'L2', municipio: null, balance: 100 }), // uncovered
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.municipio.coveragePct).toBe(50);
      // covered book is 100% Caguas → HHI 10000, NOT diluted by the null loan.
      expect(r.municipio.hhi).toBe(10000);
      expect(
        r.gaps.some((g) => g.field === 'concentration.municipio.coverage'),
      ).toBe(true);
    });

    it('caps exposures at CONCENTRATION_TOP_N and flags truncation', async () => {
      const recs = Array.from({ length: CONCENTRATION_TOP_N + 5 }, (_, i) =>
        rec({ id: `L${i}`, municipio: `M${i}`, balance: 100 + i }),
      );
      const r = await (await makeService(recs)).svc.analyze('inst-1', AS_OF);
      expect(r.municipio.exposures).toHaveLength(CONCENTRATION_TOP_N);
      expect(r.municipio.truncated).toBe(true);
      expect(r.municipio.distinctMunicipios).toBe(CONCENTRATION_TOP_N + 5);
    });
  });

  describe('single-borrower concentration', () => {
    it('aggregates multiple loans to one borrower and reports the largest share', async () => {
      // B-1 has two loans (60+30=90 of 150 covered = 60%); B-2 one (60 → 40%).
      const { svc } = makeService([
        rec({ id: 'L1', borrowerId: 'B-1', balance: 60, municipio: 'Caguas' }),
        rec({ id: 'L2', borrowerId: 'B-1', balance: 30, municipio: 'Caguas' }),
        rec({ id: 'L3', borrowerId: 'B-2', balance: 60, municipio: 'Ponce' }),
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.singleBorrower.distinctBorrowers).toBe(2);
      expect(r.singleBorrower.exposures[0].borrowerId).toBe('B-1');
      expect(r.singleBorrower.exposures[0].balance).toBe(90);
      expect(r.singleBorrower.largestSharePct).toBe(60);
    });

    it('a null borrower is EXCLUDED, not treated as its own obligor (D1 — would understate concentration)', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', borrowerId: 'B-1', balance: 100 }),
        rec({ id: 'L2', borrowerId: null, balance: 100 }),
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.singleBorrower.coveragePct).toBe(50);
      expect(r.singleBorrower.distinctBorrowers).toBe(1);
      // covered book is 100% B-1 → largest share 100 over the covered portion.
      expect(r.singleBorrower.largestSharePct).toBe(100);
      expect(
        r.gaps.some((g) => g.field === 'concentration.singleBorrower.coverage'),
      ).toBe(true);
    });

    it('no loan carries a borrower key → single-borrower unmeasurable + gap', async () => {
      const { svc } = makeService([
        rec({ id: 'L1', borrowerId: null, balance: 100 }),
      ]);
      const r = await svc.analyze('inst-1', AS_OF);
      expect(r.singleBorrower.largestSharePct).toBeNull();
      expect(
        r.gaps.some((g) => g.field === 'concentration.singleBorrower'),
      ).toBe(true);
    });
  });

  it('reports total balance across all records regardless of coverage', async () => {
    const { svc } = makeService([
      rec({ id: 'L1', balance: 100, municipio: 'Caguas', borrowerId: 'B-1' }),
      rec({ id: 'L2', balance: 50, municipio: null, borrowerId: null }),
    ]);
    const r = await svc.analyze('inst-1', AS_OF);
    expect(r.totalBalance).toBe(150);
  });
});
