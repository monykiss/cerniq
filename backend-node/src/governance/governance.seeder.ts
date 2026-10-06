/**
 * GovernanceSeeder — seeds governed scenarios and benchmarks on boot.
 *
 * Idempotent via upsert by scenarioKey/datasetKey.
 * Seeds the canonical regulatory scenarios that every PR cooperativa
 * should have available, plus the key benchmark datasets.
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { GovernedScenarioService } from './governed-scenario.service';
import { GovernedBenchmarkService } from './governed-benchmark.service';
import type {
  GovernedScenarioSeed,
  GovernedBenchmarkSeed,
} from './governance.types';

/** Namespaced registry identifier, e.g. ns('stress', 'inverted-curve') → 'stress.inverted-curve'. */
const ns = (namespace: string, name: string): string => `${namespace}.${name}`;

const OWNER = 'CerniQ Risk Team';

const SCENARIOS: GovernedScenarioSeed[] = [
  // ── Regulatory mandated ──
  {
    scenarioKey: ns('stress', 'cossec-baseline-2026'),
    displayName: 'COSSEC Baseline Stress 2026',
    description:
      'COSSEC-mandated baseline stress scenario for 2026 examination cycle. +200bps parallel shift, 5% deposit runoff.',
    version: '1.0.0',
    scope: 'REGULATORY',
    status: 'APPROVED',
    source: 'COSSEC_2026_EXAM_GUIDE',
    ownerName: OWNER,
    parameters: {
      rateShockBps: 200,
      shiftType: 'parallel',
      depositRunoffPct: 5,
      creditLossPct: 0,
      timeHorizonMonths: 12,
    },
    approvedUses: ['regulatory_filing', 'board_report', 'internal_analysis'],
    provenance: {
      regulatoryReference: 'COSSEC Examination Manual §4.3',
      effectiveDate: '2026-01-01',
    },
  },
  {
    scenarioKey: ns('stress', 'cossec-adverse-2026'),
    displayName: 'COSSEC Adverse Stress 2026',
    description:
      'COSSEC adverse scenario: +300bps short / +100bps long (steepening), 10% deposit runoff, 2% credit losses.',
    version: '1.0.0',
    scope: 'REGULATORY',
    status: 'APPROVED',
    source: 'COSSEC_2026_EXAM_GUIDE',
    ownerName: OWNER,
    parameters: {
      shortRateShockBps: 300,
      longRateShockBps: 100,
      shiftType: 'steepening',
      depositRunoffPct: 10,
      creditLossPct: 2,
      timeHorizonMonths: 12,
    },
    approvedUses: ['regulatory_filing', 'board_report'],
    provenance: { regulatoryReference: 'COSSEC Examination Manual §4.3.2' },
  },
  {
    scenarioKey: ns('stress', 'frb-severely-adverse-2026'),
    displayName: 'FRB Severely Adverse 2026',
    description:
      'Federal Reserve severely adverse scenario for CCAR/DFAST. Deep recession with rate drop, high unemployment, asset price decline.',
    version: '1.0.0',
    scope: 'REGULATORY',
    status: 'APPROVED',
    source: 'FRB_CCAR_2026_SCENARIOS',
    ownerName: OWNER,
    parameters: {
      rateShockBps: -150,
      shiftType: 'parallel',
      depositRunoffPct: 15,
      creditLossPct: 5,
      unemploymentRatePct: 10,
      realGDPGrowthPct: -4,
      timeHorizonMonths: 36,
    },
    approvedUses: ['regulatory_filing', 'board_report'],
    provenance: {
      regulatoryReference: 'FRB 2026 Supervisory Scenarios',
      publishedDate: '2026-02-15',
    },
  },
  // ── PR-specific ──
  {
    scenarioKey: ns('stress', 'hurricane-category-4'),
    displayName: 'Hurricane Category 4 (PR-Specific)',
    description:
      'Maria-calibrated Cat 4 hurricane: 20% deposit surge (pre-storm withdrawals), 8% credit losses on property-secured loans, 30-day liquidity stress.',
    version: '1.0.0',
    scope: 'SECTOR',
    status: 'APPROVED',
    source: 'INTERNAL_RISK_COMMITTEE',
    ownerName: OWNER,
    parameters: {
      depositSurgePct: 20,
      creditLossPct: 8,
      propertySecuredOnly: true,
      liquidityStressDays: 30,
      powerOutageDays: 45,
      timeHorizonMonths: 6,
    },
    approvedUses: ['board_report', 'internal_analysis'],
    provenance: {
      basis: 'Hurricane Maria 2017 post-mortem analysis',
      calibratedDate: '2024-06-15',
    },
  },
  {
    scenarioKey: ns('stress', 'rapid-rate-rise-300'),
    displayName: 'Rapid Rate Rise +300bps',
    description:
      'Parallel +300bps shock over 6 months. Tests NII sensitivity and deposit beta assumptions.',
    version: '1.0.0',
    scope: 'SECTOR',
    status: 'APPROVED',
    source: 'INTERNAL_RISK_COMMITTEE',
    ownerName: OWNER,
    parameters: {
      rateShockBps: 300,
      shiftType: 'parallel',
      phaseInMonths: 6,
      depositRunoffPct: 8,
      timeHorizonMonths: 12,
    },
    approvedUses: ['board_report', 'internal_analysis'],
  },
  {
    scenarioKey: ns('stress', 'inverted-curve'),
    displayName: 'Yield Curve Inversion',
    description:
      'Short rates +200bps, long rates -100bps. Tests NIM compression and funding cost sensitivity.',
    version: '1.0.0',
    scope: 'SECTOR',
    status: 'APPROVED',
    source: 'INTERNAL_RISK_COMMITTEE',
    ownerName: OWNER,
    parameters: {
      shortRateShockBps: 200,
      longRateShockBps: -100,
      shiftType: 'inversion',
      depositRunoffPct: 3,
      timeHorizonMonths: 12,
    },
    approvedUses: ['board_report', 'internal_analysis'],
  },
  // ── Macro / thematic ──
  {
    scenarioKey: ns('stress', 'sic-2026-global-restructuring'),
    displayName: 'SIC 2026 — Global Restructuring',
    description:
      'Combined macro shock for the Strategic Investment Conference 2026 "Global Restructuring" theme: +200bps parallel rate rise, +3% consumer default-rate increase, 5% deposit runoff over 12 months. Runnable engine twin: COSSEC_SCENARIOS["sic_2026_global_restructuring"].',
    version: '1.0.0',
    scope: 'SECTOR',
    status: 'APPROVED',
    source: 'CERNIQ_MACRO_LIBRARY',
    ownerName: OWNER,
    parameters: {
      rateShockBps: 200,
      shiftType: 'parallel',
      depositRunoffPct: 5,
      creditLossPct: 3,
      creditLossSegment: 'consumer',
      timeHorizonMonths: 12,
      engineScenarioId: 'sic_2026_global_restructuring',
    },
    approvedUses: ['board_report', 'internal_analysis'],
    provenance: {
      basis:
        'Mauldin Strategic Investment Conference 2026 — "The Global Restructuring"',
      thematic: true,
    },
  },
];

const BENCHMARKS: GovernedBenchmarkSeed[] = [
  {
    datasetKey: ns('curve', 'treasury-par-2026-q1'),
    displayName: 'US Treasury Par Curve (2026 Q1)',
    description:
      'US Treasury constant maturity par yields as of March 31, 2026.',
    benchmarkType: 'YIELD_CURVE',
    version: '1.0.0',
    status: 'APPROVED',
    asOfDate: new Date('2026-03-31'),
    source: 'FED_H15',
    ownerName: OWNER,
    refreshPolicy: 'QUARTERLY',
    data: {
      tenors: [
        { tenor: 0.25, rate: 0.0435 },
        { tenor: 0.5, rate: 0.044 },
        { tenor: 1, rate: 0.0425 },
        { tenor: 2, rate: 0.041 },
        { tenor: 3, rate: 0.04 },
        { tenor: 5, rate: 0.039 },
        { tenor: 7, rate: 0.0385 },
        { tenor: 10, rate: 0.038 },
        { tenor: 20, rate: 0.04 },
        { tenor: 30, rate: 0.041 },
      ],
      currency: 'USD',
      dayCount: 'ACT/ACT',
    },
    provenance: {
      sourceUrl: 'https://www.federalreserve.gov/releases/h15/',
      extractedDate: '2026-04-01',
    },
    fallbackPolicy: 'use_prior_version',
  },
  {
    datasetKey: ns('peer', 'pr-cooperativa-100m-250m'),
    displayName: 'PR Cooperativa Peer Group ($100M–$250M)',
    description:
      'Peer benchmarks for Puerto Rico cooperativas with $100M–$250M total assets. Based on COSSEC filings.',
    benchmarkType: 'PEER_BENCHMARK',
    version: '1.0.0',
    status: 'APPROVED',
    asOfDate: new Date('2025-12-31'),
    source: 'COSSEC_FILINGS_2025',
    ownerName: OWNER,
    refreshPolicy: 'QUARTERLY',
    data: {
      assetTier: '$100M-$250M',
      sampleSize: 18,
      metrics: {
        nim: { p25: 3.1, p50: 3.5, p75: 3.9, mean: 3.5, unit: '%' },
        netWorthRatio: { p25: 8.5, p50: 9.8, p75: 11.2, mean: 9.9, unit: '%' },
        delinquencyRatio: {
          p25: 1.2,
          p50: 2.1,
          p75: 3.5,
          mean: 2.3,
          unit: '%',
        },
        roa: { p25: 0.4, p50: 0.7, p75: 1.0, mean: 0.7, unit: '%' },
        operatingExpenseRatio: {
          p25: 3.2,
          p50: 3.8,
          p75: 4.5,
          mean: 3.9,
          unit: '%',
        },
        loanToAssetRatio: { p25: 55, p50: 62, p75: 70, mean: 62, unit: '%' },
      },
    },
    provenance: { basis: 'COSSEC quarterly filings 2025 Q4', peerCount: 18 },
    fallbackPolicy: 'warn',
  },
  {
    datasetKey: ns('limit', 'cossec-regulatory-2026'),
    displayName: 'COSSEC Regulatory Thresholds 2026',
    description:
      'Minimum and target thresholds for COSSEC-regulated institutions. 12 ratios.',
    benchmarkType: 'REGULATORY_LIMIT',
    version: '1.0.0',
    status: 'APPROVED',
    asOfDate: new Date('2026-01-01'),
    source: 'COSSEC_EXAM_MANUAL_2026',
    ownerName: OWNER,
    refreshPolicy: 'ON_PUBLICATION',
    data: {
      thresholds: [
        {
          ratio: 'Net Worth Ratio',
          minimum: 6,
          target: 7,
          unit: '%',
          reference: 'COSSEC §3.1',
        },
        {
          ratio: 'Interest Margin',
          minimum: 2,
          target: 3,
          unit: '%',
          reference: 'COSSEC §3.2',
        },
        {
          ratio: 'Operating Expense Ratio',
          maximum: 5,
          target: 4,
          unit: '%',
          reference: 'COSSEC §3.3',
        },
        {
          ratio: 'Delinquency Ratio',
          maximum: 5,
          target: 3,
          unit: '%',
          reference: 'COSSEC §3.4',
        },
        {
          ratio: 'ROA',
          minimum: 0.25,
          target: 0.5,
          unit: '%',
          reference: 'COSSEC §3.5',
        },
        {
          ratio: 'Loan to Asset Ratio',
          minimum: 50,
          target: 65,
          unit: '%',
          reference: 'COSSEC §3.6',
        },
      ],
    },
    provenance: {
      regulatoryDocument: 'COSSEC Examination Manual 2026 Edition',
    },
    fallbackPolicy: 'block_report',
  },
];

@Injectable()
export class GovernanceSeeder implements OnModuleInit {
  private readonly logger = new Logger(GovernanceSeeder.name);

  constructor(
    private readonly scenarioService: GovernedScenarioService,
    private readonly benchmarkService: GovernedBenchmarkService,
  ) {}

  async onModuleInit() {
    // Seed scenarios
    let sCreated = 0;
    for (const s of SCENARIOS) {
      try {
        const existing = await this.scenarioService
          .getByKey(s.scenarioKey)
          .catch(() => null);
        await this.scenarioService.upsert(s);
        if (!existing) sCreated++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to seed scenario ${s.scenarioKey}: ${err.message}`,
        );
      }
    }
    this.logger.log(
      `Governed scenarios seeded: ${sCreated} created, ${SCENARIOS.length} total`,
    );

    // Seed benchmarks
    let bCreated = 0;
    for (const b of BENCHMARKS) {
      try {
        const existing = await this.benchmarkService
          .getByKey(b.datasetKey)
          .catch(() => null);
        await this.benchmarkService.upsert(b);
        if (!existing) bCreated++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to seed benchmark ${b.datasetKey}: ${err.message}`,
        );
      }
    }
    this.logger.log(
      `Governed benchmarks seeded: ${bCreated} created, ${BENCHMARKS.length} total`,
    );
  }
}
