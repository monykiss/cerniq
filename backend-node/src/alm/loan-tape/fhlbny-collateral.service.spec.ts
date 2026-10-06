import {
  FhlbnyCollateralService,
  MODELED_HAIRCUTS,
  MODELED_MAX_DPD,
} from './fhlbny-collateral.service';
import type { PrismaService } from '../../prisma.service';

const AS_OF = new Date('2026-06-30T00:00:00Z');

function rec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r',
    externalLoanId: 'L-1',
    segmentName: 'Hipotecas',
    balance: 100000,
    collateralType: 'residencial',
    delinquencyDays: 0,
    municipio: 'Caguas',
    maturityDate: new Date('2050-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService(records: unknown[]) {
  const loanRecord = { findMany: jest.fn().mockResolvedValue(records) };
  // type-rationale: structural prisma double exposing only loanRecord.findMany
  return new FhlbnyCollateralService({
    loanRecord,
  } as unknown as PrismaService);
}

describe('FhlbnyCollateralService — MODELED collateral + capacity (W2.1)', () => {
  it('D1: no loan tape → data_unavailable, zero capacity, nothing fabricated', async () => {
    const r = await makeService([]).analyze('inst-1', AS_OF);
    expect(r.status).toBe('data_unavailable');
    expect(r.capacity.totalLendingValue).toBe(0);
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it('EVERY result carries the MODELED disclosure gap (the ratchet — never mistaken for the official schedule)', async () => {
    const r = await makeService([rec()]).analyze('inst-1', AS_OF);
    const gap = r.gaps.find((g) => g.field === 'fhlbny.collateral.modeled');
    expect(gap?.severity).toBe('WARNING');
    expect(gap?.action).toMatch(/MODEL/);
    expect(gap?.context).toMatchObject({
      maxDelinquencyDays: MODELED_MAX_DPD,
    });
    expect(r.modeled).toBe(true);
  });

  it('classifies residential mortgages and applies the disclosed haircut', async () => {
    const r = await makeService([rec({ balance: 200000 })]).analyze(
      'inst-1',
      AS_OF,
    );
    const cls = r.eligible.byClass[0];
    expect(cls.collateralClass).toBe('RESIDENTIAL_1_4');
    expect(cls.haircutPct).toBe(MODELED_HAIRCUTS.RESIDENTIAL_1_4 * 100);
    expect(cls.lendingValue).toBe(
      200000 * (1 - MODELED_HAIRCUTS.RESIDENTIAL_1_4),
    );
    expect(r.capacity.totalLendingValue).toBe(cls.lendingValue);
  });

  it('classifies HELOC / multifamily / CRE by keyword with their own haircuts', async () => {
    const r = await makeService([
      rec({
        id: 'a',
        externalLoanId: 'A',
        collateralType: 'HELOC',
        segmentName: 'Lineas',
      }),
      rec({ id: 'b', externalLoanId: 'B', collateralType: 'multifamiliar' }),
      rec({ id: 'c', externalLoanId: 'C', collateralType: 'comercial' }),
    ]).analyze('inst-1', AS_OF);
    const classes = r.eligible.byClass.map((c) => c.collateralClass).sort();
    expect(classes).toEqual(['COMMERCIAL_RE', 'HELOC', 'MULTIFAMILY']);
  });

  it('auto/consumer loans are not eligible classes — excluded WITH a disclosed reason', async () => {
    const r = await makeService([
      rec({ collateralType: 'vehiculo', segmentName: 'Auto' }),
    ]).analyze('inst-1', AS_OF);
    expect(r.eligible.loanCount).toBe(0);
    expect(r.ineligible.byReason[0].reason).toBe('not_an_eligible_class');
  });

  it(`loans at/over ${MODELED_MAX_DPD} DPD are ineligible (disclosed ceiling)`, async () => {
    const r = await makeService([
      rec({ delinquencyDays: MODELED_MAX_DPD }),
      rec({
        id: 'b',
        externalLoanId: 'L-2',
        delinquencyDays: MODELED_MAX_DPD - 1,
      }),
    ]).analyze('inst-1', AS_OF);
    expect(r.eligible.loanCount).toBe(1);
    expect(r.ineligible.byReason[0].reason).toBe(
      `delinquent_${MODELED_MAX_DPD}dpd_or_more`,
    );
  });

  it('UNKNOWN delinquency is ineligible — assuming current would overstate capacity (D1)', async () => {
    const r = await makeService([rec({ delinquencyDays: null })]).analyze(
      'inst-1',
      AS_OF,
    );
    expect(r.eligible.loanCount).toBe(0);
    expect(r.ineligible.byReason[0].reason).toBe('delinquency_unknown');
  });

  it('unclassifiable collateral (no collateralType, no keyword match) is its own disclosed reason', async () => {
    const r = await makeService([
      rec({ collateralType: null, segmentName: 'Prestamos Personales' }),
    ]).analyze('inst-1', AS_OF);
    expect(r.ineligible.byReason[0].reason).toBe('unclassifiable_collateral');
  });

  it('nothing eligible → capacity 0 + an explicit gap (never an error, never silence)', async () => {
    const r = await makeService([
      rec({ collateralType: 'vehiculo', segmentName: 'Auto' }),
    ]).analyze('inst-1', AS_OF);
    expect(r.capacity.totalLendingValue).toBe(0);
    expect(r.gaps.some((g) => g.field === 'fhlbny.collateral.eligible')).toBe(
      true,
    );
  });

  it('capacity what-ifs ladder over the modeled lending value with excess tracking', async () => {
    const r = await makeService([rec({ balance: 400000 })]).analyze(
      'inst-1',
      AS_OF,
    );
    const lv = r.capacity.totalLendingValue; // 300000 at 25% haircut
    expect(lv).toBe(300000);
    const half = r.capacity.whatIfs.find((w) => w.ladderPct === 50);
    expect(half?.advance).toBe(150000);
    expect(half?.excessCollateral).toBe(150000);
    const full = r.capacity.whatIfs.find((w) => w.ladderPct === 100);
    expect(full?.excessCollateral).toBe(0);
  });

  describe('generateModeledFile', () => {
    it('lists only eligible loans, labeled MODELED in the filename', async () => {
      const svc = makeService([
        rec({ externalLoanId: 'L-001', balance: 100000 }),
        rec({
          id: 'b',
          externalLoanId: 'L-002',
          collateralType: 'vehiculo',
          segmentName: 'Auto',
        }),
      ]);
      const file = await svc.generateModeledFile('inst-1', AS_OF);
      expect(file.modeled).toBe(true);
      expect(file.filename).toBe('MODELED-fhlbny-collateral-2026-06-30.csv');
      expect(file.loanCount).toBe(1);
      const lines = file.csv.split('\n');
      expect(lines).toHaveLength(2); // header + the one eligible loan
      expect(lines[1]).toContain('L-001');
      expect(lines[1]).toContain('RESIDENTIAL_1_4');
      expect(file.csv).not.toContain('L-002');
    });

    it('file lending value matches the analysis lending value (one source of math)', async () => {
      const records = [
        rec({ externalLoanId: 'L-001', balance: 180000 }),
        rec({ id: 'b', externalLoanId: 'L-002', balance: 150000 }),
      ];
      const svc = makeService(records);
      const [analysis, file] = await Promise.all([
        svc.analyze('inst-1', AS_OF),
        svc.generateModeledFile('inst-1', AS_OF),
      ]);
      expect(file.lendingValue).toBe(analysis.capacity.totalLendingValue);
    });
  });
});
