import { Injectable } from '@nestjs/common';

/**
 * Capital Adequacy Ratio (CAR) Analysis — Quant Model #66
 *
 * Calculates Tier 1, Tier 2, and Total Capital ratios
 * against risk-weighted assets (RWA). Basel III standard.
 *
 * Minimums: CET1 >= 4.5%, Tier 1 >= 6%, Total >= 8%
 * With buffers: CET1 >= 7%, Tier 1 >= 8.5%, Total >= 10.5%
 */
@Injectable()
export class CapitalAdequacyRatioService {
  calculate(params: {
    cet1Capital: number;
    additionalTier1: number;
    tier2Capital: number;
    riskWeightedAssets: number;
    totalAssets: number;
    leverageExposure?: number;
  }): {
    cet1Ratio: number;
    tier1Ratio: number;
    totalCapitalRatio: number;
    leverageRatio: number;
    buffers: {
      conservationBuffer: number;
      countercyclicalBuffer: number;
      totalBuffer: number;
    };
    compliance: {
      cet1: boolean;
      tier1: boolean;
      total: boolean;
      leverage: boolean;
    };
    stressCapital: Array<{
      shock: string;
      shockEs: string;
      cet1After: number;
      compliant: boolean;
    }>;
    interpretation: string;
    interpretationEs: string;
  } {
    const {
      cet1Capital,
      additionalTier1,
      tier2Capital,
      riskWeightedAssets,
      totalAssets,
    } = params;
    const tier1 = cet1Capital + additionalTier1;
    const totalCapital = tier1 + tier2Capital;
    const leverageExposure = params.leverageExposure ?? totalAssets;

    const cet1Ratio = +((cet1Capital / riskWeightedAssets) * 100).toFixed(2);
    const tier1Ratio = +((tier1 / riskWeightedAssets) * 100).toFixed(2);
    const totalCapitalRatio = +(
      (totalCapital / riskWeightedAssets) *
      100
    ).toFixed(2);
    const leverageRatio = +((tier1 / leverageExposure) * 100).toFixed(2);

    const conservationBuffer = Math.max(0, cet1Ratio - 4.5);
    const countercyclicalBuffer = 0; // PR typically 0
    const totalBuffer = conservationBuffer + countercyclicalBuffer;

    const stressCapital = [
      { shock: 'Base case', shockEs: 'Caso base', lossPct: 0 },
      {
        shock: 'Mild stress (-50bps NIM)',
        shockEs: 'Estrés leve (-50pbs NIM)',
        lossPct: 0.5,
      },
      {
        shock: 'Moderate (-100bps NIM)',
        shockEs: 'Moderado (-100pbs NIM)',
        lossPct: 1.2,
      },
      {
        shock: 'Severe (-200bps + credit)',
        shockEs: 'Severo (-200pbs + crédito)',
        lossPct: 2.5,
      },
      {
        shock: 'Hurricane + recession',
        shockEs: 'Huracán + recesión',
        lossPct: 4.0,
      },
    ].map((s) => {
      const lossAmount = (totalAssets * s.lossPct) / 100;
      const cet1After = +(
        ((cet1Capital - lossAmount) / riskWeightedAssets) *
        100
      ).toFixed(2);
      return {
        shock: s.shock,
        shockEs: s.shockEs,
        cet1After,
        compliant: cet1After >= 7.0,
      };
    });

    return {
      cet1Ratio,
      tier1Ratio,
      totalCapitalRatio,
      leverageRatio,
      buffers: {
        conservationBuffer: +conservationBuffer.toFixed(2),
        countercyclicalBuffer,
        totalBuffer: +totalBuffer.toFixed(2),
      },
      compliance: {
        cet1: cet1Ratio >= 7.0,
        tier1: tier1Ratio >= 8.5,
        total: totalCapitalRatio >= 10.5,
        leverage: leverageRatio >= 3.0,
      },
      stressCapital,
      interpretation: `CET1: ${cet1Ratio}% (min 7%). Tier 1: ${tier1Ratio}% (min 8.5%). Total: ${totalCapitalRatio}% (min 10.5%). Leverage: ${leverageRatio}% (min 3%). Conservation buffer: ${conservationBuffer.toFixed(1)}%.`,
      interpretationEs: `CET1: ${cet1Ratio}% (min 7%). Nivel 1: ${tier1Ratio}% (min 8.5%). Total: ${totalCapitalRatio}% (min 10.5%). Apalancamiento: ${leverageRatio}% (min 3%). Colchon conservacion: ${conservationBuffer.toFixed(1)}%.`,
    };
  }
}
