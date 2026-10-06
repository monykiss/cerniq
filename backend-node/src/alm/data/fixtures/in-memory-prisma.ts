/**
 * In-memory Prisma fake built from an `InstitutionFixture`.
 *
 * Serves the exact data shape the ALM engine reads in production — institution +
 * balance-sheet items + liquidity position + loan segments — without a database.
 * This lets the real, tested calculation services (AlmEnterpriseService,
 * StressTestingService, CECLService, MonteCarloService) run against a fixture in
 * unit tests, golden reconciliation, and the offline SIC demo harness.
 *
 * The seeder's percent→decimal rate normalization is applied here so the math
 * sees the same shape it would after `seedFromFixture` (fixtures store `rate` as
 * a percent like 8.75; the services expect 0.0875).
 *
 * Extracted from golden-reconciliation.spec so the demo harness and the golden
 * tests share one source of truth for "fixture → engine input".
 */
import type { InstitutionFixture } from './_schema';

export interface InMemoryPrismaOptions {
  institutionId?: string;
  workspaceId?: string;
}

/** The subset of Prisma delegates the ALM read-path engines touch. */
export interface InMemoryPrisma {
  loanSegment: { findMany: () => Promise<unknown[]> };
  institution: { findUnique: () => Promise<unknown> };
  balanceSheetItem: {
    findMany: () => Promise<unknown[]>;
    count: () => Promise<number>;
  };
  liquidityPosition: {
    findFirst: () => Promise<unknown>;
    findMany: () => Promise<unknown[]>;
  };
  interestRateScenario: {
    findMany: () => Promise<unknown[]>;
    deleteMany: () => Promise<{ count: number }>;
    createMany: () => Promise<{ count: number }>;
  };
  analysisRun: { findFirst: () => Promise<unknown> };
  reportJob: { findFirst: () => Promise<unknown> };
}

export function makeInMemoryPrismaFromFixture(
  fixture: InstitutionFixture,
  options: InMemoryPrismaOptions = {},
): InMemoryPrisma {
  const institutionId = options.institutionId ?? 'inst-in-memory';
  const workspaceId = options.workspaceId ?? 'ws-in-memory';
  const reportingDate = new Date(fixture.reportingDate);

  const institutionRow = {
    id: institutionId,
    workspaceId,
    name: fixture.name,
    type: fixture.type,
    totalAssets: fixture.totalAssets,
    currency: fixture.currency,
    reportingDate,
    primaryRegulator: fixture.primaryRegulator ?? 'COSSEC',
    cossecRegistrationNumber: fixture.cossecRegistrationNumber ?? null,
    fiscalYearEnd: fixture.fiscalYearEnd ?? null,
    preferredLanguage: fixture.preferredLanguage ?? 'es',
    seedKey: fixture.seedKey,
    createdAt: reportingDate,
    updatedAt: reportingDate,
  };

  const items = fixture.items.map((item, idx) => ({
    id: `bsi-${idx + 1}`,
    institutionId,
    category: item.category,
    subcategory: item.subcategory,
    name: item.name,
    balance: item.balance,
    // Mirror the seeder: fixtures store rate as percent; services expect decimal.
    rate: item.rate / 100,
    duration: item.duration,
    rateType: item.rateType,
    depositBeta: item.depositBeta ?? null,
    repriceDate: null,
    maturityDate: null,
  }));

  const liquidityRow = {
    id: 'liq-1',
    institutionId,
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
    institutionId,
    segmentName: s.segmentName,
    balance: s.balance,
    weightedAvgRate: s.weightedAvgRate,
    weightedAvgMaturity: s.weightedAvgMaturity,
    historicalLossRate: s.historicalLossRate,
    lgd: s.lgd,
    qualitativeAdj: s.qualitativeAdj,
    asOfDate: reportingDate,
    createdAt: reportingDate,
    updatedAt: reportingDate,
  }));

  return {
    loanSegment: {
      findMany: async () => loanSegments,
    },
    institution: {
      findUnique: async () => institutionRow,
    },
    balanceSheetItem: {
      findMany: async () => items,
      count: async () => items.length,
    },
    liquidityPosition: {
      findFirst: async () => liquidityRow,
      findMany: async () => [liquidityRow],
    },
    interestRateScenario: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    analysisRun: {
      findFirst: async () => null,
    },
    reportJob: {
      findFirst: async () => null,
    },
  };
}
