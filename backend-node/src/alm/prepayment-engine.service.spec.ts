import { PrepaymentEngineService } from './prepayment-engine.service';

describe('PrepaymentEngineService', () => {
  let service: PrepaymentEngineService;

  beforeEach(() => {
    service = new PrepaymentEngineService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── computePRCPR: S-curve behavior ────────────────────────

  it('produces higher CPR when rate incentive is large (200bps)', () => {
    const result = service.computePRCPR({
      mortgageRate: 0.065, // borrower's rate 6.5%
      currentMarketRate: 0.045, // market dropped to 4.5%
      ageMonths: 36, // mature loan
      month: 6,
    });

    // 200bps incentive => CPR should be elevated (>10%)
    expect(result.rateIncentive).toBeCloseTo(0.02, 3);
    expect(result.finalCPR).toBeGreaterThan(0.05);
    expect(result.monthlySMM).toBeGreaterThan(0);
    expect(result.monthlySMM).toBeLessThan(result.finalCPR);
  });

  it('produces low CPR when there is no rate incentive', () => {
    const result = service.computePRCPR({
      mortgageRate: 0.045,
      currentMarketRate: 0.045, // no incentive
      ageMonths: 36,
      month: 6,
    });

    expect(result.rateIncentive).toBeCloseTo(0, 4);
    // Near-zero incentive => base CPR relatively low (under ~10%)
    expect(result.finalCPR).toBeLessThan(0.1);
  });

  // ── Age ramp factor ───────────────────────────────────────

  it('applies age ramp: young loans have lower CPR than seasoned ones', () => {
    const young = service.computePRCPR({
      mortgageRate: 0.065,
      currentMarketRate: 0.045,
      ageMonths: 6, // young loan
      month: 6,
    });

    const seasoned = service.computePRCPR({
      mortgageRate: 0.065,
      currentMarketRate: 0.045,
      ageMonths: 36, // seasoned
      month: 6,
    });

    expect(young.ageRampAdj).toBeLessThan(seasoned.ageRampAdj);
    expect(young.finalCPR).toBeLessThan(seasoned.finalCPR);
  });

  // ── Disaster override ─────────────────────────────────────

  it('applies 30% CPR spike during post-hurricane scenario', () => {
    const normal = service.computePRCPR({
      mortgageRate: 0.055,
      currentMarketRate: 0.05,
      ageMonths: 36,
      month: 6,
      disasterOverride: 0,
    });

    const hurricane = service.computePRCPR({
      mortgageRate: 0.055,
      currentMarketRate: 0.05,
      ageMonths: 36,
      month: 6,
      disasterOverride: 1,
    });

    expect(hurricane.disasterAdj).toBeCloseTo(1.3, 2);
    expect(hurricane.finalCPR).toBeGreaterThan(normal.finalCPR);
    // Should be exactly 30% higher
    expect(hurricane.finalCPR / normal.finalCPR).toBeCloseTo(1.3, 2);
  });

  // ── computeSensitivity curve ──────────────────────────────

  it('generates sensitivity curve with multiple points', () => {
    const sensitivity = service.computeSensitivity(0.06, 0.05, 36);

    // Sweep from -200 to +200 bps in 25bps steps = 17 points
    expect(sensitivity.points.length).toBe(17);
    expect(sensitivity.currentPoint).toBeDefined();
    expect(sensitivity.currentPoint.rateIncentive).toBeCloseTo(0.01, 3);

    // CPR should increase as rate incentive grows (descending market rates)
    const firstPoint = sensitivity.points[0]; // market rate -200bps => high incentive
    const lastPoint = sensitivity.points[sensitivity.points.length - 1]; // +200bps => negative incentive
    expect(firstPoint.cpr).toBeGreaterThan(lastPoint.cpr);
  });

  // ── PSA comparison ────────────────────────────────────────

  it('computes PSA CPR with correct ramp and scaling', () => {
    // 100 PSA, fully ramped (36 months)
    const cpr100 = service.computeNationalPSACPR(100, 36);
    expect(cpr100).toBeCloseTo(0.06, 3); // 6% base CPR

    // 150 PSA, fully ramped
    const cpr150 = service.computeNationalPSACPR(150, 36);
    expect(cpr150).toBeCloseTo(0.09, 3); // 9%

    // 100 PSA, half-ramped (15 months)
    const cprHalf = service.computeNationalPSACPR(100, 15);
    expect(cprHalf).toBeCloseTo(0.03, 3); // 3%
  });
});
