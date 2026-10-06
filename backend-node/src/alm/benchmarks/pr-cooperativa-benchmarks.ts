/**
 * PR Cooperativa Sector Benchmarks — CERNIQ PROVISIONAL / ILLUSTRATIVE peer set.
 *
 * PROVENANCE HONESTY (D1): these per-ratio medians/quartiles are CERNIQ
 * directional estimates, NOT an official COSSEC publication. COSSEC does not
 * publish an "Informe Sectorial"; its real quarterly release is "Estadísticas
 * Industria Cooperativas de Ahorro y Crédito" (aggregate sector totals, not
 * per-ratio quartiles). These values are informed by NCUA Call Report
 * aggregates + sector order-of-magnitude and are pending a real per-ratio
 * source — OPERATOR-INPUT-NEEDED. Consumers MUST disclose the provisional basis
 * (`provisional: true`) and must never present these as a COSSEC-sourced
 * sector comparison.
 */

export interface SectorBenchmark {
  median: number;
  p25: number;
  p75: number;
}

export interface SectorBenchmarks {
  lastUpdated: string;
  source: string;
  /** True when the figures are CERNIQ provisional/illustrative, not an official source. */
  provisional: boolean;
  medianAssets: number; // in $M
  ratios: {
    capitalAdequacy: SectorBenchmark;
    assetQuality: SectorBenchmark;
    liquidity: SectorBenchmark;
    loanToDeposit: SectorBenchmark;
    nim: SectorBenchmark;
    lcr: SectorBenchmark;
    durationGap: SectorBenchmark;
    earningAssetsYield: SectorBenchmark;
    costOfFunds: SectorBenchmark;
    concentrationRisk: SectorBenchmark;
  };
}

export const PR_COOP_BENCHMARKS: SectorBenchmarks = {
  lastUpdated: '2025-Q3',
  provisional: true,
  source:
    'CERNIQ provisional/illustrative peer benchmark (directional) — NOT an official COSSEC publication; informed by NCUA Call Report aggregates, pending real per-ratio COSSEC sector data',
  medianAssets: 185, // $185M (provisional)
  ratios: {
    capitalAdequacy: { median: 9.2, p25: 7.8, p75: 11.1 },
    assetQuality: { median: 2.8, p25: 1.2, p75: 4.5 },
    liquidity: { median: 12.1, p25: 10.2, p75: 15.3 },
    loanToDeposit: { median: 78.3, p25: 65.2, p75: 89.1 },
    nim: { median: 2.9, p25: 2.3, p75: 3.6 },
    lcr: { median: 118, p25: 105, p75: 138 },
    durationGap: { median: 1.8, p25: 0.8, p75: 2.9 },
    earningAssetsYield: { median: 4.8, p25: 4.1, p75: 5.6 },
    costOfFunds: { median: 1.9, p25: 1.4, p75: 2.5 },
    concentrationRisk: { median: 38, p25: 28, p75: 48 },
  },
};

/**
 * Get percentile rank text based on value vs benchmark quartiles.
 */
export function getPercentileRank(
  value: number,
  benchmark: SectorBenchmark,
  lowerIsBetter: boolean,
): {
  rank: string;
  rankEs: string;
  quartile: 'top' | 'above' | 'below' | 'bottom';
} {
  if (lowerIsBetter) {
    if (value <= benchmark.p25)
      return {
        rank: 'Top quartile',
        rankEs: 'Cuartil superior',
        quartile: 'top',
      };
    if (value <= benchmark.median)
      return {
        rank: 'Above sector median',
        rankEs: 'Por encima de la mediana',
        quartile: 'above',
      };
    if (value <= benchmark.p75)
      return {
        rank: 'Below sector median',
        rankEs: 'Por debajo de la mediana',
        quartile: 'below',
      };
    return {
      rank: 'Bottom quartile',
      rankEs: 'Cuartil inferior',
      quartile: 'bottom',
    };
  }
  // Higher is better
  if (value >= benchmark.p75)
    return {
      rank: 'Top quartile',
      rankEs: 'Cuartil superior',
      quartile: 'top',
    };
  if (value >= benchmark.median)
    return {
      rank: 'Above sector median',
      rankEs: 'Por encima de la mediana',
      quartile: 'above',
    };
  if (value >= benchmark.p25)
    return {
      rank: 'Below sector median',
      rankEs: 'Por debajo de la mediana',
      quartile: 'below',
    };
  return {
    rank: 'Bottom quartile',
    rankEs: 'Cuartil inferior',
    quartile: 'bottom',
  };
}
