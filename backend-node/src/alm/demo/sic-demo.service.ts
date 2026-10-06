/**
 * SIC 2026 — "Global Restructuring" demo harness (offline, deterministic).
 *
 * Composes the REAL, tested ALM engines (COSSEC compliance, NII sensitivity,
 * the SIC named stress scenario, cooperativa CECL) against the dynamically-built
 * "Cooperativa San Juan Federal" institution via an in-memory Prisma fake — no
 * database, no Nest bootstrap. It then projects the stressed capital-ratio band
 * with the seeded projection and assembles the Mauldin headline.
 *
 * Everything is deterministic: same params ⇒ byte-identical result (the Vasicek
 * Monte-Carlo NII engine is deliberately NOT used here because it draws from
 * `crypto.randomBytes` and is not reproducible — SR 11-7). That makes the whole
 * result golden-lockable.
 *
 * This is the artifact behind `npm run demo:sic`: it produces the real,
 * model-derived "baseline → stressed capital ratio vs the COSSEC floor" numbers
 * for the live call, with a D1 gap manifest and model lineage.
 */
import { createHash } from 'crypto';
import type { PrismaService } from '../../prisma.service';
import { AlmService } from '../alm.service';
import { DurationService } from '../duration.service';
import { AlmEnterpriseService } from '../alm-enterprise.service';
import { StressTestingService } from '../stress-testing/stress-testing.service';
import { CECLService } from '../cecl.service';
import { MacroOverlayService } from '../macro-overlay.service';
import { PrMacroFeedService } from '../pr-macro-feed.service';
import type { DataGap } from '../reports/data-gap';
import {
  buildSanJuanFederalDemo,
  SanJuanFederalParams,
} from '../data/fixtures/builders/san-juan-federal.builder';
import { makeInMemoryPrismaFromFixture } from '../data/fixtures/in-memory-prisma';
import {
  projectCapitalRatioUnderStress,
  reverseStressToFloor,
  CapitalRatioUnderStress,
  ReverseStressResult,
} from './capital-ratio-projection';

/** COSSEC leverage capital-ratio floor (equity / total assets), percent. */
export const COSSEC_MIN_CAPITAL_RATIO_PCT = 7;
const SIC_SCENARIO_ID = 'sic_2026_global_restructuring';
const INSTITUTION_ID = 'inst-sic-demo';

export type PipelineStepStatus = 'completed' | 'requires_infra';

export interface SicDemoResult {
  generatedFor: string;
  institution: {
    name: string;
    type: string;
    totalAssets: number;
    currency: string;
    reportingDate: string;
    regulator: string;
  };
  scenario: {
    id: string;
    name: string;
    nameEs: string;
    rateShiftBps: number;
    depositShockPct: number;
    creditShockPct: number;
    creditShockSegment: string;
  };
  baseline: {
    capitalRatioPct: number;
    capitalRatioRWAPct: number | null;
    equity: number;
    nim: number;
    loanToShareRatio: number;
    examReadinessScore: number;
    cossecOverallStatus: string;
    ratios: Array<{
      name: string;
      nameEs: string;
      value: number;
      unit: string;
      threshold: string;
      status: string;
    }>;
  };
  stress: {
    creditLoss: number;
    depositImpact: number;
    niiImpact: number;
    totalImpact: number;
    passFailStatus: string;
  };
  capitalRatioUnderStress: CapitalRatioUnderStress;
  cecl: {
    totalBalance: number;
    totalAllowance: number;
    weightedCoverageRatio: number;
    status: string;
  } | null;
  headline: {
    baselineCapitalRatioPct: number;
    stressedCapitalRatioPct: number;
    adverseTailCapitalRatioPct: number;
    cossecMinimumPct: number;
    adverseCushionBps: number;
    breachesFloorAtAdverseTail: boolean;
    breachProbabilityPct: number;
    narrative: string;
    narrativeEs: string;
  };
  /**
   * COSSEC ratios currently breaching (`fail`) or near-limit (`warning`),
   * fail-first. For this institution the binding constraints are interest-rate
   * risk (duration gap / EVE sensitivity) and loan concentration — the hidden
   * risks a headline capital ratio alone does not surface.
   */
  findings: Array<{
    name: string;
    nameEs: string;
    value: number;
    unit: string;
    threshold: string;
    status: 'fail' | 'warning';
  }>;
  /**
   * Reverse stress test (EBA/PRA distance-to-breach): the loss that would drive
   * the leverage ratio to the COSSEC floor, expressed as a multiple of the SIC
   * scenario loss and as the consumer default-rate that alone would breach.
   */
  reverseStress: ReverseStressResult & {
    narrative: string;
    narrativeEs: string;
  };
  pipeline: Array<{ step: string; name: string; status: PipelineStepStatus }>;
  gaps: DataGap[];
  modelLineage: Array<{ model: string; source: string }>;
  resultChecksum: string;
}

export interface SicDemoOptions {
  /** Override the demo institution parameters (defaults reproduce the brief). */
  institution?: Partial<SanJuanFederalParams>;
  /** Capital-ratio projection paths (default 5000). */
  paths?: number;
  /** COSSEC leverage floor (default 7%). */
  cossecMinimumPct?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class SicDemoService {
  async run(options: SicDemoOptions = {}): Promise<SicDemoResult> {
    const fixture = buildSanJuanFederalDemo(options.institution);
    const cossecMinimumPct =
      options.cossecMinimumPct ?? COSSEC_MIN_CAPITAL_RATIO_PCT;

    const prisma = makeInMemoryPrismaFromFixture(fixture, {
      institutionId: INSTITUTION_ID,
    }) as unknown as PrismaService;

    const alm = new AlmEnterpriseService(
      prisma,
      new AlmService(),
      new DurationService(),
    );
    const stress = new StressTestingService(prisma, alm);
    // W1.2: demo runs the same data-derived overlay path as production
    // (committed snapshot, real-time staleness — a stale snapshot showing
    // its WARNING gap in the demo is the D1 disclosure story, not a bug).
    const cecl = new CECLService(
      prisma,
      new MacroOverlayService(new PrMacroFeedService()),
    );

    // ── Step 1: Validate (D1) ──
    const gaps: DataGap[] = [];

    // ── Step 2: COSSEC compliance (12-ratio matrix) ──
    const cossec = await alm.getCOSSECCompliance(INSTITUTION_ID);
    if (cossec.gaps?.length) gaps.push(...cossec.gaps);

    // ── Step 4: SIC 2026 named stress scenario (consumer-segment-aware) ──
    // (runCOSSECScenarios computes NII sensitivity internally; see modelLineage.)
    const scenarios = await stress.runCOSSECScenarios(INSTITUTION_ID);
    const sic = scenarios.find((s) => s.scenario.id === SIC_SCENARIO_ID);
    if (!sic) {
      throw new Error(
        `SIC demo: scenario "${SIC_SCENARIO_ID}" not found in COSSEC_SCENARIOS.`,
      );
    }

    // ── Step 5: cooperativa CECL ──
    const ceclResult = await cecl.getCooperativaCECLAnalysis(INSTITUTION_ID);
    if (ceclResult.gaps?.length) gaps.push(...ceclResult.gaps);

    // ── Capital-ratio-under-stress projection (seeded, reproducible) ──
    // The SIC NII impact is negative when the coop is liability-sensitive; the
    // shortfall (lost earnings that would have built capital) is its magnitude.
    const niiShortfall = Math.max(0, -sic.niiImpact);
    const projection = projectCapitalRatioUnderStress({
      baseEquity: cossec.summary.equity,
      totalAssets: cossec.summary.totalAssets,
      cossecMinimumPct,
      deterministicLosses: {
        creditLoss: sic.creditLoss,
        depositCost: sic.depositImpact,
        niiShortfall,
      },
      seed: `${SIC_SCENARIO_ID}:${fixture.seedKey}`,
      paths: options.paths,
    });

    const baselineCapitalRatioPct = round2(cossec.summary.capitalRatio);
    const stressedCapitalRatioPct =
      projection.deterministic.stressedCapitalRatioPct;
    const adverseTailCapitalRatioPct = projection.distribution.p5;

    // COSSEC findings: ratios breaching (fail) or near-limit (warning), fail-first.
    const findings = cossec.ratios
      .filter((r) => r.status === 'fail' || r.status === 'warning')
      .sort((a, b) =>
        a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1,
      )
      .map((r) => ({
        name: r.name,
        nameEs: r.nameEs,
        value: round2(r.value),
        unit: r.unit,
        threshold: r.threshold,
        status: r.status as 'fail' | 'warning',
      }));
    const topFinding = findings.find((f) => f.status === 'fail') ?? findings[0];

    const cushionWord = (bps: number, es: boolean) =>
      bps >= 0
        ? es
          ? 'por encima del'
          : 'above the'
        : es
          ? 'por debajo del'
          : 'below the';

    // The headline leads with capital, then surfaces the BINDING constraint —
    // capital looks fine, but the real risk is the duration gap / EVE the
    // headline ratio hides. That is the demo's value proposition.
    const findingsEs = topFinding
      ? ` COSSEC marca ${findings.length} hallazgo(s) hoy — la restricción vinculante es ${topFinding.nameEs} en ${topFinding.value}${topFinding.unit}, que excede el límite regulatorio.`
      : '';
    const findingsEn = topFinding
      ? ` COSSEC flags ${findings.length} issue(s) today — the binding constraint is ${topFinding.name} at ${topFinding.value}${topFinding.unit} (limit ${topFinding.threshold}).`
      : '';

    const narrativeEs =
      `Bajo el escenario SIC 2026 (Reestructuración Global), el ratio de capital de ${fixture.name} ` +
      `pasa de ${baselineCapitalRatioPct}% a ${stressedCapitalRatioPct}% (estimación central). ` +
      `En el percentil adverso (p5) cae a ${adverseTailCapitalRatioPct}%, ` +
      `${Math.abs(projection.adverseCushionBps)} pbs ${cushionWord(projection.adverseCushionBps, true)} ` +
      `mínimo COSSEC de ${cossecMinimumPct}%.` +
      findingsEs;
    const narrative =
      `Under the SIC 2026 (Global Restructuring) scenario, ${fixture.name}'s capital ratio ` +
      `moves from ${baselineCapitalRatioPct}% to ${stressedCapitalRatioPct}% (central estimate). ` +
      `At the adverse percentile (p5) it falls to ${adverseTailCapitalRatioPct}%, ` +
      `${Math.abs(projection.adverseCushionBps)} bps ${cushionWord(projection.adverseCushionBps, false)} ` +
      `${cossecMinimumPct}% COSSEC minimum.` +
      findingsEn;

    // ── Reverse stress test: distance to the COSSEC floor ──
    const consumerLoans = fixture.items
      .filter(
        (i) => i.category === 'asset' && i.subcategory === 'consumer_loans',
      )
      // Number() satisfies verify:decimal-coercion (no-op on the fixture's plain
      // number balance; defensive if the shape ever becomes a Prisma Decimal).
      .reduce((s, i) => s + Number(i.balance), 0);
    const rs = reverseStressToFloor({
      baseEquity: cossec.summary.equity,
      totalAssets: cossec.summary.totalAssets,
      cossecMinimumPct,
      scenarioTotalLoss: projection.deterministic.totalLoss,
      targetSegmentBalance: consumerLoans,
    });
    const multEs =
      rs.headroomMultiple != null
        ? ` (${rs.headroomMultiple}× el choque SIC)`
        : '';
    const multEn =
      rs.headroomMultiple != null
        ? ` (${rs.headroomMultiple}× the SIC shock)`
        : '';
    const bpEs =
      rs.breakingPointSegmentDefaultPct != null
        ? `; equivale a +${rs.breakingPointSegmentDefaultPct}% de morosidad de consumo frente al +${sic.scenario.creditShockPct}% del escenario`
        : '';
    const bpEn =
      rs.breakingPointSegmentDefaultPct != null
        ? `; equivalent to a +${rs.breakingPointSegmentDefaultPct}% consumer default rate vs the scenario's +${sic.scenario.creditShockPct}%`
        : '';
    const reverseStress = {
      ...rs,
      narrativeEs: rs.alreadyBelowFloor
        ? `Ya está por debajo del piso de ${cossecMinimumPct}%.`
        : `Puede absorber $${rs.lossToFloor}M en pérdidas${multEs} antes de tocar el piso de ${cossecMinimumPct}%${bpEs}.`,
      narrative: rs.alreadyBelowFloor
        ? `Already below the ${cossecMinimumPct}% floor.`
        : `Can absorb $${rs.lossToFloor}M of losses${multEn} before hitting the ${cossecMinimumPct}% floor${bpEn}.`,
    };

    const result: Omit<SicDemoResult, 'resultChecksum'> = {
      generatedFor: 'Mauldin SIC 2026 — Global Restructuring',
      institution: {
        name: fixture.name,
        type: fixture.type,
        totalAssets: fixture.totalAssets,
        currency: fixture.currency,
        reportingDate: fixture.reportingDate,
        regulator: fixture.primaryRegulator ?? 'COSSEC',
      },
      scenario: {
        id: sic.scenario.id,
        name: sic.scenario.name,
        nameEs: sic.scenario.nameEs,
        rateShiftBps: sic.scenario.rateShiftBps,
        depositShockPct: sic.scenario.depositShockPct,
        creditShockPct: sic.scenario.creditShockPct,
        creditShockSegment: sic.scenario.creditShockSegment ?? 'all',
      },
      baseline: {
        capitalRatioPct: baselineCapitalRatioPct,
        capitalRatioRWAPct:
          cossec.summary.capitalRatioRWA != null
            ? round2(cossec.summary.capitalRatioRWA)
            : null,
        equity: round2(cossec.summary.equity),
        nim: round2(cossec.summary.nim),
        loanToShareRatio: round2(cossec.summary.loanToShareRatio),
        examReadinessScore: cossec.examReadinessScore,
        cossecOverallStatus: cossec.overallStatus,
        ratios: cossec.ratios.map((r) => ({
          name: r.name,
          nameEs: r.nameEs,
          value: round2(r.value),
          unit: r.unit,
          threshold: r.threshold,
          status: r.status,
        })),
      },
      stress: {
        creditLoss: round2(sic.creditLoss),
        depositImpact: round2(sic.depositImpact),
        niiImpact: round2(sic.niiImpact),
        totalImpact: round2(sic.totalImpact),
        passFailStatus: sic.passFailStatus,
      },
      capitalRatioUnderStress: projection,
      cecl:
        ceclResult.overallStatus === 'data_unavailable'
          ? null
          : {
              totalBalance: round2(ceclResult.totalBalance),
              totalAllowance: round2(ceclResult.totalAllowance),
              weightedCoverageRatio: round2(ceclResult.weightedCoverageRatio),
              status: ceclResult.overallStatus ?? 'computed',
            },
      headline: {
        baselineCapitalRatioPct,
        stressedCapitalRatioPct,
        adverseTailCapitalRatioPct,
        cossecMinimumPct,
        adverseCushionBps: projection.adverseCushionBps,
        breachesFloorAtAdverseTail: projection.breachesFloorAtAdverseTail,
        breachProbabilityPct: projection.breachProbabilityPct,
        narrative,
        narrativeEs,
      },
      findings,
      reverseStress,
      pipeline: [
        {
          step: '1',
          name: 'Validate (D1, no phantom zeros)',
          status: 'completed',
        },
        { step: '2', name: 'COSSEC 12-ratio matrix', status: 'completed' },
        {
          step: '3',
          name: 'Capital-ratio Monte Carlo (seeded, reproducible)',
          status: 'completed',
        },
        { step: '4', name: 'SIC 2026 stress scenario', status: 'completed' },
        { step: '5', name: 'Bilingual PDF render', status: 'requires_infra' },
        {
          step: '5b',
          name: 'Artifact checksum (SHA-256)',
          status: 'completed',
        },
        { step: '6', name: 'S3 upload (signed URL)', status: 'requires_infra' },
        { step: '7', name: 'Email notification', status: 'requires_infra' },
      ],
      gaps,
      modelLineage: [
        {
          model: 'COSSEC 12-ratio engine',
          source: 'AlmEnterpriseService.getCOSSECCompliance',
        },
        {
          model: 'NII sensitivity',
          source: 'AlmEnterpriseService.calculateNIISensitivity',
        },
        {
          model: 'Named stress scenarios',
          source: 'StressTestingService.runCOSSECScenarios',
        },
        {
          model: 'Cooperativa CECL (PD×LGD)',
          source: 'CECLService.getCooperativaCECLAnalysis',
        },
        {
          model: 'Capital-ratio-under-stress projection',
          source:
            'demo/capital-ratio-projection.projectCapitalRatioUnderStress',
        },
      ],
    };

    // ── Step 5b: deterministic artifact checksum over the canonical result ──
    const resultChecksum = createHash('sha256')
      .update(JSON.stringify(result))
      .digest('hex');

    return { ...result, resultChecksum };
  }
}
