import { Injectable, Logger } from '@nestjs/common';
import type { LoanRecord } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { DataGap, dataGap } from '../reports/data-gap';

/**
 * Geographic + single-borrower concentration (Wave 2, W2.2 — the differentiator).
 *
 * PR risk IS geographic: regional asset clusters, hurricane/migration/tourism
 * stress are municipio-shaped (the pr_* scenarios already encode this). The
 * existing `concentration.service.ts` computes HHI by product/sector but its
 * `geography` limit reads DATA_UNAVAILABLE because there was no geographic
 * field to measure. W2.0's loan tape now carries per-loan `municipio` and
 * `borrowerId`, so this service lights up the geography + single-borrower
 * branches — from the loan-level book, not aggregates.
 *
 * D1 contract (the roadmap's flagged hazard):
 *   - A silent "compliant" from an unmeasurable geography limit is forbidden.
 *     When NO loan carries a municipio, the municipio HHI is null + a gap —
 *     never 0 (which reads as "perfectly diversified").
 *   - Shares/HHI are computed over the COVERED balance only, with coverage
 *     disclosed. A null municipio/borrower is NEVER bucketed (an imputed
 *     "Unknown" municipio would fabricate a concentration reading).
 *   - Single-borrower aggregation groups by `borrowerId`; a null borrower is
 *     excluded (not treated as its own obligor, which would understate the
 *     largest-borrower share).
 */

/** DOJ/FFIEC HHI interpretation bands (0–10000). DISCLOSED config. */
const HHI_MODERATE = 1500;
const HHI_HIGH = 2500;
/** Exposure lists are capped; the cap is disclosed so "top N" is never read as "all". */
export const CONCENTRATION_TOP_N = 15;

export interface MunicipioExposure {
  municipio: string;
  balance: number;
  /** Share of the COVERED (municipio-carrying) balance, percent. */
  sharePct: number;
  loanCount: number;
}

export interface BorrowerExposure {
  borrowerId: string;
  balance: number;
  /** Share of the COVERED (borrower-carrying) balance, percent. */
  sharePct: number;
  loanCount: number;
}

export interface GeographicConcentrationResult {
  status: 'ok' | 'data_unavailable';
  asOfDate: string;
  totalBalance: number;
  municipio: {
    coveragePct: number;
    /** Null when no loan carries a municipio — never 0 (D1). */
    hhi: number | null;
    hhiInterpretation:
      | 'unconcentrated'
      | 'moderately_concentrated'
      | 'highly_concentrated'
      | null;
    largestSharePct: number | null;
    distinctMunicipios: number;
    /** Top exposures by balance (capped at CONCENTRATION_TOP_N; disclosed if truncated). */
    exposures: MunicipioExposure[];
    truncated: boolean;
  };
  singleBorrower: {
    coveragePct: number;
    largestSharePct: number | null;
    distinctBorrowers: number;
    exposures: BorrowerExposure[];
    truncated: boolean;
  };
  gaps: DataGap[];
}

@Injectable()
export class GeographicConcentrationService {
  private readonly logger = new Logger(GeographicConcentrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyze(
    institutionId: string,
    asOfDate: Date,
  ): Promise<GeographicConcentrationResult> {
    const records = await this.prisma.loanRecord.findMany({
      where: { institutionId, asOfDate },
    });
    const iso = asOfDate.toISOString().slice(0, 10);

    if (records.length === 0) {
      return {
        status: 'data_unavailable',
        asOfDate: iso,
        totalBalance: 0,
        municipio: this.emptyMunicipio(),
        singleBorrower: this.emptyBorrower(),
        gaps: [
          dataGap('concentration.geographic', 'LOAN_TAPE_FIELD_MISSING', {
            severity: 'WARNING',
            action: `No hay cinta de préstamos para ${iso} — la concentración geográfica y por deudor no puede medirse. Cargue una (POST /loan-tape). / No loan tape for ${iso} — geographic and single-borrower concentration cannot be measured. Upload one (POST /loan-tape).`,
            context: { institutionId, asOfDate: iso },
          }),
        ],
      };
    }

    const totalBalance = records.reduce(
      (s: number, r: LoanRecord) => s + Number(r.balance),
      0,
    );
    const gaps: DataGap[] = [];

    const municipio = this.buildMunicipio(records, totalBalance, gaps);
    const singleBorrower = this.buildBorrower(records, totalBalance, gaps);

    return {
      status: 'ok',
      asOfDate: iso,
      totalBalance: this.round2(totalBalance),
      municipio,
      singleBorrower,
      gaps,
    };
  }

  // ─── municipio ───

  private buildMunicipio(
    records: LoanRecord[],
    totalBalance: number,
    gaps: DataGap[],
  ): GeographicConcentrationResult['municipio'] {
    const covered = records.filter((r) => r.municipio !== null);
    const coveredBal = covered.reduce((s, r) => s + Number(r.balance), 0);
    const coveragePct =
      totalBalance > 0 ? (coveredBal / totalBalance) * 100 : 0;

    // D1: the flagged hazard. No geography → null HHI + a gap, never a
    // fabricated "diversified" reading.
    if (covered.length === 0 || coveredBal <= 0) {
      gaps.push(
        dataGap('concentration.municipio', 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action:
            'Ningún préstamo de la cinta tiene municipio — la concentración geográfica NO puede evaluarse (no se asume diversificación). Incluya el municipio por préstamo en la cinta. / No loan on the tape carries a municipio — geographic concentration CANNOT be assessed (diversification is not assumed). Include per-loan municipio on the tape.',
          context: { coveragePct: 0 },
        }),
      );
      return this.emptyMunicipio();
    }

    const byMunicipio = new Map<string, { balance: number; count: number }>();
    for (const r of covered) {
      const key = r.municipio as string;
      const cur = byMunicipio.get(key) ?? { balance: 0, count: 0 };
      cur.balance += Number(r.balance);
      cur.count += 1;
      byMunicipio.set(key, cur);
    }

    const exposures: MunicipioExposure[] = [...byMunicipio.entries()]
      .map(([municipio, v]) => ({
        municipio,
        balance: this.round2(v.balance),
        sharePct: this.round2((v.balance / coveredBal) * 100),
        loanCount: v.count,
      }))
      .sort((a, b) => b.balance - a.balance);

    // HHI over covered shares (shares sum to 100 of the covered book).
    const hhi = this.round2(
      exposures.reduce((s, e) => s + e.sharePct * e.sharePct, 0),
    );

    if (coveragePct < 100) {
      gaps.push(
        dataGap('concentration.municipio.coverage', 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action: `El municipio cubre el ${this.round2(coveragePct)}% del balance — el HHI y las participaciones se calculan solo sobre esa porción (nunca se imputa). / Municipio covers ${this.round2(coveragePct)}% of balance — HHI and shares are computed over that portion only (never imputed).`,
          context: { coveragePct: this.round2(coveragePct) },
        }),
      );
    }

    return {
      coveragePct: this.round2(coveragePct),
      hhi,
      hhiInterpretation: this.interpretHhi(hhi),
      largestSharePct: exposures[0]?.sharePct ?? null,
      distinctMunicipios: byMunicipio.size,
      exposures: exposures.slice(0, CONCENTRATION_TOP_N),
      truncated: exposures.length > CONCENTRATION_TOP_N,
    };
  }

  // ─── single borrower ───

  private buildBorrower(
    records: LoanRecord[],
    totalBalance: number,
    gaps: DataGap[],
  ): GeographicConcentrationResult['singleBorrower'] {
    const covered = records.filter((r) => r.borrowerId !== null);
    const coveredBal = covered.reduce((s, r) => s + Number(r.balance), 0);
    const coveragePct =
      totalBalance > 0 ? (coveredBal / totalBalance) * 100 : 0;

    if (covered.length === 0 || coveredBal <= 0) {
      gaps.push(
        dataGap('concentration.singleBorrower', 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action:
            'Ningún préstamo de la cinta tiene clave de deudor — la concentración por deudor único NO puede evaluarse. Incluya el id de socio/deudor por préstamo. / No loan on the tape carries a borrower key — single-borrower concentration CANNOT be assessed. Include the per-loan member/borrower id.',
          context: { coveragePct: 0 },
        }),
      );
      return this.emptyBorrower();
    }

    const byBorrower = new Map<string, { balance: number; count: number }>();
    for (const r of covered) {
      const key = r.borrowerId as string;
      const cur = byBorrower.get(key) ?? { balance: 0, count: 0 };
      cur.balance += Number(r.balance);
      cur.count += 1;
      byBorrower.set(key, cur);
    }

    const exposures: BorrowerExposure[] = [...byBorrower.entries()]
      .map(([borrowerId, v]) => ({
        borrowerId,
        balance: this.round2(v.balance),
        sharePct: this.round2((v.balance / coveredBal) * 100),
        loanCount: v.count,
      }))
      .sort((a, b) => b.balance - a.balance);

    if (coveragePct < 100) {
      gaps.push(
        dataGap(
          'concentration.singleBorrower.coverage',
          'LOAN_TAPE_FIELD_MISSING',
          {
            severity: 'WARNING',
            action: `La clave de deudor cubre el ${this.round2(coveragePct)}% del balance — la participación por deudor se calcula solo sobre esa porción. / Borrower key covers ${this.round2(coveragePct)}% of balance — single-borrower shares are computed over that portion only.`,
            context: { coveragePct: this.round2(coveragePct) },
          },
        ),
      );
    }

    return {
      coveragePct: this.round2(coveragePct),
      largestSharePct: exposures[0]?.sharePct ?? null,
      distinctBorrowers: byBorrower.size,
      exposures: exposures.slice(0, CONCENTRATION_TOP_N),
      truncated: exposures.length > CONCENTRATION_TOP_N,
    };
  }

  // ─── helpers ───

  private interpretHhi(
    hhi: number,
  ): 'unconcentrated' | 'moderately_concentrated' | 'highly_concentrated' {
    if (hhi < HHI_MODERATE) return 'unconcentrated';
    if (hhi < HHI_HIGH) return 'moderately_concentrated';
    return 'highly_concentrated';
  }

  private emptyMunicipio(): GeographicConcentrationResult['municipio'] {
    return {
      coveragePct: 0,
      hhi: null,
      hhiInterpretation: null,
      largestSharePct: null,
      distinctMunicipios: 0,
      exposures: [],
      truncated: false,
    };
  }

  private emptyBorrower(): GeographicConcentrationResult['singleBorrower'] {
    return {
      coveragePct: 0,
      largestSharePct: null,
      distinctBorrowers: 0,
      exposures: [],
      truncated: false,
    };
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
