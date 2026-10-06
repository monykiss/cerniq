import { FedFuturesService } from './fed-futures.service';

describe('FedFuturesService', () => {
  let service: FedFuturesService;

  beforeEach(() => {
    service = new FedFuturesService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns 8 FOMC meetings in the curve', () => {
    const result = service.computeFedFuturesCurve(0.0475);
    expect(result.meetings).toHaveLength(8);
    expect(result.currentFedFunds).toBeCloseTo(0.0475, 4);
  });

  it('implied rates decrease monotonically under easing expectations', () => {
    const result = service.computeFedFuturesCurve(0.0475);
    for (let i = 1; i < result.meetings.length; i++) {
      expect(result.meetings[i].impliedRate).toBeLessThanOrEqual(
        result.meetings[i - 1].impliedRate,
      );
    }
  });

  it('terminal rate is below current rate when cuts are expected', () => {
    const result = service.computeFedFuturesCurve(0.0475);
    expect(result.terminalRate).toBeLessThan(result.currentFedFunds);
    expect(result.cutsExpected12M).toBeGreaterThan(0);
    expect(result.hikesExpected12M).toBe(0);
  });

  it('probability fields sum to approximately 1.0 for each meeting', () => {
    const result = service.computeFedFuturesCurve(0.05);
    for (const m of result.meetings) {
      const sum =
        m.probability.hold +
        m.probability.hike25 +
        m.probability.cut25 +
        m.probability.cut50;
      expect(sum).toBeCloseTo(1.0, 1);
    }
  });

  it('generates both English and Spanish narratives', () => {
    const result = service.computeFedFuturesCurve(0.0475);
    expect(result.marketNarrative).toContain('rate cuts');
    expect(result.marketNarrativeEs).toContain('recortes');
  });

  it('handles zero fed funds rate without crashing', () => {
    const result = service.computeFedFuturesCurve(0.0);
    expect(result.currentFedFunds).toBe(0);
    expect(result.terminalRate).toBeGreaterThanOrEqual(0);
    expect(result.meetings).toHaveLength(8);
  });
});
