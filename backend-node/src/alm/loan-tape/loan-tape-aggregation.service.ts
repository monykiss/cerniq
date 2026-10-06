import { Injectable, Logger } from '@nestjs/common';
import type { LoanRecord, LoanSegment } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { DataGap, dataGap } from '../reports/data-gap';

/**
 * Loan-tape aggregation (Wave 2, W2.0 Slice 1) — the "aggregation view" the
 * roadmap requires so loan-level data rolls UP into LoanSegment-shaped reads
 * and Layer 1 keeps working unchanged.
 *
 * READ-ONLY by design in Slice 1. Materializing rollups INTO the LoanSegment
 * table is deliberately deferred: LoanSegment requires `historicalLossRate`,
 * which a loan tape does not carry — writing 0 would be a phantom loss rate
 * feeding CECL (the exact silent-zero class D1 exists to kill). The sourcing
 * decision (keep segment-level loss history authoritative vs derive from
 * delinquency migration) is a product call for a later slice.
 *
 * D1 contract: every weighted average is computed ONLY over the records that
 * carry the field, with the coverage disclosed as a gap when partial — a
 * missing rate never contributes a phantom 0 to a weighted rate.
 */

/** Balance-drift tolerance for tape↔segment reconciliation. DISCLOSED config. */
export const RECONCILE_TOLERANCE_PCT = 1.0;

export interface LoanTapeSegmentRollup {
  segmentName: string;
  recordCount: number;
  balance: number;
  /** Balance-weighted over covered records only; null when none carry a rate. */
  weightedAvgRate: number | null;
  rateCoveragePct: number;
  /** Years to maturity from asOfDate, balance-weighted over covered records. */
  weightedAvgMaturity: number | null;
  maturityCoveragePct: number;
  delinquency: {
    coveragePct: number;
    balance30to59: number;
    balance60to89: number;
    balance90plus: number;
  };
  municipioCoveragePct: number;
}

export interface LoanTapeRollupResult {
  status: 'ok' | 'data_unavailable';
  asOfDate: string;
  segments: LoanTapeSegmentRollup[];
  totals: { balance: number; recordCount: number };
  gaps: DataGap[];
}

export interface SegmentReconciliationRow {
  segmentName: string;
  tapeBalance: number | null;
  segmentBalance: number | null;
  deltaPct: number | null;
  within: boolean;
}

export interface LoanTapeReconciliationResult {
  status: 'ok' | 'data_unavailable';
  asOfDate: string;
  rows: SegmentReconciliationRow[];
  gaps: DataGap[];
}

@Injectable()
export class LoanTapeAggregationService {
  private readonly logger = new Logger(LoanTapeAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** LoanSegment-shaped rollup of one tape date. */
  async rollUpToSegments(
    institutionId: string,
    asOfDate: Date,
  ): Promise<LoanTapeRollupResult> {
    const records = await this.prisma.loanRecord.findMany({
      where: { institutionId, asOfDate },
    });
    const iso = asOfDate.toISOString().slice(0, 10);

    if (records.length === 0) {
      return {
        status: 'data_unavailable',
        asOfDate: iso,
        segments: [],
        totals: { balance: 0, recordCount: 0 },
        gaps: [
          dataGap('loanTape.records', 'LOAN_TAPE_FIELD_MISSING', {
            severity: 'WARNING',
            action: `No hay cinta de préstamos persistida para ${iso} — cargue una (POST /loan-tape). / No loan tape persisted for ${iso} — upload one (POST /loan-tape).`,
            context: { institutionId, asOfDate: iso },
          }),
        ],
      };
    }

    const bySegment = new Map<string, LoanRecord[]>();
    for (const r of records) {
      const list = bySegment.get(r.segmentName) ?? [];
      list.push(r);
      bySegment.set(r.segmentName, list);
    }

    const gaps: DataGap[] = [];
    const segments: LoanTapeSegmentRollup[] = [];
    let totalBalance = 0;

    for (const [segmentName, segRecords] of bySegment) {
      const rollup = this.rollUpSegment(segmentName, segRecords, asOfDate);
      totalBalance += Number(rollup.balance);
      segments.push(rollup);
    }
    segments.sort((a, b) => b.balance - a.balance);

    // Portfolio-level coverage disclosures (one gap per partially-covered
    // dimension, not one per segment — signal over noise).
    this.pushCoverageGap(gaps, 'rate', segments, (s) => s.rateCoveragePct);
    this.pushCoverageGap(
      gaps,
      'maturityDate',
      segments,
      (s) => s.maturityCoveragePct,
    );
    this.pushCoverageGap(
      gaps,
      'delinquencyDays',
      segments,
      (s) => s.delinquency.coveragePct,
    );
    this.pushCoverageGap(
      gaps,
      'municipio',
      segments,
      (s) => s.municipioCoveragePct,
    );

    return {
      status: 'ok',
      asOfDate: iso,
      segments,
      totals: {
        balance: this.round2(totalBalance),
        recordCount: records.length,
      },
      gaps,
    };
  }

  /**
   * Tape totals vs the existing LoanSegment book (the Layer-1 source of
   * truth). Divergence beyond the disclosed tolerance, or a segment present
   * on only one side, raises a WARNING gap — the tape VALIDATES the
   * aggregate book before it ever replaces it.
   */
  async reconcileWithSegments(
    institutionId: string,
    asOfDate: Date,
  ): Promise<LoanTapeReconciliationResult> {
    const rollup = await this.rollUpToSegments(institutionId, asOfDate);
    if (rollup.status === 'data_unavailable') {
      return {
        status: 'data_unavailable',
        asOfDate: rollup.asOfDate,
        rows: [],
        gaps: rollup.gaps,
      };
    }

    const segmentRows = await this.prisma.loanSegment.findMany({
      where: { institutionId },
    });
    const gaps: DataGap[] = [];

    if (segmentRows.length === 0) {
      gaps.push(
        dataGap('loanTape.reconciliation', 'NO_LOAN_SEGMENTS', {
          severity: 'WARNING',
          action:
            'No hay segmentos agregados para conciliar — la cinta es la única fuente. / No aggregate segments to reconcile against — the tape is the only source.',
          context: { institutionId },
        }),
      );
    }

    const tapeByName = new Map<string, number>(
      rollup.segments.map((s): [string, number] => [s.segmentName, s.balance]),
    );
    const bookByName = new Map<string, number>(
      segmentRows.map((s: LoanSegment): [string, number] => [
        s.segmentName,
        Number(s.balance),
      ]),
    );
    const names = [
      ...new Set([...tapeByName.keys(), ...bookByName.keys()]),
    ].sort();

    const rows: SegmentReconciliationRow[] = names.map((name) => {
      const tapeBalance = tapeByName.get(name) ?? null;
      const segmentBalance = bookByName.get(name) ?? null;
      let deltaPct: number | null = null;
      let within = false;
      if (tapeBalance !== null && segmentBalance !== null) {
        deltaPct =
          segmentBalance > 0
            ? this.round2(
                ((tapeBalance - segmentBalance) / segmentBalance) * 100,
              )
            : null;
        within =
          deltaPct !== null && Math.abs(deltaPct) <= RECONCILE_TOLERANCE_PCT;
        if (!within) {
          gaps.push(
            dataGap(`loanTape.reconciliation.${name}`, 'CALCULATION_FAILED', {
              severity: 'WARNING',
              action: `"${name}": la cinta suma ${tapeBalance} pero el segmento agregado registra ${segmentBalance} (Δ ${deltaPct ?? 'n/a'}%, tolerancia ${RECONCILE_TOLERANCE_PCT}%) — investigar antes de confiar en cualquiera de los dos. / "${name}": tape sums to ${tapeBalance} but the aggregate segment records ${segmentBalance} (Δ ${deltaPct ?? 'n/a'}%, tolerance ${RECONCILE_TOLERANCE_PCT}%) — investigate before trusting either.`,
              context: {
                segmentName: name,
                tapeBalance,
                segmentBalance,
                deltaPct,
              },
            }),
          );
        }
      } else {
        gaps.push(
          dataGap(`loanTape.reconciliation.${name}`, 'CALCULATION_FAILED', {
            severity: 'WARNING',
            action: `"${name}" existe solo en ${tapeBalance !== null ? 'la cinta' : 'el libro agregado'} — conciliar la segmentación. / "${name}" exists only in ${tapeBalance !== null ? 'the tape' : 'the aggregate book'} — reconcile the segmentation.`,
            context: { segmentName: name, tapeBalance, segmentBalance },
          }),
        );
      }
      return {
        segmentName: name,
        tapeBalance,
        segmentBalance,
        deltaPct,
        within,
      };
    });

    return { status: 'ok', asOfDate: rollup.asOfDate, rows, gaps };
  }

  // ─── internals ───

  private rollUpSegment(
    segmentName: string,
    records: LoanRecord[],
    asOfDate: Date,
  ): LoanTapeSegmentRollup {
    const balance = records.reduce((s, r) => s + Number(r.balance), 0);

    // Weighted rate over covered records only (no phantom zeros).
    const withRate = records.filter((r) => r.rate !== null);
    const rateBal = withRate.reduce((s, r) => s + Number(r.balance), 0);
    const weightedAvgRate =
      rateBal > 0
        ? this.round6(
            withRate.reduce(
              (s, r) => s + Number(r.rate) * Number(r.balance),
              0,
            ) / rateBal,
          )
        : null;

    const withMaturity = records.filter((r) => r.maturityDate !== null);
    const matBal = withMaturity.reduce((s, r) => s + Number(r.balance), 0);
    const weightedAvgMaturity =
      matBal > 0
        ? this.round2(
            withMaturity.reduce((s, r) => {
              const years = Math.max(
                0,
                ((r.maturityDate as Date).getTime() - asOfDate.getTime()) /
                  (365.25 * 86_400_000),
              );
              return s + years * Number(r.balance);
            }, 0) / matBal,
          )
        : null;

    const withDpd = records.filter((r) => r.delinquencyDays !== null);
    const dpdBal = withDpd.reduce((s, r) => s + Number(r.balance), 0);
    const band = (lo: number, hi: number | null) =>
      this.round2(
        withDpd
          .filter(
            (r) =>
              (r.delinquencyDays as number) >= lo &&
              (hi === null || (r.delinquencyDays as number) < hi),
          )
          .reduce((s, r) => s + Number(r.balance), 0),
      );

    const withMunicipio = records.filter((r) => r.municipio !== null);
    const munBal = withMunicipio.reduce((s, r) => s + Number(r.balance), 0);

    const pct = (part: number) =>
      balance > 0 ? this.round2((part / balance) * 100) : 0;

    return {
      segmentName,
      recordCount: records.length,
      balance: this.round2(balance),
      weightedAvgRate,
      rateCoveragePct: pct(rateBal),
      weightedAvgMaturity,
      maturityCoveragePct: pct(matBal),
      delinquency: {
        coveragePct: pct(dpdBal),
        balance30to59: band(30, 60),
        balance60to89: band(60, 90),
        balance90plus: band(90, null),
      },
      municipioCoveragePct: pct(munBal),
    };
  }

  private pushCoverageGap(
    gaps: DataGap[],
    field: string,
    segments: LoanTapeSegmentRollup[],
    coverageOf: (s: LoanTapeSegmentRollup) => number,
  ): void {
    const totalBal = segments.reduce((s, x) => s + Number(x.balance), 0);
    if (totalBal <= 0) return;
    const covered = segments.reduce(
      (s, x) => s + (x.balance * coverageOf(x)) / 100,
      0,
    );
    const coveragePct = this.round2((covered / totalBal) * 100);
    if (coveragePct < 100) {
      gaps.push(
        dataGap(`loanTape.coverage.${field}`, 'LOAN_TAPE_FIELD_MISSING', {
          severity: 'WARNING',
          action: `Los agregados de "${field}" cubren el ${coveragePct}% del balance — el resto no aporta al promedio ponderado (nunca se imputa). / "${field}" aggregates cover ${coveragePct}% of balance — the remainder does not contribute to the weighted average (never imputed).`,
          context: { field, coveragePct },
        }),
      );
    }
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
  private round6(v: number): number {
    return Math.round(v * 1e6) / 1e6;
  }
}
