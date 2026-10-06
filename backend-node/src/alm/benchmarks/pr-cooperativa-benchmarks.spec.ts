import {
  PR_COOP_BENCHMARKS,
  getPercentileRank,
  SectorBenchmarks,
  SectorBenchmark,
} from './pr-cooperativa-benchmarks';

describe('PR Cooperativa Benchmarks', () => {
  // ── Static benchmark data ──────────────────────────────────────────

  describe('PR_COOP_BENCHMARKS', () => {
    it('has valid metadata', () => {
      expect(PR_COOP_BENCHMARKS.lastUpdated).toBe('2025-Q3');
      expect(PR_COOP_BENCHMARKS.medianAssets).toBe(185);
    });

    it('declares honest provisional provenance — not a (non-existent) COSSEC publication (D1)', () => {
      // COSSEC publishes no "Informe Sectorial"; these are CERNIQ provisional
      // estimates. The source must not wear a fabricated regulatory citation.
      expect(PR_COOP_BENCHMARKS.provisional).toBe(true);
      expect(PR_COOP_BENCHMARKS.source).not.toMatch(/Informe Sectorial/i);
      expect(PR_COOP_BENCHMARKS.source.toLowerCase()).toContain('provisional');
    });

    it('has all required ratio categories', () => {
      const ratios = PR_COOP_BENCHMARKS.ratios;
      const expectedKeys = [
        'capitalAdequacy',
        'assetQuality',
        'liquidity',
        'loanToDeposit',
        'nim',
        'lcr',
        'durationGap',
        'earningAssetsYield',
        'costOfFunds',
        'concentrationRisk',
      ];
      for (const key of expectedKeys) {
        expect(ratios).toHaveProperty(key);
      }
    });

    it('each benchmark has median, p25, and p75', () => {
      for (const [name, bench] of Object.entries(PR_COOP_BENCHMARKS.ratios)) {
        const b = bench;
        expect(typeof b.median).toBe('number');
        expect(typeof b.p25).toBe('number');
        expect(typeof b.p75).toBe('number');
        // p25 <= median <= p75 (for standard metrics)
        expect(b.p25).toBeLessThanOrEqual(b.median);
        expect(b.median).toBeLessThanOrEqual(b.p75);
      }
    });

    it('capitalAdequacy values are within reasonable range', () => {
      const { capitalAdequacy } = PR_COOP_BENCHMARKS.ratios;
      expect(capitalAdequacy.median).toBe(9.2);
      expect(capitalAdequacy.p25).toBe(7.8);
      expect(capitalAdequacy.p75).toBe(11.1);
    });

    it('lcr values are above 100 (minimum regulatory requirement)', () => {
      const { lcr } = PR_COOP_BENCHMARKS.ratios;
      expect(lcr.p25).toBeGreaterThanOrEqual(100);
    });
  });

  // ── getPercentileRank (higher is better) ───────────────────────────

  describe('getPercentileRank — higher is better', () => {
    const benchmark: SectorBenchmark = { median: 10, p25: 8, p75: 12 };

    it('returns "Top quartile" when value >= p75', () => {
      const result = getPercentileRank(12, benchmark, false);
      expect(result.rank).toBe('Top quartile');
      expect(result.rankEs).toBe('Cuartil superior');
      expect(result.quartile).toBe('top');
    });

    it('returns "Top quartile" when value > p75', () => {
      const result = getPercentileRank(15, benchmark, false);
      expect(result.quartile).toBe('top');
    });

    it('returns "Above sector median" when value >= median and < p75', () => {
      const result = getPercentileRank(10, benchmark, false);
      expect(result.rank).toBe('Above sector median');
      expect(result.rankEs).toBe('Por encima de la mediana');
      expect(result.quartile).toBe('above');
    });

    it('returns "Below sector median" when value >= p25 and < median', () => {
      const result = getPercentileRank(8, benchmark, false);
      expect(result.rank).toBe('Below sector median');
      expect(result.rankEs).toBe('Por debajo de la mediana');
      expect(result.quartile).toBe('below');
    });

    it('returns "Bottom quartile" when value < p25', () => {
      const result = getPercentileRank(5, benchmark, false);
      expect(result.rank).toBe('Bottom quartile');
      expect(result.rankEs).toBe('Cuartil inferior');
      expect(result.quartile).toBe('bottom');
    });
  });

  // ── getPercentileRank (lower is better) ────────────────────────────

  describe('getPercentileRank — lower is better', () => {
    const benchmark: SectorBenchmark = { median: 3, p25: 1.5, p75: 5 };

    it('returns "Top quartile" when value <= p25', () => {
      const result = getPercentileRank(1.5, benchmark, true);
      expect(result.quartile).toBe('top');
    });

    it('returns "Top quartile" when value < p25', () => {
      const result = getPercentileRank(1.0, benchmark, true);
      expect(result.quartile).toBe('top');
    });

    it('returns "Above sector median" when value <= median and > p25', () => {
      const result = getPercentileRank(2.5, benchmark, true);
      expect(result.quartile).toBe('above');
    });

    it('returns "Below sector median" when value <= p75 and > median', () => {
      const result = getPercentileRank(4, benchmark, true);
      expect(result.quartile).toBe('below');
    });

    it('returns "Bottom quartile" when value > p75', () => {
      const result = getPercentileRank(6, benchmark, true);
      expect(result.quartile).toBe('bottom');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('getPercentileRank — edge cases', () => {
    const benchmark: SectorBenchmark = { median: 10, p25: 10, p75: 10 };

    it('handles identical p25/median/p75 (lower is better)', () => {
      const result = getPercentileRank(10, benchmark, true);
      // value <= p25 -> top quartile
      expect(result.quartile).toBe('top');
    });

    it('handles identical p25/median/p75 (higher is better)', () => {
      const result = getPercentileRank(10, benchmark, false);
      // value >= p75 -> top quartile
      expect(result.quartile).toBe('top');
    });

    it('handles zero values (lower is better)', () => {
      const zeroBench: SectorBenchmark = { median: 0, p25: 0, p75: 0 };
      const result = getPercentileRank(0, zeroBench, true);
      expect(result.quartile).toBe('top');
    });

    it('handles negative values', () => {
      const negBench: SectorBenchmark = { median: -2, p25: -5, p75: 0 };
      const result = getPercentileRank(-3, negBench, false);
      // -3 >= p25 (-5) but < median (-2), so "below"
      expect(result.quartile).toBe('below');
    });
  });
});
