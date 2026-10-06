import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// NCUA Risk-Based Capital (RBC2) — Full 8-Component Computation
// Per NCUA Letter 15-CU-02 Final Rule

export interface RBC2Component {
  name: string;
  nameEs: string;
  riskWeight: number;
  exposure: number;
  charge: number;
}

/**
 * RBC2 result. D1 (2026-04-07): when input data is incomplete, every numeric
 * field is `null` and `overallStatus === 'data_unavailable'`. The `gaps[]`
 * manifest enumerates exactly what's missing. This is a regulator-bound
 * filing — phantom $445M fallbacks (the previous behavior) are a legal
 * exposure. Callers MUST check `overallStatus` before submitting to NCUA.
 */
export interface RBC2Result {
  components: RBC2Component[];
  totalRiskWeightedAssets: number | null;
  totalRiskBasedCapitalCharge: number | null;
  netWorth: number | null;
  riskBasedCapitalRatio: number | null;
  isWellCapitalized: boolean;
  isAdequatelyCapitalized: boolean;
  surplus: number | null;
  narrativeEs: string;
  narrativeEn: string;
  overallStatus: 'compliant' | 'undercapitalized' | 'data_unavailable';
  gaps?: DataGap[];
}

// NCUA RBC2 risk weights by asset category
const RBC2_WEIGHTS: Record<string, { weight: number; nameEs: string }> = {
  cash: { weight: 0.0, nameEs: 'Efectivo y equivalentes' },
  us_government: { weight: 0.0, nameEs: 'Gobierno de EE.UU.' },
  agency_securities: { weight: 0.2, nameEs: 'Valores de agencia' },
  residential_mortgage_1st: {
    weight: 0.5,
    nameEs: 'Hipoteca residencial (1ra)',
  },
  residential_mortgage_2nd: {
    weight: 1.0,
    nameEs: 'Hipoteca residencial (2da)',
  },
  commercial_re: { weight: 1.0, nameEs: 'Bienes raíces comerciales' },
  consumer_loans: { weight: 0.75, nameEs: 'Préstamos de consumo' },
  auto_loans: { weight: 0.75, nameEs: 'Préstamos de auto' },
  commercial_loans: { weight: 1.0, nameEs: 'Préstamos comerciales' },
  credit_cards: { weight: 1.0, nameEs: 'Tarjetas de crédito' },
  other_assets: { weight: 1.0, nameEs: 'Otros activos' },
};

@Injectable()
export class NCUARBC2Service {
  private readonly logger = new Logger(NCUARBC2Service.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeRBC2(institutionId: string): Promise<RBC2Result> {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });
    const inst = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });

    // D1 (2026-04-07): refuse to compute RBC2 on an empty balance sheet.
    // The previous behavior fell back to a hardcoded $445M institution size
    // and an 87% liability ratio — a phantom NCUA filing that's legally
    // identical to lying to the regulator. Surface a CRITICAL gap and let
    // the caller render explicit DATA UNAVAILABLE before any submission.
    const assetItems = items.filter((i: any) => i.category === 'asset');
    const liabilityItems = items.filter((i: any) => i.category === 'liability');

    if (assetItems.length === 0) {
      this.logger.warn({
        event: 'rbc2_data_unavailable',
        institutionId,
        reason: 'EMPTY_BALANCE_SHEET',
      });
      return this.dataUnavailableResult([
        dataGap('rbc2.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Upload balance sheet items (assets and liabilities) for this institution before computing RBC2. Filing RBC2 against phantom data is a regulatory exposure.',
          context: { institutionId },
        }),
      ]);
    }

    // Asset and liability totals are now strictly derived from real items —
    // no `|| 445` or `|| totalAssets * 0.87` phantoms. If liability items
    // are missing, that's its own surfaceable issue (we treat liabilities
    // = 0 as a valid edge case for an equity-funded institution; the
    // edit checks downstream will catch a real problem).
    const totalAssets = assetItems.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const totalLiabilities = liabilityItems.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );
    const netWorth = totalAssets - totalLiabilities;

    // Map balance sheet items to RBC2 categories
    const components: RBC2Component[] = [];
    const bySub = new Map<string, number>();
    for (const item of assetItems) {
      const sub = item.subcategory.toLowerCase();
      bySub.set(sub, (bySub.get(sub) ?? 0) + Number(item.balance));
    }

    for (const [sub, balance] of bySub) {
      const rbc2Cat = this.mapToRBC2Category(sub);
      const config = RBC2_WEIGHTS[rbc2Cat] ?? RBC2_WEIGHTS.other_assets;
      components.push({
        name: rbc2Cat.replace(/_/g, ' '),
        nameEs: config.nameEs,
        riskWeight: config.weight,
        exposure: +balance.toFixed(1),
        charge: +(balance * config.weight).toFixed(1),
      });
    }

    // Additional charges (simplified)
    // Interest rate risk charge: based on duration gap.
    //
    // KNOWN LIMITATION (2026-04-07): durationGap is currently hardcoded to
    // a sector-typical 2.1 years pending integration with DurationService.
    // We surface this as a WARNING gap on every RBC2 result so callers and
    // auditors can see that the IRR charge component is a placeholder, not
    // a measured value. Once DurationService is wired in, replace this and
    // drop the WARNING gap from the result. Tracked in SESSION_HANDOFF.md.
    const durationGap = 2.1;
    const irrCharge = totalAssets * Math.abs(durationGap) * 0.002;
    components.push({
      name: 'Interest Rate Risk',
      nameEs: 'Riesgo de Tasa de Interés',
      riskWeight: 0,
      exposure: totalAssets,
      charge: +irrCharge.toFixed(1),
    });

    // Concentration risk charge
    const maxConcentration =
      Math.max(...Array.from(bySub.values())) / totalAssets;
    const concCharge =
      maxConcentration > 0.25
        ? totalAssets * (maxConcentration - 0.25) * 0.08
        : 0;
    components.push({
      name: 'Concentration Risk',
      nameEs: 'Riesgo de Concentración',
      riskWeight: 0,
      exposure: totalAssets,
      charge: +concCharge.toFixed(1),
    });

    const totalRWA = components.reduce((s, c) => s + c.charge, 0);
    const rbc2Ratio = totalRWA > 0 ? (netWorth / totalRWA) * 100 : 0;
    const isWellCapitalized = rbc2Ratio >= 10;
    const isAdequately = rbc2Ratio >= 8;
    const surplus = netWorth - totalRWA * 0.1; // surplus over 10% threshold

    const overallStatus: RBC2Result['overallStatus'] = isAdequately
      ? 'compliant'
      : 'undercapitalized';

    // Always carry the IRR-placeholder WARNING gap so reviewers know the
    // duration component is a sector estimate, not a measured value.
    const gaps: DataGap[] = [
      dataGap('rbc2.irrCharge.durationGap', 'CALCULATION_FAILED', {
        severity: 'WARNING',
        action:
          "Wire DurationService into RBC2Service so the IRR charge uses the institution's measured duration gap instead of the sector default of 2.1 years.",
        context: { hardcodedDurationGap: 2.1 },
      }),
    ];
    // Surface a WARNING when an institution has assets but no liabilities —
    // possible (equity-funded entity) but unusual; the user should confirm.
    if (totalLiabilities === 0) {
      gaps.push(
        dataGap('rbc2.balanceSheet.liabilities', 'EMPTY_BALANCE_SHEET', {
          severity: 'WARNING',
          action:
            'No liability items found. RBC2 assumes equity-funded structure. Verify this matches the institution.',
        }),
      );
    }

    return {
      components,
      totalRiskWeightedAssets: +totalRWA.toFixed(1),
      totalRiskBasedCapitalCharge: +totalRWA.toFixed(1),
      netWorth: +netWorth.toFixed(1),
      riskBasedCapitalRatio: +rbc2Ratio.toFixed(2),
      isWellCapitalized,
      isAdequatelyCapitalized: isAdequately,
      surplus: +surplus.toFixed(1),
      narrativeEs: `El ratio de capital basado en riesgo (RBC2) es ${rbc2Ratio.toFixed(1)}% (${isWellCapitalized ? 'bien capitalizada' : isAdequately ? 'adecuadamente capitalizada' : 'SUBCAPITALIZADA'}). Activos ponderados por riesgo: $${totalRWA.toFixed(0)}M. Capital neto: $${netWorth.toFixed(0)}M. ${surplus >= 0 ? `Excedente sobre mínimo: $${surplus.toFixed(0)}M.` : `DÉFICIT: $${Math.abs(surplus).toFixed(0)}M necesarios.`}`,
      narrativeEn: `Risk-based capital ratio (RBC2) is ${rbc2Ratio.toFixed(1)}% (${isWellCapitalized ? 'well-capitalized' : isAdequately ? 'adequately capitalized' : 'UNDERCAPITALIZED'}). Risk-weighted assets: $${totalRWA.toFixed(0)}M. Net worth: $${netWorth.toFixed(0)}M. ${surplus >= 0 ? `Surplus: $${surplus.toFixed(0)}M.` : `SHORTFALL: $${Math.abs(surplus).toFixed(0)}M needed.`}`,
      overallStatus,
      gaps,
    };
  }

  /**
   * Build the structured `data_unavailable` shell returned when input data
   * is incomplete. Numeric fields are null (not zero) so callers can branch
   * on `overallStatus === 'data_unavailable'` instead of testing magic
   * numbers. The narrative explicitly says the report could not be computed.
   */
  private dataUnavailableResult(gaps: DataGap[]): RBC2Result {
    return {
      components: [],
      totalRiskWeightedAssets: null,
      totalRiskBasedCapitalCharge: null,
      netWorth: null,
      riskBasedCapitalRatio: null,
      isWellCapitalized: false,
      isAdequatelyCapitalized: false,
      surplus: null,
      narrativeEs:
        'RBC2 no se puede calcular — datos del balance insuficientes. Cargue el balance general antes de generar la radicación.',
      narrativeEn:
        'RBC2 cannot be computed — balance sheet inputs are missing. Upload balance sheet items before generating the filing.',
      overallStatus: 'data_unavailable',
      gaps,
    };
  }

  private mapToRBC2Category(sub: string): string {
    if (sub.includes('cash') || sub.includes('reserve')) return 'cash';
    if (sub.includes('treasury') || sub.includes('government'))
      return 'us_government';
    if (sub.includes('agency') || sub.includes('mbs'))
      return 'agency_securities';
    if (sub.includes('residential') || sub.includes('mortgage'))
      return 'residential_mortgage_1st';
    if (sub.includes('commercial') && sub.includes('re'))
      return 'commercial_re';
    if (sub.includes('consumer') || sub.includes('personal'))
      return 'consumer_loans';
    if (sub.includes('auto') || sub.includes('vehicle')) return 'auto_loans';
    if (sub.includes('commercial') || sub.includes('c&i'))
      return 'commercial_loans';
    if (sub.includes('credit') && sub.includes('card')) return 'credit_cards';
    if (sub.includes('securities')) return 'agency_securities';
    return 'other_assets';
  }
}
