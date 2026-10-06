/**
 * Specs for the capital-ratio projection backtest (SR 11-7 outcomes analysis).
 *
 * The headline assertion is non-circular: the empirical breach frequency must
 * match the closed-form lognormal tail probability — if the sampler or the
 * lognormal transform were wrong, this fails.
 */
import { backtestProjectionCalibration } from './capital-ratio-backtest';

describe('backtestProjectionCalibration', () => {
  let report: ReturnType<typeof backtestProjectionCalibration>;

  beforeAll(() => {
    report = backtestProjectionCalibration();
  });

  it('overall calibration passes', () => {
    expect(report.passed).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
  });

  it('breach frequency matches the closed-form lognormal tail (< 0.5pp error)', () => {
    const c = report.checks.find((x) => x.name === 'breach-calibration')!;
    expect(c).toBeDefined();
    expect(c.passed).toBe(true);
    expect(c.metrics.absErrorPp).toBeLessThan(0.5);
    // the chosen channel produces a non-trivial tail (~10%), so this is a real test
    expect(c.metrics.theoretical).toBeGreaterThan(2);
  });

  it('mean is unbiased to the deterministic centre (< 0.05pp)', () => {
    const c = report.checks.find((x) => x.name === 'mean-unbiased')!;
    expect(c.passed).toBe(true);
    expect(c.metrics.absErrorPp).toBeLessThan(0.05);
  });

  it('Monte Carlo error shrinks with path count (1/√N convergence)', () => {
    const c = report.checks.find((x) => x.name === 'convergence')!;
    expect(c.passed).toBe(true);
    expect(c.metrics.stdHigh).toBeLessThan(c.metrics.stdLow);
  });

  it('percentiles are ordered across every seed', () => {
    expect(
      report.checks.find((x) => x.name === 'percentile-ordering')!.passed,
    ).toBe(true);
  });

  it('the systemic copula fattens the adverse tail (ρ↑ ⇒ wider band)', () => {
    const c = report.checks.find((x) => x.name === 'copula-tail-widening')!;
    expect(c.passed).toBe(true);
    expect(c.metrics.widthHighRho).toBeGreaterThan(c.metrics.widthLowRho);
  });

  it('is deterministic — same options reproduce the report', () => {
    const a = backtestProjectionCalibration({ seeds: 4, paths: 5000 });
    const b = backtestProjectionCalibration({ seeds: 4, paths: 5000 });
    expect(a).toEqual(b);
  });
});
