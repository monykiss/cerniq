import { Injectable } from '@nestjs/common';

import {
  COOPERATIVA_PRODUCT_REGISTRY,
  type CooperativaProductType,
} from '../cooperativa/product-registry';
import { isLendingProduct } from '../cooperativa/product-mapping';
import { dataGap, type DataGap } from '../reports/data-gap';

/**
 * Loan lifecycle stages — the state a single LOAN is in, as distinct from the
 * lifecycle stage of the MEMBER who holds it.
 *
 * WHY THIS IS NOT THE SAME ENUM AS MemberLifecycleStage
 * ----------------------------------------------------
 * `MemberLifecycleService` classifies a *relationship*: a socio with any loan
 * at >=90 DPD is in WORKOUT, because that is the posture the cooperativa takes
 * toward the person. A *loan* at >=90 DPD is in NONACCRUAL — the accounting
 * state where the institution stops recognizing interest income.
 *
 * Those are genuinely different facts and collapsing them into one enum would
 * force one of them to lie. A member can be in WORKOUT while holding a
 * perfectly CURRENT auto loan and a NONACCRUAL mortgage; that is the normal
 * case, not an edge case.
 *
 * WORKOUT here means a restructuring actually happened (a TDR — troubled debt
 * restructuring: rate concession, term extension, re-aged payment schedule).
 * It is NEVER inferred from delinquency days, because "this loan is 120 days
 * down" and "we renegotiated this loan" are different events and only the
 * second one is a workout.
 */
export const LOAN_LIFECYCLE_STAGES = [
  'ORIGINATED',
  'CURRENT',
  'EARLY_DELINQUENCY',
  'DELINQUENT_30',
  'DELINQUENT_60',
  'NONACCRUAL',
  'WORKOUT',
  'PAID_OFF',
  'CHARGED_OFF',
] as const;

export type LoanLifecycleStage = (typeof LOAN_LIFECYCLE_STAGES)[number];

/**
 * COSSEC NPL classification buckets. Mirrors the string values already stored
 * in `MemberAccount.cossecClassification` — never defaulted to 'pass'.
 */
export type CossecClassification =
  | 'pass'
  | 'special_mention'
  | 'substandard'
  | 'doubtful'
  | 'loss';

/**
 * The subset of loan fields the classifier needs. Plain numbers only — callers
 * coerce Prisma `Decimal` before calling, exactly like `AccountSignal` in
 * MemberLifecycleService, so this file never touches Prisma's Decimal type.
 */
export interface LoanSignal {
  id: string;
  /** Canonical product code. Null when the label could not be mapped (D1). */
  productCode: CooperativaProductType | null;
  /** Current outstanding principal. */
  balance: number;
  /** Original principal at origination, when known. */
  originalPrincipal: number | null;
  /**
   * Days past due. NULL MEANS UNKNOWN, NOT CURRENT — a tape that omitted the
   * column cannot be read as "everything is performing".
   */
  delinquencyDays: number | null;
  openedDate: Date;
  maturityDate: Date | null;
  /**
   * Whether this loan has been restructured/re-aged. Explicit input, never
   * inferred — see the WORKOUT note above.
   */
  restructured?: boolean;
  /**
   * Whether the back office has charged this loan off. Explicit input, never
   * inferred — same discipline as MemberLifecycleStage.CHARGED_OFF.
   */
  chargedOff?: boolean;
}

export interface LoanClassification {
  /**
   * Null when delinquency is unknown — the honest state. A null stage renders
   * as a gap in the UI rather than as a green CURRENT badge.
   */
  stage: LoanLifecycleStage | null;
  /** Plain-language reasons, so a stage is never an unexplained label. */
  reasons: string[];
  /** Null whenever `stage` is null — an unclassified loan is never 'pass'. */
  cossecClassification: CossecClassification | null;
  gaps: DataGap[];
}

export interface LoanEconomics {
  /** PD x LGD x balance, using registry cold-start priors. */
  expectedLoss: number | null;
  annualPd: number | null;
  lgd: number | null;
  /**
   * Fraction of the loan's scheduled term already elapsed, 0..1. Null when the
   * maturity date is unknown — never assumed from the product default, because
   * a 30-year mortgage and the registry's 18-year WAM prior are different
   * numbers and only one of them is this loan's.
   */
  termElapsedFraction: number | null;
  /** Principal repaid so far as a fraction of original, 0..1. */
  principalRepaidFraction: number | null;
  gaps: DataGap[];
}

/**
 * Classifies individual loans through their full servicing lifecycle and
 * prices their expected loss off the cooperativa product registry.
 *
 * Every threshold is a named constant. Deliberately rule-based and disclosed —
 * same discipline as MemberLifecycleService and the EWS composite.
 */
@Injectable()
export class LoanLifecycleService {
  /**
   * Days-past-due bucket boundaries.
   *
   * These follow the NCUA 5300 / COSSEC delinquency buckets (30-59, 60-89,
   * 90+) rather than inventing new ones, so a Member 360 stage count can be
   * reconciled against the institution's own regulatory reporting. The 90-day
   * boundary is also the conventional nonaccrual trigger.
   */
  static readonly DPD_EARLY = 1;
  static readonly DPD_30 = 30;
  static readonly DPD_60 = 60;
  static readonly DPD_NONACCRUAL = 90;

  /**
   * A loan opened within this window with no delinquency is still ORIGINATED
   * rather than CURRENT — it has not yet survived a full payment cycle, so
   * calling it "performing" overstates what is actually known about it.
   */
  static readonly ORIGINATION_WINDOW_DAYS = 90;

  /**
   * Classifies one loan. `asOf` is injected rather than read from the clock so
   * the result is reproducible in tests and in the deterministic fixture book.
   */
  classifyLoan(loan: LoanSignal, asOf: Date): LoanClassification {
    const gaps: DataGap[] = [];

    // ── Terminal states first: both are explicit inputs, never inferred ──
    if (loan.chargedOff === true) {
      return {
        stage: 'CHARGED_OFF',
        reasons: [
          'Charged off by the back office (explicit action, not inferred)',
        ],
        cossecClassification: 'loss',
        gaps,
      };
    }

    // Reached only when chargedOff is not true (the branch above returned), so
    // a zero balance here really is repayment rather than a write-off.
    if (loan.balance === 0) {
      // A true zero on a closed loan is the real value, not a phantom zero —
      // the same distinction delinquencyDays already documents.
      return {
        stage: 'PAID_OFF',
        reasons: ['Outstanding principal is zero — the loan is repaid'],
        cossecClassification: 'pass',
        gaps,
      };
    }

    // ── D1: unknown delinquency is NOT performing ──
    if (loan.delinquencyDays === null) {
      gaps.push(
        dataGap(`loan.${loan.id}.delinquencyDays`, 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action:
            'Provide days-past-due for this loan so its lifecycle stage and ' +
            'COSSEC classification can be determined.',
          context: { loanId: loan.id },
        }),
      );
      return {
        stage: null,
        reasons: [
          'Days past due was not provided, so performance cannot be determined',
        ],
        cossecClassification: null,
        gaps,
      };
    }

    const dpd = loan.delinquencyDays;

    // ── Restructured loans: WORKOUT outranks the DPD buckets ──
    // A re-aged loan can read as 0 DPD precisely because it was re-aged; the
    // restructuring is the more important fact about it.
    if (loan.restructured === true) {
      return {
        stage: 'WORKOUT',
        reasons: [
          'Loan has been restructured (troubled debt restructuring)',
          `Currently ${dpd} days past due`,
        ],
        cossecClassification:
          dpd >= LoanLifecycleService.DPD_30
            ? 'substandard'
            : 'special_mention',
        gaps,
      };
    }

    if (dpd >= LoanLifecycleService.DPD_NONACCRUAL) {
      return {
        stage: 'NONACCRUAL',
        reasons: [
          `${dpd} days past due (>= ${LoanLifecycleService.DPD_NONACCRUAL} DPD nonaccrual threshold)`,
          'Interest accrual should be suspended',
        ],
        cossecClassification: 'doubtful',
        gaps,
      };
    }

    if (dpd >= LoanLifecycleService.DPD_60) {
      return {
        stage: 'DELINQUENT_60',
        reasons: [`${dpd} days past due (60-89 DPD bucket)`],
        cossecClassification: 'substandard',
        gaps,
      };
    }

    if (dpd >= LoanLifecycleService.DPD_30) {
      return {
        stage: 'DELINQUENT_30',
        reasons: [`${dpd} days past due (30-59 DPD bucket)`],
        cossecClassification: 'special_mention',
        gaps,
      };
    }

    if (dpd >= LoanLifecycleService.DPD_EARLY) {
      return {
        stage: 'EARLY_DELINQUENCY',
        reasons: [`${dpd} days past due (1-29 DPD, pre-reportable)`],
        cossecClassification: 'pass',
        gaps,
      };
    }

    // ── Performing. Distinguish a brand-new loan from a seasoned one. ──
    const ageDays = this.daysBetween(loan.openedDate, asOf);
    if (ageDays <= LoanLifecycleService.ORIGINATION_WINDOW_DAYS) {
      return {
        stage: 'ORIGINATED',
        reasons: [
          `Opened ${ageDays} days ago (within the ${LoanLifecycleService.ORIGINATION_WINDOW_DAYS}-day origination window)`,
          'Current, but has not yet seasoned through a full payment cycle',
        ],
        cossecClassification: 'pass',
        gaps,
      };
    }

    return {
      stage: 'CURRENT',
      reasons: ['Current — zero days past due'],
      cossecClassification: 'pass',
      gaps,
    };
  }

  /**
   * Prices a loan off the registry's cold-start PD/LGD priors.
   *
   * The registry itself documents these as provisional (OPERATOR-INPUT-NEEDED
   * until the institution's own loss history is available), so every result
   * carries a WARNING gap naming that provenance rather than presenting a
   * calibrated-looking number.
   */
  economics(loan: LoanSignal, asOf: Date): LoanEconomics {
    const gaps: DataGap[] = [];

    if (loan.productCode === null) {
      gaps.push(
        dataGap(`loan.${loan.id}.productCode`, 'PRODUCT_TYPE_UNMAPPED', {
          severity: 'WARNING',
          action:
            'Map this product label to the cooperativa product registry so ' +
            'the loan can be priced and enter CECL.',
          context: { loanId: loan.id },
        }),
      );
      return {
        expectedLoss: null,
        annualPd: null,
        lgd: null,
        termElapsedFraction: null,
        principalRepaidFraction: this.principalRepaid(loan),
        gaps,
      };
    }

    if (!isLendingProduct(loan.productCode)) {
      // Deposits and shares have no PD by construction — that is not a gap.
      return {
        expectedLoss: null,
        annualPd: null,
        lgd: null,
        termElapsedFraction: null,
        principalRepaidFraction: null,
        gaps,
      };
    }

    const defaults = COOPERATIVA_PRODUCT_REGISTRY[loan.productCode];
    const pd = defaults.defaultAnnualPd;
    const lgd = defaults.defaultLgd;

    if (pd === null || lgd === null) {
      return {
        expectedLoss: null,
        annualPd: null,
        lgd: null,
        termElapsedFraction: this.termElapsed(loan, asOf),
        principalRepaidFraction: this.principalRepaid(loan),
        gaps,
      };
    }

    gaps.push(
      dataGap(`loan.${loan.id}.expectedLoss`, 'PD_LGD_REGISTRY_DEFAULT', {
        severity: 'WARNING',
        action:
          'Expected loss uses the registry cold-start PD/LGD prior for ' +
          `${loan.productCode}, not this institution's own loss history. ` +
          'Calibrate against historical losses before relying on it.',
        context: {
          loanId: loan.id,
          productCode: loan.productCode,
          provenance: 'registry-default',
        },
      }),
    );

    return {
      expectedLoss: loan.balance * pd * lgd,
      annualPd: pd,
      lgd,
      termElapsedFraction: this.termElapsed(loan, asOf),
      principalRepaidFraction: this.principalRepaid(loan),
      gaps,
    };
  }

  /** Whole days from `from` to `to`, floored at 0. */
  private daysBetween(from: Date, to: Date): number {
    const ms = to.getTime() - from.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  }

  /**
   * Fraction of the scheduled term elapsed at `asOf`, clamped to 0..1.
   *
   * Null when maturity is unknown — deliberately NOT substituted with the
   * registry's `defaultMaturityYears`. That prior is a portfolio-level WAM
   * assumption; using it as though it were this loan's schedule would turn a
   * missing field into a specific-looking number for one named member.
   */
  private termElapsed(loan: LoanSignal, asOf: Date): number | null {
    if (loan.maturityDate === null) return null;
    const totalMs = loan.maturityDate.getTime() - loan.openedDate.getTime();
    if (totalMs <= 0) return null;
    const elapsedMs = asOf.getTime() - loan.openedDate.getTime();
    return Math.min(1, Math.max(0, elapsedMs / totalMs));
  }

  private principalRepaid(loan: LoanSignal): number | null {
    if (loan.originalPrincipal === null || loan.originalPrincipal <= 0) {
      return null;
    }
    const repaid =
      (loan.originalPrincipal - loan.balance) / loan.originalPrincipal;
    return Math.min(1, Math.max(0, repaid));
  }
}
