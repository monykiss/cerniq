import { Injectable, Logger } from '@nestjs/common';
import { MemberAccountCategory } from '@prisma/client';

import type { CooperativaProductType } from '../cooperativa/product-registry';
import {
  LoanLifecycleService,
  type LoanLifecycleStage,
  type LoanSignal,
} from './loan-lifecycle.service';

/**
 * Deterministic fixture data for the Member 360 demo surface.
 *
 * Wave 3 / Layer 3 (docs/CERNIQ_LAYER2_3_ROADMAP.md §4) is gated on a still-
 * open discovery question — can a real cooperativa's core system export
 * member-level data, and will its board consent to sharing socio PII. No
 * design partner is confirmed as of this slice, so this service produces a
 * realistic, bilingual, PR-cooperativa-shaped member book that lets every
 * other Member 360 surface (lifecycle classification, the 360 profile view,
 * the directory) be demoed and tested end-to-end today. Swapping this for a
 * real core-system adapter later changes nothing downstream — it is the same
 * MemberSeed[] shape either way.
 *
 * Seeded, not random: `verify:no-unseeded-random` bans bare `Math.random()`
 * in src/alm because a fixture that changes on every call cannot be demoed
 * reproducibly or golden-locked. `mulberry32` seeded from
 * `institutionId:index` makes the SAME institution produce the SAME member
 * book every time, and different institutions produce different books.
 */

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Common PR-cooperativa first/last names — bilingual, plausible, not real people. */
const FIRST_NAMES = [
  'María',
  'José',
  'Carmen',
  'Luis',
  'Ana',
  'Juan',
  'Rosa',
  'Carlos',
  'Elena',
  'Miguel',
  'Sofía',
  'Rafael',
  'Gabriela',
  'Ángel',
  'Ivelisse',
  'Pedro',
  'Yolanda',
  'Francisco',
  'Nilda',
  'Héctor',
  'Awilda',
  'Ramón',
  'Migdalia',
  'Eduardo',
  'Wanda',
  'Antonio',
  'Zoraida',
  'Manuel',
  'Lourdes',
  'Iván',
] as const;

const LAST_NAMES = [
  'Rodríguez',
  'González',
  'Rivera',
  'Martínez',
  'Torres',
  'Ortiz',
  'Vázquez',
  'Rosario',
  'Santiago',
  'Colón',
  'Feliciano',
  'Cruz',
  'Morales',
  'Reyes',
  'Class',
  'Meléndez',
  'Ramos',
  'Díaz',
  'Pérez',
  'Figueroa',
] as const;

/** Mirrors cooperativa/product-registry.ts's 8-product taxonomy by label. */
interface ProductTemplate {
  productType: string;
  /**
   * Canonical registry code for this template.
   *
   * Declared explicitly rather than derived at generation time so the fixture
   * book does not silently depend on the mapper's behaviour — but the spec
   * asserts `mapProductLabel(productType).productType === productCode` for
   * every template, so the label and the code cannot drift apart either.
   */
  productCode: CooperativaProductType;
  category: MemberAccountCategory;
  balanceRangeUSD: [number, number];
  /** Annual rate as a decimal (0.065 = 6.5%). Null for SHARE (no stated rate). */
  rateRange: [number, number] | null;
  /** Fraction of members who hold this product, independent per product. */
  incidence: number;
  isLoan: boolean;
  /**
   * Scheduled term in years, per product — a mortgage does not amortize on the
   * same clock as an auto loan, and the demo book is unconvincing if they do.
   * Anchored on the registry's `defaultMaturityYears` WAM priors, rounded to
   * the contractual terms a PR cooperativa actually writes.
   */
  termYears: number;
}

const PRODUCT_TEMPLATES: readonly ProductTemplate[] = [
  {
    productType: 'acciones',
    productCode: 'CUENTA_AHORRO',
    category: MemberAccountCategory.SHARE,
    balanceRangeUSD: [25, 500],
    rateRange: null,
    incidence: 1.0,
    isLoan: false,
    termYears: 0,
  },
  {
    productType: 'cuenta de ahorros',
    productCode: 'CUENTA_AHORRO',
    category: MemberAccountCategory.DEPOSIT,
    balanceRangeUSD: [200, 45000],
    rateRange: [0.001, 0.015],
    incidence: 0.86,
    isLoan: false,
    termYears: 0,
  },
  {
    productType: 'certificado de depósito',
    productCode: 'CERTIFICADO_DEPOSITO',
    category: MemberAccountCategory.DEPOSIT,
    balanceRangeUSD: [1000, 60000],
    rateRange: [0.02, 0.045],
    incidence: 0.17,
    isLoan: false,
    termYears: 1,
  },
  {
    productType: 'préstamo personal',
    productCode: 'PRESTAMO_PERSONAL',
    category: MemberAccountCategory.LOAN,
    balanceRangeUSD: [800, 15000],
    rateRange: [0.09, 0.16],
    incidence: 0.28,
    isLoan: true,
    termYears: 4,
  },
  {
    productType: 'préstamo de auto',
    productCode: 'PRESTAMO_AUTO',
    category: MemberAccountCategory.LOAN,
    balanceRangeUSD: [4000, 32000],
    rateRange: [0.055, 0.09],
    incidence: 0.19,
    isLoan: true,
    termYears: 5,
  },
  {
    productType: 'hipoteca',
    productCode: 'HIPOTECA',
    category: MemberAccountCategory.LOAN,
    balanceRangeUSD: [45000, 260000],
    rateRange: [0.045, 0.07],
    incidence: 0.06,
    isLoan: true,
    termYears: 20,
  },
  {
    productType: 'préstamo comercial',
    productCode: 'PRESTAMO_COMERCIAL',
    category: MemberAccountCategory.LOAN,
    balanceRangeUSD: [15000, 180000],
    rateRange: [0.065, 0.11],
    incidence: 0.03,
    isLoan: true,
    termYears: 7,
  },
  {
    productType: 'garantía de acciones',
    productCode: 'PRESTAMO_GARANTIA_ACCIONES',
    category: MemberAccountCategory.LOAN,
    balanceRangeUSD: [500, 8000],
    rateRange: [0.06, 0.085],
    incidence: 0.08,
    isLoan: true,
    termYears: 2,
  },
];

/** Delinquency distribution for accounts flagged `isLoan` — cumulative bands. */
const DELINQUENCY_BANDS: readonly { maxDays: number; upTo: number }[] = [
  { maxDays: 0, upTo: 0.8 }, // current
  { maxDays: 29, upTo: 0.9 },
  { maxDays: 59, upTo: 0.96 },
  { maxDays: 89, upTo: 0.99 },
  { maxDays: 150, upTo: 1.0 },
];

export interface MemberAccountSeed {
  productType: string;
  /** Canonical registry code — see ProductTemplate.productCode. */
  productCode: CooperativaProductType;
  category: MemberAccountCategory;
  balance: number;
  /** Principal at origination. Null for non-loan accounts. */
  originalPrincipal: number | null;
  interestRate: number | null;
  delinquencyDays: number | null;
  maturityDate: Date | null;
  openedDate: Date;
  /**
   * Both of these come from LoanLifecycleService.classifyLoan(), which is the
   * single COSSEC-mapping authority in the codebase. The fixture deliberately
   * does NOT carry its own delinquency->classification table: a second mapping
   * is the same drift hazard the product taxonomy just had, and here it would
   * disagree with the classifier the product actually ships.
   */
  cossecClassification: string | null;
  loanStage: LoanLifecycleStage | null;
  /** Explicit lifecycle facts — never inferred from delinquency days. */
  restructured: boolean;
  chargedOff: boolean;
}

export interface MemberSeed {
  memberNumber: string;
  fullName: string;
  memberSince: Date;
  accounts: MemberAccountSeed[];
}

/**
 * The fixture's own delinquency->COSSEC table used to live here. It was
 * deleted on purpose: it mapped 1-29 DPD to `special_mention` while
 * LoanLifecycleService maps that same bucket to `pass`, so the demo book
 * disagreed with the classifier the product actually ships.
 *
 * COSSEC/NCUA special mention begins at 30 days; 1-29 DPD is a performing
 * loan. Classification now comes from LoanLifecycleService.classifyLoan() and
 * nowhere else — one authority, exactly like the product taxonomy.
 */

/** The pinned loan-lifecycle cohorts, in the index order they occupy. */
type LoanCohort = 'workout' | 'chargedOff' | 'nonaccrual' | 'paidOff';

function pickDelinquencyDays(rng: () => number): number {
  const roll = rng();
  for (const band of DELINQUENCY_BANDS) {
    if (roll <= band.upTo) {
      if (band.maxDays === 0) return 0;
      const prevMax =
        DELINQUENCY_BANDS[DELINQUENCY_BANDS.indexOf(band) - 1]?.maxDays ?? 0;
      return prevMax + 1 + Math.floor(rng() * (band.maxDays - prevMax));
    }
  }
  return 0;
}

function randomInRange(
  rng: () => number,
  [min, max]: [number, number],
): number {
  return min + rng() * (max - min);
}

function randomPastDate(
  rng: () => number,
  maxYearsAgo: number,
  minDaysAgo: number,
  asOfMs: number,
): Date {
  const msAgo =
    minDaysAgo * 86_400_000 +
    rng() * (maxYearsAgo * 365 * 86_400_000 - minDaysAgo * 86_400_000);
  return new Date(asOfMs - msAgo);
}

@Injectable()
export class MemberFixtureService {
  private readonly logger = new Logger(MemberFixtureService.name);

  constructor(private readonly loanLifecycle: LoanLifecycleService) {}

  /**
   * Maps a member index to its pinned loan cohort, walking contiguous index
   * bands that begin right after the churned band. Returns null for the
   * ordinary majority of the book, whose loans are drawn from the delinquency
   * distribution instead.
   *
   * Band sizes come straight from the cohort constants — a second hand-kept
   * list of sizes here would be free to drift away from them.
   */
  private pickLoanCohort(index: number, startAt: number): LoanCohort | null {
    const bands: readonly { cohort: LoanCohort; size: number }[] = [
      { cohort: 'workout', size: MemberFixtureService.WORKOUT_LOAN_COHORT },
      {
        cohort: 'chargedOff',
        size: MemberFixtureService.CHARGED_OFF_LOAN_COHORT,
      },
      {
        cohort: 'nonaccrual',
        size: MemberFixtureService.NONACCRUAL_LOAN_COHORT,
      },
      { cohort: 'paidOff', size: MemberFixtureService.PAID_OFF_LOAN_COHORT },
    ];
    let cursor = startAt;
    for (const band of bands) {
      if (index >= cursor && index < cursor + band.size) return band.cohort;
      cursor += band.size;
    }
    return null;
  }

  /**
   * How many of the first members are pinned to a specific lifecycle stage.
   *
   * Purely stochastic generation cannot reach two of the five stages the
   * classifier can emit, so a demo book rendered them as permanently empty
   * columns:
   *
   *   ONBOARDING needs `accounts.length === 1 && SHARE && tenure <= 30d`.
   *   Tenure is drawn across 15 years, so the <=30d slice is ~0.5%, and it
   *   has to coincide with the ~5% share-only draw. Measured on a 250-member
   *   book: 3 members under 30 days, 13 share-only, zero overlap.
   *
   *   CHURNED needs `totalBalance === 0`. Every balance is drawn from a
   *   strictly positive range, so it was unreachable by construction — 0 of
   *   250.
   *
   * Pinning a small cohort is honest rather than cosmetic: these rows are
   * `source: 'fixture'` like every other, and a closed-out member genuinely
   * holds a 0 balance. That is not the phantom-zero D1 forbids — D1 bans
   * fabricating 0 for an *unknown* value, exactly as `delinquencyDays`
   * documents ("0 IS a valid 'current' value"). A redeemed share account
   * really is zero.
   *
   * Cohorts are skipped for books smaller than MIN_BOOK_FOR_COHORTS so a
   * 5-member test fixture isn't majority-pinned.
   */
  static readonly ONBOARDING_COHORT = 3;
  static readonly CHURNED_COHORT = 2;
  /**
   * Loan-lifecycle cohorts. WORKOUT (a restructuring) and CHARGED_OFF (a
   * write-off) are back-office DECISIONS, not draws from a delinquency
   * distribution, so no amount of sampling reaches them — exactly the reason
   * ONBOARDING and CHURNED needed pinning. Without these two the demo book
   * shows two permanently empty loan-stage columns.
   */
  static readonly WORKOUT_LOAN_COHORT = 4;
  static readonly CHARGED_OFF_LOAN_COHORT = 3;
  /**
   * NONACCRUAL and PAID_OFF need pinning for two different reasons, both
   * measured on a 250-member book:
   *
   *   * NONACCRUAL (>=90 DPD) sits in a 1%-probability delinquency band, so on
   *     ~155 loan accounts it appears 0-2 times — present or absent depending
   *     on the seed. "Usually there" is not good enough for a demo column.
   *   * PAID_OFF (zero balance) was structurally UNREACHABLE for loans: the
   *     only zero-balance path was the churned cohort, and churned members
   *     are explicitly given no loans at all. A socio who paid off their auto
   *     loan is an ordinary, active member — that is the whole point of
   *     showing a lifecycle — so it gets its own cohort rather than being
   *     folded into churn.
   */
  static readonly NONACCRUAL_LOAN_COHORT = 3;
  static readonly PAID_OFF_LOAN_COHORT = 4;
  static readonly MIN_BOOK_FOR_COHORTS = 25;

  /**
   * Generate `count` deterministic members for `institutionId`. Same
   * (institutionId, count) always produces the same book — the fixture is
   * reproducible, not merely plausible-looking.
   */
  generateMembers(institutionId: string, count = 50): MemberSeed[] {
    // Truncated to the UTC day boundary, not a raw Date.now(): a fixture
    // documented as "deterministic, not merely plausible-looking" cannot
    // anchor its date math to millisecond-resolution wall-clock time — two
    // calls a millisecond apart produced byte-different output even with
    // asOfMs frozen once per call (each call still sampled a different
    // instant). Day-granularity keeps repeated same-day calls byte-
    // identical while still advancing daily so demo data doesn't go stale.
    const asOfMs = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const useCohorts = count >= MemberFixtureService.MIN_BOOK_FOR_COHORTS;
    const onboardingUntil = useCohorts
      ? MemberFixtureService.ONBOARDING_COHORT
      : 0;
    const churnedUntil =
      onboardingUntil + (useCohorts ? MemberFixtureService.CHURNED_COHORT : 0);

    const members: MemberSeed[] = [];
    for (let i = 0; i < count; i++) {
      const isOnboarding = i < onboardingUntil;
      const isChurned = i >= onboardingUntil && i < churnedUntil;

      const rng = mulberry32(hashStringToSeed(`${institutionId}:member:${i}`));
      const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
      const last1 = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      const last2 = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
      // Onboarding members joined inside the classifier's 30-day window; the
      // rest are drawn across the full 15-year tenure range.
      const memberSince = isOnboarding
        ? randomPastDate(rng, 30 / 365, 1, asOfMs)
        : randomPastDate(rng, 15, 1, asOfMs);

      // Which pinned loan-lifecycle cohort (if any) this member belongs to.
      // Assigned once per member, from contiguous index bands after the
      // churned band, so the whole book stays deterministic.
      const loanCohort = useCohorts
        ? this.pickLoanCohort(i, churnedUntil)
        : null;

      const accounts: MemberAccountSeed[] = [];
      for (const template of PRODUCT_TEMPLATES) {
        // An onboarding member holds only the mandatory share account — that
        // IS the classifier's onboarding signal ("only the initial share
        // deposit is on file so far"), not an arbitrary trim.
        if (isOnboarding && template.category !== MemberAccountCategory.SHARE) {
          continue;
        }
        // A member with an outstanding loan has not churned — they'd be in
        // WORKOUT or DELINQUENT. Churned members carry closed share/deposit
        // records only, so the book never shows the contradiction of a
        // "churned" socio who still owes the cooperativa money.
        if (isChurned && template.isLoan) continue;
        if (rng() > template.incidence) continue;

        // A churned member has redeemed/closed everything: the record is
        // retained, the money is gone. 0 here is the true balance, not a
        // stand-in for an unknown one.
        const drawnBalance = isChurned
          ? 0
          : Number(randomInRange(rng, template.balanceRangeUSD).toFixed(2));
        // The paid-off cohort overrides this for LOAN accounts only; deposits
        // and shares keep their drawn balance so the member still looks active.
        let balance = drawnBalance;
        const interestRate = template.rateRange
          ? Number(randomInRange(rng, template.rateRange).toFixed(6))
          : null;
        const openedDate = randomPastDate(
          rng,
          Math.max(1, (asOfMs - memberSince.getTime()) / (365 * 86_400_000)),
          1,
          asOfMs,
        );

        let delinquencyDays: number | null = null;
        let cossecClassification: string | null = null;
        let maturityDate: Date | null = null;
        let originalPrincipal: number | null = null;
        let loanStage: LoanLifecycleStage | null = null;
        let restructured = false;
        let chargedOff = false;

        if (template.isLoan) {
          delinquencyDays = pickDelinquencyDays(rng);
          maturityDate = new Date(
            openedDate.getTime() + template.termYears * 365 * 86_400_000,
          );

          // Original principal sits ABOVE the current balance so amortization
          // progress is a real number rather than always 0. Drawn as a
          // multiple so a 20-year mortgage can show more paydown than a
          // 2-year share-secured loan.
          // Anchored on the DRAWN balance, not the possibly-zeroed one, so a
          // paid-off loan still reports the principal it started with (and
          // therefore shows 100% repaid rather than a meaningless null).
          originalPrincipal = Number(
            (drawnBalance * (1 + rng() * 0.9 + 0.1)).toFixed(2),
          );

          // Deterministic pinned lifecycle cohorts — see the cohort constants
          // for why each one cannot be reached by sampling alone.
          switch (loanCohort) {
            case 'workout':
              restructured = true;
              break;
            case 'chargedOff':
              chargedOff = true;
              break;
            case 'nonaccrual':
              delinquencyDays = 90 + Math.floor(rng() * 180);
              break;
            case 'paidOff':
              // A repaid loan. 0 here is the TRUE outstanding principal, not a
              // phantom zero standing in for unknown data (D1) — the same
              // distinction the churned cohort documents for deposits.
              balance = 0;
              delinquencyDays = 0;
              break;
            default:
              break;
          }

          const signal: LoanSignal = {
            id: `${institutionId}:${i}:${template.productCode}`,
            productCode: template.productCode,
            balance,
            originalPrincipal,
            delinquencyDays,
            openedDate,
            maturityDate,
            restructured,
            chargedOff,
          };
          const classification = this.loanLifecycle.classifyLoan(
            signal,
            new Date(asOfMs),
          );
          loanStage = classification.stage;
          cossecClassification = classification.cossecClassification;
        } else if (template.productType === 'certificado de depósito') {
          // CDs carry a maturity even though they're not loans — the
          // upcoming-maturity next-best-action depends on this.
          const termMonths = [6, 12, 18, 24][Math.floor(rng() * 4)];
          maturityDate = new Date(
            openedDate.getTime() + termMonths * 30 * 86_400_000,
          );
        }

        accounts.push({
          productType: template.productType,
          productCode: template.productCode,
          category: template.category,
          balance,
          originalPrincipal,
          interestRate,
          delinquencyDays,
          maturityDate,
          openedDate,
          cossecClassification,
          loanStage,
          restructured,
          chargedOff,
        });
      }

      members.push({
        memberNumber: `M-${(10000 + i).toString()}`,
        fullName: `${first} ${last1} ${last2}`,
        memberSince,
        accounts,
      });
    }

    this.logger.log(
      `Generated ${members.length} fixture members for institution ${institutionId}`,
    );
    return members;
  }
}
