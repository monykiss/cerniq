import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { StressTestingService } from './stress-testing/stress-testing.service';
import { ScenarioPersistenceService } from './scenarios/scenario-persistence.service';
import { DataGap, dataGap } from './reports/data-gap';

/** Round to n decimal places with NaN guard */
function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ─── Interfaces ─────────────────────────────────────────────────

export interface CustomScenarioParams {
  name: string;
  rateShiftBps: number; // -300 to +300 bps parallel shift
  yieldCurveTwist?: number; // bps twist (short end vs long end)
  depositRunoff?: number; // 0-30% deposit flight
  loanDefaultIncrease?: number; // 0-15% increase in defaults
  prepaymentMultiplier?: number; // 0.5x to 3x CPR multiplier
}

export interface CustomScenarioResult {
  scenario: {
    id: string;
    name: string;
    params: CustomScenarioParams;
    createdAt: string;
  };
  /**
   * Numeric impacts. D1 (2026-04-07): when input data is incomplete (e.g.
   * COSSEC compliance is data_unavailable, LCR is null), every impact is
   * `null` instead of a phantom value computed on partial data. The
   * `gaps[]` manifest names what's missing.
   */
  niiImpact: number | null; // $ millions
  eveChange: number | null; // $ millions
  lcrImpact: number | null; // percentage points
  capitalImpact: number | null; // percentage points
  narrative: string;
  overallStatus: 'computed' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class CustomScenarioService {
  private readonly logger = new Logger(CustomScenarioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
    private readonly scenarioPersistence: ScenarioPersistenceService,
  ) {}

  /**
   * Run a custom rate-shock scenario for an institution.
   *
   * Computes NII impact, EVE change, LCR impact, and capital impact
   * using the existing stress-testing infrastructure, then persists the
   * scenario for future reference.
   */
  async runCustomScenario(
    institutionId: string,
    params: CustomScenarioParams,
  ): Promise<CustomScenarioResult> {
    // ── Validate inputs ──
    this.validateParams(params);

    const rateShiftBps = Math.max(-300, Math.min(300, params.rateShiftBps));
    const yieldCurveTwist = Math.max(
      -200,
      Math.min(200, params.yieldCurveTwist ?? 0),
    );
    const depositRunoff = Math.max(0, Math.min(30, params.depositRunoff ?? 0));
    const loanDefaultIncrease = Math.max(
      0,
      Math.min(15, params.loanDefaultIncrease ?? 0),
    );
    const prepaymentMultiplier = Math.max(
      0.5,
      Math.min(3, params.prepaymentMultiplier ?? 1),
    );

    this.logger.log(
      `Custom scenario "${params.name}" for ${institutionId}: ` +
        `rate=${rateShiftBps}bps, twist=${yieldCurveTwist}bps, ` +
        `depositRunoff=${depositRunoff}%, defaults=${loanDefaultIncrease}%, ` +
        `prepay=${prepaymentMultiplier}x`,
    );

    // ── Fetch institution data ──
    let niiSensitivity: any;
    let liquidity: any;
    let cossec: any;
    let durationGap: any;

    try {
      [niiSensitivity, liquidity, cossec, durationGap] = await Promise.all([
        this.almEnterprise.calculateNIISensitivity(institutionId),
        this.almEnterprise.calculateLCR(institutionId),
        this.almEnterprise.getCOSSECCompliance(institutionId),
        this.almEnterprise.calculateDurationGap(institutionId),
      ]);
    } catch (err) {
      this.logger.warn(
        `Custom scenario: could not load institution data — ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Unable to load institution data. Ensure balance sheet is uploaded.',
      );
    }

    // D1 (2026-04-07): refuse to compute custom scenarios when any
    // critical input is missing. The previous implementation used
    // `?? 0` to silently coerce missing COSSEC/LCR data to zero, then
    // the impact math (eveChange, capitalImpact) computed on phantom
    // zeros and the scenario "succeeded" with garbage. Now we detect
    // the data_unavailable state and return a structured result with
    // null impacts + a CRITICAL gap manifest. Callers branch on
    // `overallStatus === 'data_unavailable'`.
    const inputGaps: DataGap[] = [];
    if (cossec.overallStatus === 'data_unavailable') {
      inputGaps.push(
        dataGap('customScenario.cossec', 'COSSEC_INPUTS_INSUFFICIENT', {
          severity: 'CRITICAL',
          action:
            'Custom scenario requires COSSEC compliance inputs. Upload balance sheet items first.',
          context: { institutionId },
        }),
        ...(cossec.gaps ?? []),
      );
    }
    if (liquidity.lcr === null || liquidity.status === 'data_unavailable') {
      inputGaps.push(
        dataGap('customScenario.lcr', 'NO_LIQUIDITY_POSITION', {
          severity: 'CRITICAL',
          action:
            'Custom scenario requires a current liquidity position. Upload one before running scenarios.',
          context: { institutionId },
        }),
        ...(liquidity.gaps ?? []),
      );
    }
    if (inputGaps.length > 0) {
      this.logger.warn({
        event: 'custom_scenario_data_unavailable',
        institutionId,
        scenarioName: params.name,
        gapCount: inputGaps.length,
      });
      return {
        scenario: {
          id: 'data-unavailable',
          name: params.name,
          params,
          createdAt: new Date().toISOString(),
        },
        niiImpact: null,
        eveChange: null,
        lcrImpact: null,
        capitalImpact: null,
        narrative:
          'Custom scenario could not be computed — required inputs are missing. See gaps manifest for the upload checklist.',
        overallStatus: 'data_unavailable',
        gaps: inputGaps,
      };
    }

    const baseNII = niiSensitivity.baseNII; // in $M
    const baseLCR = liquidity.lcr; // narrowed: not null after the guard above
    const summary = cossec.summary;
    const totalAssets = summary.totalAssets;
    const totalLoans = summary.totalLoans;
    const totalShares = summary.totalShares;
    const capitalRatio = summary.capitalRatio;
    const gap = durationGap.durationGap;

    // ── 1. NII Impact from rate shift ──
    // Find closest NII sensitivity scenario and interpolate
    const closestScenario = niiSensitivity.scenarios.reduce(
      (prev: any, curr: any) =>
        Math.abs(curr.shiftBps - rateShiftBps) <
        Math.abs(prev.shiftBps - rateShiftBps)
          ? curr
          : prev,
    );
    const scaleFactor =
      closestScenario.shiftBps !== 0
        ? rateShiftBps / closestScenario.shiftBps
        : 1;
    let niiImpact = round(closestScenario.niImpact * scaleFactor, 2);

    // Yield curve twist adjustment: if twist is nonzero, short-end and
    // long-end rates diverge.  For an asset-sensitive institution (positive
    // duration gap), a bear steepener (positive twist) compresses NIM
    // because short liabilities reprice up faster than long assets.
    if (yieldCurveTwist !== 0) {
      const twistFactor = (yieldCurveTwist / 100) * Math.abs(gap) * 0.3;
      niiImpact = round(niiImpact - baseNII * twistFactor, 2);
    }

    // Prepayment multiplier: higher prepayments on assets reduce
    // interest income when rates fall (refinancing).  Scale NII impact.
    if (prepaymentMultiplier !== 1 && rateShiftBps < 0) {
      // Prepayment effect is most relevant in falling-rate environment
      const prepayLoss =
        baseNII *
        (prepaymentMultiplier - 1) *
        0.03 *
        (Math.abs(rateShiftBps) / 300);
      niiImpact = round(niiImpact - prepayLoss, 2);
    }

    // ── 2. EVE Change ──
    // EVE = Present Value of Assets - Present Value of Liabilities
    // Under a parallel rate shock, EVE changes by approximately:
    //   ΔEVE ≈ -DurationGap × TotalAssets × Δr
    const deltaRate = rateShiftBps / 10000; // convert bps to decimal
    let eveChange = round(-gap * totalAssets * deltaRate, 2);

    // Twist component: twist primarily affects EVE through
    // differential repricing of short vs long positions
    if (yieldCurveTwist !== 0) {
      const twistDeltaRate = yieldCurveTwist / 10000;
      const twistEVE = totalAssets * twistDeltaRate * 0.15; // 15% pass-through
      eveChange = round(eveChange - twistEVE, 2);
    }

    // ── 3. LCR Impact ──
    // Deposit runoff reduces HQLA and increases net outflows
    const hqla = liquidity.hqla || 0;
    let lcrImpact = 0;
    if (depositRunoff > 0) {
      const depositOutflow = totalShares * (depositRunoff / 100);
      const lcrReduction =
        hqla > 0
          ? (depositOutflow / Math.max(hqla, 1)) * 100 * 0.5 // 50% pass-through
          : depositRunoff * 2;
      lcrImpact = round(-lcrReduction, 2);
    }

    // Rate shock also affects LCR through bond revaluation
    if (Math.abs(rateShiftBps) > 100) {
      const rateLCREffect = ((Math.abs(rateShiftBps) - 100) / 100) * 2; // ~2% per 100bps beyond 100
      lcrImpact = round(lcrImpact - rateLCREffect, 2);
    }

    // ── 4. Capital Impact ──
    // Additional credit losses from increased defaults
    const additionalCreditLoss = totalLoans * (loanDefaultIncrease / 100);
    let capitalImpact =
      totalAssets > 0
        ? round(-(additionalCreditLoss / totalAssets) * 100, 2)
        : 0;

    // EVE loss also affects capital through unrealized losses
    if (totalAssets > 0) {
      const eveCapitalEffect = (eveChange / totalAssets) * 100;
      capitalImpact = round(capitalImpact + eveCapitalEffect, 2);
    }

    // ── 5. Build narrative ──
    const narrative = this.buildNarrative(
      params.name,
      rateShiftBps,
      yieldCurveTwist,
      depositRunoff,
      loanDefaultIncrease,
      prepaymentMultiplier,
      niiImpact,
      baseNII,
      eveChange,
      baseLCR,
      lcrImpact,
      capitalRatio,
      capitalImpact,
    );

    // ── 6. Persist scenario ──
    const saved = await this.scenarioPersistence.saveScenario('system', {
      institutionId,
      name: params.name,
      description: narrative,
      scenarioType: 'custom',
      parameters: {
        rateShiftBps,
        yieldCurveTwist,
        depositRunoff,
        loanDefaultIncrease,
        prepaymentMultiplier,
      },
      results: {
        niiImpact,
        eveChange,
        lcrImpact,
        capitalImpact,
        narrative,
      },
      tags: ['custom', 'rate-shock'],
    });

    return {
      scenario: {
        id: saved.id,
        name: params.name,
        params,
        createdAt: saved.createdAt.toISOString(),
      },
      niiImpact,
      eveChange,
      lcrImpact,
      capitalImpact,
      narrative,
      overallStatus: 'computed',
    };
  }

  // ─── Validation ─────────────────────────────────────────────────

  private validateParams(params: CustomScenarioParams): void {
    if (!params.name || params.name.trim().length === 0) {
      throw new BadRequestException('Scenario name is required');
    }
    if (params.name.length > 200) {
      throw new BadRequestException(
        'Scenario name must be 200 characters or fewer',
      );
    }
    if (
      typeof params.rateShiftBps !== 'number' ||
      !Number.isFinite(params.rateShiftBps)
    ) {
      throw new BadRequestException(
        'rateShiftBps must be a finite number between -300 and +300',
      );
    }
    if (params.rateShiftBps < -300 || params.rateShiftBps > 300) {
      throw new BadRequestException(
        'rateShiftBps must be between -300 and +300',
      );
    }
    if (
      params.yieldCurveTwist !== undefined &&
      (params.yieldCurveTwist < -200 || params.yieldCurveTwist > 200)
    ) {
      throw new BadRequestException(
        'yieldCurveTwist must be between -200 and +200',
      );
    }
    if (
      params.depositRunoff !== undefined &&
      (params.depositRunoff < 0 || params.depositRunoff > 30)
    ) {
      throw new BadRequestException('depositRunoff must be between 0 and 30');
    }
    if (
      params.loanDefaultIncrease !== undefined &&
      (params.loanDefaultIncrease < 0 || params.loanDefaultIncrease > 15)
    ) {
      throw new BadRequestException(
        'loanDefaultIncrease must be between 0 and 15',
      );
    }
    if (
      params.prepaymentMultiplier !== undefined &&
      (params.prepaymentMultiplier < 0.5 || params.prepaymentMultiplier > 3)
    ) {
      throw new BadRequestException(
        'prepaymentMultiplier must be between 0.5 and 3',
      );
    }
  }

  // ─── Narrative Builder ──────────────────────────────────────────

  private buildNarrative(
    name: string,
    rateShiftBps: number,
    yieldCurveTwist: number,
    depositRunoff: number,
    loanDefaultIncrease: number,
    prepaymentMultiplier: number,
    niiImpact: number,
    baseNII: number,
    eveChange: number,
    baseLCR: number,
    lcrImpact: number,
    capitalRatio: number,
    capitalImpact: number,
  ): string {
    const parts: string[] = [];

    parts.push(`Scenario "${name}":`);

    // Describe shocks applied
    const shocks: string[] = [];
    if (rateShiftBps !== 0) {
      shocks.push(
        `${rateShiftBps > 0 ? '+' : ''}${rateShiftBps}bps parallel rate shift`,
      );
    }
    if (yieldCurveTwist !== 0) {
      shocks.push(
        `${yieldCurveTwist > 0 ? '+' : ''}${yieldCurveTwist}bps yield curve twist`,
      );
    }
    if (depositRunoff > 0) {
      shocks.push(`${depositRunoff}% deposit runoff`);
    }
    if (loanDefaultIncrease > 0) {
      shocks.push(`${loanDefaultIncrease}% increase in loan defaults`);
    }
    if (prepaymentMultiplier !== 1) {
      shocks.push(`${prepaymentMultiplier}x prepayment multiplier`);
    }

    if (shocks.length > 0) {
      parts.push(`Applied shocks: ${shocks.join(', ')}.`);
    } else {
      parts.push('No shocks applied (baseline scenario).');
    }

    // Describe impacts
    const niiPct = baseNII !== 0 ? round((niiImpact / baseNII) * 100, 1) : 0;
    parts.push(
      `NII impact: ${niiImpact >= 0 ? '+' : ''}$${niiImpact.toFixed(2)}M (${niiPct >= 0 ? '+' : ''}${niiPct}% of base NII).`,
    );
    parts.push(
      `EVE change: ${eveChange >= 0 ? '+' : ''}$${eveChange.toFixed(2)}M.`,
    );

    const lcrAfter = round(baseLCR + lcrImpact, 1);
    parts.push(
      `LCR moves from ${baseLCR.toFixed(1)}% to ${lcrAfter.toFixed(1)}% (${lcrImpact >= 0 ? '+' : ''}${lcrImpact.toFixed(1)}pp).`,
    );

    const capitalAfter = round(capitalRatio + capitalImpact, 2);
    parts.push(
      `Capital ratio adjusts from ${capitalRatio.toFixed(2)}% to ${capitalAfter.toFixed(2)}% (${capitalImpact >= 0 ? '+' : ''}${capitalImpact.toFixed(2)}pp).`,
    );

    // Overall assessment
    if (capitalAfter >= 8 && lcrAfter >= 100) {
      parts.push(
        'Assessment: Institution remains well-capitalized and liquid.',
      );
    } else if (capitalAfter >= 6 && lcrAfter >= 90) {
      parts.push(
        'Assessment: Institution remains adequately capitalized but warrants monitoring.',
      );
    } else if (capitalAfter >= 4) {
      parts.push(
        'Assessment: Institution is vulnerable under this scenario. Remedial action recommended.',
      );
    } else {
      parts.push(
        'Assessment: CRITICAL — institution faces significant solvency risk under this scenario.',
      );
    }

    return parts.join(' ');
  }
}
