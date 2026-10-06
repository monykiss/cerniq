/**
 * Golden reconciliation tests — the immune system for ALM math.
 *
 * The contract: take the canonical institution fixture (`pr-cooperativa-demo.json`),
 * run the real ALM calculation engine against it, and snapshot the output as
 * `test/golden/pr-cooperativa-demo.<method>.json`. Subsequent runs assert
 * the new output matches the snapshot byte-for-byte. Any drift in the math
 * — a refactor that "doesn't change behavior" but does, a Decimal precision
 * regression, a benchmark threshold edit, a silent fallback being
 * reintroduced — fails CI and forces a deliberate review.
 *
 * Locked decision D7 (2026-04-07): the golden files are committed to the
 * repo. There is NO auto-update on assertion failure. To regenerate, set
 * `UPDATE_GOLDEN=1` and re-run, then review the diff in PR. Auto-update
 * defeats the purpose — the manual update IS the gate.
 *
 * Why this exists: by Phase 2 batch 3 we have killed every silent-zero
 * pattern we found. The golden tests are how we catch the *next* one
 * before it ships. They pin the entire ALM math to a known-good output
 * and turn the canonical fixture into a load-bearing artifact.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AlmService } from './alm.service';
import { DurationService } from './duration.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { StressTestingService } from './stress-testing/stress-testing.service';
import { CECLService } from './cecl.service';
import { AssetEWSService } from './asset-ews.service';
import { LoanTapeIngestService } from './loan-tape/loan-tape-ingest.service';
import { LoanTapeAggregationService } from './loan-tape/loan-tape-aggregation.service';
import { GeographicConcentrationService } from './loan-tape/geographic-concentration.service';
import { FhlbnyCollateralService } from './loan-tape/fhlbny-collateral.service';
import {
  SAMPLE_LOAN_TAPE_AS_OF,
  SAMPLE_LOAN_TAPE_CSV,
} from './loan-tape/sample-loan-tape.fixture';
import type { PrismaService } from '../prisma.service';
import { MacroOverlayService } from './macro-overlay.service';
import { PrMacroFeedService } from './pr-macro-feed.service';
import { PR_MACRO_SNAPSHOT } from './data/macro/pr-macro-snapshot';
import { CapitalPlanningService } from './cooperativa/capital-planning.service';
import { CaelComplianceService } from './cael-compliance.service';
import { getFixture } from './data/fixtures';

const GOLDEN_DIR = join(__dirname, '..', '..', 'test', 'golden');
const FIXTURE_KEY = 'pr-cooperativa-demo';
const INSTITUTION_ID = 'inst-coop-golden';

/**
 * In-memory Prisma fake that serves the cooperativa fixture's data shape
 * — institution + balance sheet items + liquidity position. The seeder's
 * percent-to-decimal rate normalization is applied here so the math sees
 * the same shape it would see in production after `seedFromFixture`.
 */
function makeFakePrismaFromFixture(): any {
  const fixture = getFixture(FIXTURE_KEY);
  const institutionRow = {
    id: INSTITUTION_ID,
    workspaceId: 'ws-golden',
    name: fixture.name,
    type: fixture.type,
    totalAssets: fixture.totalAssets,
    currency: fixture.currency,
    reportingDate: new Date(fixture.reportingDate),
    primaryRegulator: fixture.primaryRegulator ?? 'COSSEC',
    cossecRegistrationNumber: fixture.cossecRegistrationNumber ?? null,
    fiscalYearEnd: fixture.fiscalYearEnd ?? null,
    preferredLanguage: fixture.preferredLanguage ?? 'es',
    seedKey: fixture.seedKey,
    createdAt: new Date('2026-01-31T00:00:00Z'),
    updatedAt: new Date('2026-01-31T00:00:00Z'),
  };
  const items = fixture.items.map((item, idx) => ({
    id: `bsi-${idx + 1}`,
    institutionId: INSTITUTION_ID,
    category: item.category,
    subcategory: item.subcategory,
    name: item.name,
    balance: item.balance,
    // Mirror the seeder: fixtures store rate as percent; service expects decimal.
    rate: item.rate / 100,
    duration: item.duration,
    rateType: item.rateType,
    depositBeta: item.depositBeta ?? null,
    repriceDate: null,
    maturityDate: null,
  }));
  const liquidityRow = {
    id: 'liq-1',
    institutionId: INSTITUTION_ID,
    date: new Date(fixture.liquidity.date ?? fixture.reportingDate),
    hqlaLevel1: fixture.liquidity.hqlaLevel1,
    hqlaLevel2: fixture.liquidity.hqlaLevel2,
    cashOutflows: fixture.liquidity.cashOutflows,
    cashInflows: fixture.liquidity.cashInflows,
    lcr: fixture.liquidity.lcr,
    nsfr: fixture.liquidity.nsfr,
  };

  const loanSegments = (fixture.loanSegments ?? []).map((s, idx) => ({
    id: `seg-${idx + 1}`,
    institutionId: INSTITUTION_ID,
    segmentName: s.segmentName,
    balance: s.balance,
    weightedAvgRate: s.weightedAvgRate,
    weightedAvgMaturity: s.weightedAvgMaturity,
    historicalLossRate: s.historicalLossRate,
    lgd: s.lgd,
    qualitativeAdj: s.qualitativeAdj,
    asOfDate: new Date(fixture.reportingDate),
    createdAt: new Date('2026-01-31T00:00:00Z'),
    updatedAt: new Date('2026-01-31T00:00:00Z'),
  }));

  return {
    loanSegment: {
      findMany: jest.fn(async () => loanSegments),
    },
    institution: {
      findUnique: jest.fn(async () => institutionRow),
    },
    balanceSheetItem: {
      findMany: jest.fn(async () => items),
      count: jest.fn(async () => items.length),
    },
    liquidityPosition: {
      findFirst: jest.fn(async () => liquidityRow),
      findMany: jest.fn(async () => [liquidityRow]),
    },
    interestRateScenario: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    analysisRun: {
      findFirst: jest.fn(async () => null),
    },
    reportJob: {
      findFirst: jest.fn(async () => null),
    },
  };
}

/**
 * Normalize a sub-result for snapshot comparison. Drops volatile fields
 * (none today, but the helper centralizes the rule), rounds floats to a
 * stable precision, and JSON-roundtrips so Decimal/Date instances become
 * plain values.
 *
 * The roundFloats walk traverses the result tree and rounds every numeric
 * leaf to 4 decimal places. That defeats Decimal precision drift across
 * machines without losing meaningful precision for ratios (capital ratio
 * 12.45% rounds to 12.4500, not 12).
 */
function normalize(value: unknown): unknown {
  const json = JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.round(v * 10000) / 10000;
      }
      return v;
    }),
  );
  return json;
}

/**
 * Load the golden snapshot for a method. If `UPDATE_GOLDEN=1` is set or
 * the file doesn't exist, write the actual value as the new snapshot.
 * Otherwise read the file and return the stored expected value.
 *
 * The capture path is intentionally explicit — there's no silent fallback.
 * A missing file in CI causes the test to write it on disk and pass; this
 * is a deliberate choice so the FIRST commit of a golden file doesn't
 * require running the test twice. Subsequent commits go through the
 * normal assert path.
 */
function loadOrCapture(filename: string, actual: unknown): unknown {
  const path = join(GOLDEN_DIR, filename);
  const shouldCapture = process.env.UPDATE_GOLDEN === '1' || !existsSync(path);
  if (shouldCapture) {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
    return actual;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * W1.2: the macro overlay wired with a PINNED clock (one day after the
 * committed snapshot's verification pass) so staleness evaluation never
 * depends on when the suite runs — goldens must be time-independent.
 * FRED_API_KEY is cleared so the live-refresh path can't leak in.
 */
function makePinnedMacroOverlay(): MacroOverlayService {
  const feed = new PrMacroFeedService();
  const base = new Date(`${PR_MACRO_SNAPSHOT.compiledAsOf}T00:00:00Z`);
  feed.nowFn = () => new Date(base.getTime() + 86_400_000);
  return new MacroOverlayService(feed);
}

describe('Golden reconciliation: pr-cooperativa-demo', () => {
  let service: AlmEnterpriseService;
  let stress: StressTestingService;
  let cecl: CECLService;
  let overlay: MacroOverlayService;
  let ews: AssetEWSService;

  beforeEach(() => {
    delete process.env.FRED_API_KEY;
    delete process.env.CECL_MACRO_OVERLAY_MODE;
    delete process.env.PR_MACRO_STALENESS_DAYS;
    const prisma = makeFakePrismaFromFixture();
    service = new AlmEnterpriseService(
      prisma,
      new AlmService(),
      new DurationService(),
    );
    stress = new StressTestingService(prisma, service);
    overlay = makePinnedMacroOverlay();
    cecl = new CECLService(prisma, overlay);
    ews = new AssetEWSService(prisma);
  });

  it('getCOSSECCompliance produces the canonical snapshot', async () => {
    const actual = normalize(await service.getCOSSECCompliance(INSTITUTION_ID));
    const expected = loadOrCapture('pr-cooperativa-demo.cossec.json', actual);
    expect(actual).toEqual(expected);
  });

  it('calculateLCR produces the canonical snapshot', async () => {
    const actual = normalize(await service.calculateLCR(INSTITUTION_ID));
    const expected = loadOrCapture('pr-cooperativa-demo.lcr.json', actual);
    expect(actual).toEqual(expected);
  });

  it('calculateDurationGap produces the canonical snapshot', async () => {
    const actual = normalize(
      await service.calculateDurationGap(INSTITUTION_ID),
    );
    const expected = loadOrCapture(
      'pr-cooperativa-demo.duration-gap.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('calculateNIISensitivity produces the canonical snapshot', async () => {
    const actual = normalize(
      await service.calculateNIISensitivity(INSTITUTION_ID),
    );
    const expected = loadOrCapture(
      'pr-cooperativa-demo.nii-sensitivity.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('getNEVAnalysis produces the canonical snapshot', async () => {
    const actual = normalize(await stress.getNEVAnalysis(INSTITUTION_ID));
    const expected = loadOrCapture('pr-cooperativa-demo.nev.json', actual);
    expect(actual).toEqual(expected);
  });

  it('getCooperativaCECLAnalysis produces the canonical snapshot', async () => {
    const actual = normalize(
      await cecl.getCooperativaCECLAnalysis(INSTITUTION_ID),
    );
    const expected = loadOrCapture('pr-cooperativa-demo.cecl.json', actual);
    expect(actual).toEqual(expected);
  });

  it('deriveCurrentOverlay produces the canonical snapshot (W1.2 macro overlay)', async () => {
    const actual = normalize(await overlay.deriveCurrentOverlay());
    const expected = loadOrCapture('pr-macro-overlay.json', actual);
    expect(actual).toEqual(expected);
  });

  it('computeEWS produces the canonical snapshot (W1.3 early-warning composite)', async () => {
    const actual = normalize(await ews.computeEWS(INSTITUTION_ID));
    const expected = loadOrCapture('pr-cooperativa-demo.ews.json', actual);
    expect(actual).toEqual(expected);
  });

  // ── W2.0/W2.2 loan-tape goldens ──────────────────────────────────────
  // The committed SAMPLE_LOAN_TAPE_CSV parses through the PURE parser, is
  // mapped to LoanRecord-shaped rows, and pins both the segment rollup and
  // the geographic/single-borrower concentration. Fully deterministic: the
  // tape's asOfDate is pinned and no clock or DB participates.
  function loanTapePrismaStub(): PrismaService {
    const parse = new LoanTapeIngestService(
      // type-rationale: parseLoanTape is pure — the parser never touches prisma
      null as unknown as PrismaService,
    ).parseLoanTape(SAMPLE_LOAN_TAPE_CSV);
    if (!parse.valid) {
      throw new Error(
        `sample loan tape must parse cleanly; got ${parse.errors.length} error(s)`,
      );
    }
    const rows = parse.records.map((r, i) => ({
      id: `golden-${i}`,
      institutionId: INSTITUTION_ID,
      asOfDate: new Date(`${SAMPLE_LOAN_TAPE_AS_OF}T00:00:00Z`),
      externalLoanId: r.externalLoanId,
      segmentName: r.segmentName,
      balance: r.balance,
      rate: r.rate,
      originationDate: r.originationDate
        ? new Date(`${r.originationDate}T00:00:00Z`)
        : null,
      maturityDate: r.maturityDate
        ? new Date(`${r.maturityDate}T00:00:00Z`)
        : null,
      collateralType: r.collateralType,
      collateralValue: r.collateralValue,
      municipio: r.municipio,
      delinquencyDays: r.delinquencyDays,
      borrowerId: r.borrowerId,
    }));
    // type-rationale: structural prisma double for the two loan-tape readers
    return {
      loanRecord: { findMany: jest.fn().mockResolvedValue(rows) },
      loanSegment: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
  }

  it('loan-tape rollup produces the canonical snapshot (W2.0)', async () => {
    const agg = new LoanTapeAggregationService(loanTapePrismaStub());
    const actual = normalize(
      await agg.rollUpToSegments(
        INSTITUTION_ID,
        new Date(`${SAMPLE_LOAN_TAPE_AS_OF}T00:00:00Z`),
      ),
    );
    const expected = loadOrCapture('sample-loan-tape.rollup.json', actual);
    expect(actual).toEqual(expected);
  });

  it('geographic + single-borrower concentration produces the canonical snapshot (W2.2)', async () => {
    const geo = new GeographicConcentrationService(loanTapePrismaStub());
    const actual = normalize(
      await geo.analyze(
        INSTITUTION_ID,
        new Date(`${SAMPLE_LOAN_TAPE_AS_OF}T00:00:00Z`),
      ),
    );
    const expected = loadOrCapture(
      'sample-loan-tape.geographic-concentration.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('MODELED FHLBNY collateral analysis produces the canonical snapshot (W2.1)', async () => {
    const fhlbny = new FhlbnyCollateralService(loanTapePrismaStub());
    const actual = normalize(
      await fhlbny.analyze(
        INSTITUTION_ID,
        new Date(`${SAMPLE_LOAN_TAPE_AS_OF}T00:00:00Z`),
      ),
    );
    const expected = loadOrCapture(
      'sample-loan-tape.fhlbny-collateral.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('incurred-loss (Reg 8665) produces the canonical snapshot', async () => {
    const actual = normalize(
      await cecl.getCECLAnalysis(INSTITUTION_ID, 'incurredloss'),
    );
    const expected = loadOrCapture(
      'pr-cooperativa-demo.incurred-loss.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('capital glide-path (W1.4) produces the canonical snapshot', async () => {
    const cossec = await service.getCOSSECCompliance(INSTITUTION_ID);
    const planner = new CapitalPlanningService();
    // Pinned planning assumptions so the golden is deterministic regardless of
    // the service defaults; the math runs on the real demo balance sheet.
    const actual = normalize(
      planner.planFromCossecSummary(cossec.summary, {
        annualAssetGrowthPct: 4,
        annualRoaPct: 0.6,
        surplusRetentionPct: 100,
        horizonYears: 5,
        periodsPerYear: 4,
      }),
    );
    const expected = loadOrCapture(
      'pr-cooperativa-demo.capital-glide-path.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });

  it('CAEL compliance (W1.1 Slice 2) produces the canonical snapshot', async () => {
    // Run the real engines, then evaluate the three quarterly CAEL variants —
    // drift-locks the compute layer against the live COSSEC + allowance output.
    const cossec = await service.getCOSSECCompliance(INSTITUTION_ID);
    const incurred = await cecl.getCECLAnalysis(INSTITUTION_ID, 'incurredloss');
    const warm = await cecl.getCECLAnalysis(INSTITUTION_ID, 'warm');
    const cael = new CaelComplianceService();
    const results = [
      cael.evaluateCaelCompliance(
        cael.caelInputsFromEngines('reg7790', cossec.summary, incurred),
      ),
      cael.evaluateCaelCompliance(
        cael.caelInputsFromEngines('cecl', cossec.summary, warm),
      ),
      cael.evaluateCaelCompliance(
        cael.caelInputsFromEngines('piloto', cossec.summary, null),
      ),
    ];
    const actual = normalize(results);
    const expected = loadOrCapture(
      'pr-cooperativa-demo.cael-compliance.json',
      actual,
    );
    expect(actual).toEqual(expected);
  });
});
