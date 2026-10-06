import { Injectable, Logger } from '@nestjs/common';
import type { LoanRecord } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { DataGap, dataGap } from '../reports/data-gap';

/**
 * MODELED FHLBNY collateral analysis + borrowing capacity (Wave 2, W2.1 —
 * the wedge).
 *
 * FHLBNY membership requires monthly loan-level collateral files (COL-121),
 * haircut/eligibility tracking, and advances — wholesale funding PR coops
 * never modeled when deposit-only (Bible §8; 57+ coops in the membership
 * pipeline, COSSEC tailwind). The roadmap's sequencing call: the EXACT
 * COL-121 field layout is UNVERIFIED (Bible §9.13), so ship the MODELED
 * collateral file + borrowing-capacity what-ifs first — high value for the
 * IRR/advances decision — and wire the byte-exact layout once obtained
 * from FHLBNY Member Relations.
 *
 * EVERYTHING here is MODELED and says so (the W1.2 ratchet pattern):
 *   - collateral classes are keyword-mapped from the tape's free-form
 *     `collateralType`/`segmentName`; unclassifiable loans are INELIGIBLE
 *     with a disclosed reason — never guessed into a class;
 *   - haircuts + the delinquency ceiling are DISCLOSED PROVISIONAL config
 *     pending the official FHLBNY collateral guide / Capital Plan — a
 *     WARNING gap rides on EVERY result so the basis is never mistaken
 *     for the verified schedule;
 *   - capacity what-ifs are relative ladders over the modeled lending
 *     value, not commitments.
 *
 * D1: an unclassifiable or over-delinquent loan reduces ELIGIBLE value —
 * it is never silently included (which would overstate borrowing capacity,
 * the worst direction for a funding decision).
 */

export type FhlbnyCollateralClass =
  | 'RESIDENTIAL_1_4'
  | 'HELOC'
  | 'MULTIFAMILY'
  | 'COMMERCIAL_RE';

/**
 * PROVISIONAL modeled haircuts (fraction of UPB withheld; lending value =
 * UPB × (1 − haircut)). Conservative placeholders pending the official
 * FHLBNY schedule — DISCLOSED on every result.
 */
export const MODELED_HAIRCUTS: Record<FhlbnyCollateralClass, number> = {
  RESIDENTIAL_1_4: 0.25,
  HELOC: 0.4,
  MULTIFAMILY: 0.35,
  COMMERCIAL_RE: 0.45,
};

/** Loans at/above this DPD are modeled INELIGIBLE. PROVISIONAL, DISCLOSED. */
export const MODELED_MAX_DPD = 60;

/** Relative advance ladder for capacity what-ifs (fractions of lending value). */
export const CAPACITY_WHAT_IF_LADDER = [0.25, 0.5, 0.75, 1.0];

/** Keyword → class mapping over collateralType (primary) + segmentName (context). */
const CLASS_KEYWORDS: Array<{ class: FhlbnyCollateralClass; re: RegExp }> = [
  { class: 'HELOC', re: /heloc|linea.*hipotec/i },
  { class: 'MULTIFAMILY', re: /multifamil/i },
  { class: 'COMMERCIAL_RE', re: /comercial|commercial|cre\b/i },
  { class: 'RESIDENTIAL_1_4', re: /residencial|residential|1-4|hipotec/i },
];

export type IneligibleReason =
  | 'not_an_eligible_class'
  | 'unclassifiable_collateral'
  | `delinquent_${number}dpd_or_more`
  | 'delinquency_unknown';

export interface FhlbnyClassBreakdown {
  collateralClass: FhlbnyCollateralClass;
  loanCount: number;
  balance: number;
  haircutPct: number;
  lendingValue: number;
}

export interface FhlbnyIneligibleBreakdown {
  reason: string;
  loanCount: number;
  balance: number;
}

export interface FhlbnyCapacityWhatIf {
  /** Requested advance as a fraction of modeled lending value. */
  ladderPct: number;
  advance: number;
  excessCollateral: number;
  utilizationPct: number;
}

export interface FhlbnyCollateralResult {
  status: 'ok' | 'data_unavailable';
  modeled: true;
  asOfDate: string;
  totalBalance: number;
  eligible: {
    loanCount: number;
    balance: number;
    lendingValue: number;
    byClass: FhlbnyClassBreakdown[];
  };
  ineligible: {
    loanCount: number;
    balance: number;
    byReason: FhlbnyIneligibleBreakdown[];
  };
  capacity: {
    totalLendingValue: number;
    whatIfs: FhlbnyCapacityWhatIf[];
  };
  gaps: DataGap[];
}

export interface FhlbnyModeledFile {
  modeled: true;
  filename: string;
  csv: string;
  loanCount: number;
  lendingValue: number;
}

@Injectable()
export class FhlbnyCollateralService {
  private readonly logger = new Logger(FhlbnyCollateralService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyze(
    institutionId: string,
    asOfDate: Date,
  ): Promise<FhlbnyCollateralResult> {
    const records = await this.prisma.loanRecord.findMany({
      where: { institutionId, asOfDate },
    });
    const iso = asOfDate.toISOString().slice(0, 10);

    if (records.length === 0) {
      return {
        status: 'data_unavailable',
        modeled: true,
        asOfDate: iso,
        totalBalance: 0,
        eligible: { loanCount: 0, balance: 0, lendingValue: 0, byClass: [] },
        ineligible: { loanCount: 0, balance: 0, byReason: [] },
        capacity: { totalLendingValue: 0, whatIfs: [] },
        gaps: [
          dataGap('fhlbny.collateral', 'LOAN_TAPE_FIELD_MISSING', {
            severity: 'WARNING',
            action: `No hay cinta de préstamos para ${iso} — el análisis de colateral FHLBNY no puede modelarse. Cargue una (POST /loan-tape). / No loan tape for ${iso} — the FHLBNY collateral analysis cannot be modeled. Upload one (POST /loan-tape).`,
            context: { institutionId, asOfDate: iso },
          }),
        ],
      };
    }

    const gaps: DataGap[] = [this.modeledDisclosureGap()];
    const byClass = new Map<
      FhlbnyCollateralClass,
      { count: number; balance: number }
    >();
    const byReason = new Map<string, { count: number; balance: number }>();
    let totalBalance = 0;

    for (const r of records) {
      const balance = Number(r.balance);
      totalBalance += balance;
      const verdict = this.classify(r);
      if (verdict.eligible) {
        const cur = byClass.get(verdict.collateralClass) ?? {
          count: 0,
          balance: 0,
        };
        cur.count += 1;
        cur.balance += balance;
        byClass.set(verdict.collateralClass, cur);
      } else {
        const cur = byReason.get(verdict.reason) ?? { count: 0, balance: 0 };
        cur.count += 1;
        cur.balance += balance;
        byReason.set(verdict.reason, cur);
      }
    }

    const classBreakdown: FhlbnyClassBreakdown[] = [...byClass.entries()]
      .map(([collateralClass, v]) => ({
        collateralClass,
        loanCount: v.count,
        balance: this.round2(v.balance),
        haircutPct: MODELED_HAIRCUTS[collateralClass] * 100,
        lendingValue: this.round2(
          v.balance * (1 - MODELED_HAIRCUTS[collateralClass]),
        ),
      }))
      .sort((a, b) => b.balance - a.balance);

    const ineligibleBreakdown: FhlbnyIneligibleBreakdown[] = [
      ...byReason.entries(),
    ]
      .map(([reason, v]) => ({
        reason,
        loanCount: v.count,
        balance: this.round2(v.balance),
      }))
      .sort((a, b) => b.balance - a.balance);

    const eligibleBalance = classBreakdown.reduce(
      (s, c) => s + Number(c.balance),
      0,
    );
    const eligibleCount = classBreakdown.reduce((s, c) => s + c.loanCount, 0);
    const lendingValue = this.round2(
      classBreakdown.reduce((s, c) => s + c.lendingValue, 0),
    );
    const ineligibleBalance = ineligibleBreakdown.reduce(
      (s, c) => s + Number(c.balance),
      0,
    );

    if (eligibleCount === 0) {
      gaps.push(
        dataGap('fhlbny.collateral.eligible', 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action:
            'Ningún préstamo de la cinta califica como colateral FHLBNY modelado (clases 1-4 familias / HELOC / multifamiliar / CRE, mora bajo el techo divulgado) — la capacidad de endeudamiento modelada es 0, no un error. / No loan on the tape qualifies as modeled FHLBNY collateral (1-4 family / HELOC / multifamily / CRE classes, delinquency under the disclosed ceiling) — modeled borrowing capacity is 0, not an error.',
          context: { totalBalance: this.round2(totalBalance) },
        }),
      );
    }

    return {
      status: 'ok',
      modeled: true,
      asOfDate: iso,
      totalBalance: this.round2(totalBalance),
      eligible: {
        loanCount: eligibleCount,
        balance: this.round2(eligibleBalance),
        lendingValue,
        byClass: classBreakdown,
      },
      ineligible: {
        loanCount: ineligibleBreakdown.reduce((s, c) => s + c.loanCount, 0),
        balance: this.round2(ineligibleBalance),
        byReason: ineligibleBreakdown,
      },
      capacity: {
        totalLendingValue: lendingValue,
        whatIfs: CAPACITY_WHAT_IF_LADDER.map((pct) => {
          const advance = this.round2(lendingValue * pct);
          return {
            ladderPct: pct * 100,
            advance,
            excessCollateral: this.round2(lendingValue - advance),
            utilizationPct: this.round2(pct * 100),
          };
        }),
      },
      gaps,
    };
  }

  /**
   * The MODELED collateral file — a clearly-labeled stand-in for COL-121
   * listing each eligible loan with its class, haircut, and lending value.
   * The byte-exact COL-121 layout is wired in a later slice once obtained.
   */
  async generateModeledFile(
    institutionId: string,
    asOfDate: Date,
  ): Promise<FhlbnyModeledFile> {
    const records = await this.prisma.loanRecord.findMany({
      where: { institutionId, asOfDate },
      orderBy: { externalLoanId: 'asc' },
    });
    const iso = asOfDate.toISOString().slice(0, 10);

    const rows: string[] = [
      'loan_id,collateral_class,balance,haircut_pct,lending_value,municipio,maturity_date,delinquency_days',
    ];
    let lendingValue = 0;
    let count = 0;

    for (const r of records) {
      const verdict = this.classify(r);
      if (!verdict.eligible) continue;
      const balance = Number(r.balance);
      const haircut = MODELED_HAIRCUTS[verdict.collateralClass];
      const lv = this.round2(balance * (1 - haircut));
      lendingValue += lv;
      count += 1;
      rows.push(
        [
          r.externalLoanId,
          verdict.collateralClass,
          balance,
          haircut * 100,
          lv,
          r.municipio ?? '',
          r.maturityDate ? r.maturityDate.toISOString().slice(0, 10) : '',
          r.delinquencyDays ?? '',
        ].join(','),
      );
    }

    return {
      modeled: true,
      filename: `MODELED-fhlbny-collateral-${iso}.csv`,
      csv: rows.join('\n'),
      loanCount: count,
      lendingValue: this.round2(lendingValue),
    };
  }

  // ─── internals ───

  private classify(
    r: LoanRecord,
  ):
    | { eligible: true; collateralClass: FhlbnyCollateralClass }
    | { eligible: false; reason: string } {
    // Delinquency ceiling first (disclosed). An UNKNOWN delinquency is
    // ineligible — assuming current would overstate capacity (D1).
    if (r.delinquencyDays === null) {
      return { eligible: false, reason: 'delinquency_unknown' };
    }
    if (r.delinquencyDays >= MODELED_MAX_DPD) {
      return {
        eligible: false,
        reason: `delinquent_${MODELED_MAX_DPD}dpd_or_more`,
      };
    }

    const haystack = `${r.collateralType ?? ''} ${r.segmentName}`;
    for (const { class: cls, re } of CLASS_KEYWORDS) {
      if (re.test(haystack)) {
        return { eligible: true, collateralClass: cls };
      }
    }
    // A collateralType we can't map is different from a class FHLBNY
    // doesn't take — both ineligible, separately disclosed.
    return r.collateralType
      ? { eligible: false, reason: 'not_an_eligible_class' }
      : { eligible: false, reason: 'unclassifiable_collateral' };
  }

  private modeledDisclosureGap(): DataGap {
    return dataGap('fhlbny.collateral.modeled', 'STALE_SNAPSHOT', {
      severity: 'WARNING',
      action: `Análisis MODELADO: el formato exacto COL-121 y la tabla oficial de recortes de FHLBNY NO están verificados (Bible §9.13) — los recortes (1-4 fam ${MODELED_HAIRCUTS.RESIDENTIAL_1_4 * 100}%, HELOC ${MODELED_HAIRCUTS.HELOC * 100}%, multifam ${MODELED_HAIRCUTS.MULTIFAMILY * 100}%, CRE ${MODELED_HAIRCUTS.COMMERCIAL_RE * 100}%) y el techo de mora (${MODELED_MAX_DPD} días) son configuración PROVISIONAL divulgada. Obtener la guía COL-012 / Capital Plan de FHLBNY antes de usar en una solicitud. / MODELED analysis: the exact COL-121 layout and official FHLBNY haircut schedule are UNVERIFIED (Bible §9.13) — the haircuts and the ${MODELED_MAX_DPD}-day delinquency ceiling are DISCLOSED PROVISIONAL config. Obtain the FHLBNY COL-012 guide / Capital Plan before using in an application.`,
      context: {
        haircuts: MODELED_HAIRCUTS,
        maxDelinquencyDays: MODELED_MAX_DPD,
      },
    });
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
