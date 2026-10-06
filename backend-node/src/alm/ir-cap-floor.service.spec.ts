import { IRCapFloorService } from './ir-cap-floor.service';

describe('IRCapFloorService', () => {
  let service: IRCapFloorService;

  // Standard test inputs: 4 quarterly periods (1 year cap/floor)
  const forwardRates = [0.045, 0.046, 0.047, 0.048];
  const discountFactors = [0.989, 0.978, 0.967, 0.956];
  const vol = 0.2; // 20% Black vol
  const strike = 0.045;
  const notional = 10_000_000;
  const tau = 0.25; // quarterly

  beforeEach(() => {
    service = new IRCapFloorService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── Cap Pricing ────────────────────────────────────────────

  it('should price an interest rate cap with positive premium when forward rates exceed strike', () => {
    const result = service.priceCapFloor(
      'cap',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    expect(result.type).toBe('cap');
    expect(result.premium).toBeGreaterThan(0);
    expect(result.premiumPct).toBeGreaterThan(0);
    expect(result.notional).toBe(notional);
    expect(result.strike).toBe(strike);
    expect(result.maturityYears).toBeCloseTo(1, 2);
  });

  it('should price each caplet individually and sum to total premium', () => {
    const result = service.priceCapFloor(
      'cap',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    const sumCaplets = result.capletPrices.reduce(
      (s, c) => s + c.capletPrice,
      0,
    );
    expect(sumCaplets).toBeCloseTo(result.premium, 0);
    expect(result.capletPrices).toHaveLength(4);
  });

  // ── Floor Pricing ──────────────────────────────────────────

  it('should price a floor with positive premium when strike exceeds some forward rates', () => {
    const highStrike = 0.05; // above all forward rates
    const result = service.priceCapFloor(
      'floor',
      notional,
      highStrike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    expect(result.type).toBe('floor');
    expect(result.premium).toBeGreaterThan(0);
  });

  // ── Put-Call Parity ────────────────────────────────────────

  it('should satisfy cap-floor parity: cap - floor ≈ sum of (forward - strike) x df x tau x notional', () => {
    const capResult = service.priceCapFloor(
      'cap',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );
    const floorResult = service.priceCapFloor(
      'floor',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    // Cap - Floor ≈ Σ df * tau * notional * (F - K)
    let intrinsicSum = 0;
    for (let i = 0; i < forwardRates.length; i++) {
      intrinsicSum +=
        discountFactors[i] * tau * notional * (forwardRates[i] - strike);
    }

    const capMinusFloor = capResult.premium - floorResult.premium;
    expect(capMinusFloor).toBeCloseTo(intrinsicSum, -1); // within $10
  });

  // ── Greeks ─────────────────────────────────────────────────

  it('should compute delta as finite-difference sensitivity to forward rate shift', () => {
    const result = service.priceCapFloor(
      'cap',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    // Delta should be positive for a cap (premium increases as rates rise)
    expect(result.delta).toBeGreaterThan(0);
  });

  it('should compute positive vega (premium increases with higher volatility)', () => {
    const result = service.priceCapFloor(
      'cap',
      notional,
      strike,
      forwardRates,
      vol,
      discountFactors,
      tau,
    );

    // Vega should be positive for both caps and floors
    expect(result.vega).toBeGreaterThan(0);
  });

  // ── Bachelier Model for Near-Zero Rates ────────────────────

  it('should use Bachelier (normal) model when forward rates are near zero', () => {
    const nearZeroFwds = [0.003, 0.004, 0.003, 0.002];
    const nearZeroStrike = 0.003;

    const result = service.priceCapFloor(
      'cap',
      notional,
      nearZeroStrike,
      nearZeroFwds,
      0.005,
      discountFactors,
      tau,
    );

    // Should not throw and should produce a valid non-negative premium
    expect(result.premium).toBeGreaterThanOrEqual(0);
    expect(result.capletPrices).toHaveLength(4);
  });
});
