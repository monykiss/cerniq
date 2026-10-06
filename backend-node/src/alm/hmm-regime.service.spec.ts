import { HMMRegimeService } from './hmm-regime.service';

describe('HMMRegimeService', () => {
  let service: HMMRegimeService;

  beforeEach(() => {
    service = new HMMRegimeService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── D1: honest insufficient-data shell (never the PLATEAU demo) ──

  it('returns a data_unavailable shell with a WARNING gap when fewer than 4 observations', () => {
    const result = service.detectRegime([[1, 0.1, 0]]);

    expect(result.status).toBe('data_unavailable');
    expect(result.currentRegime).toBeNull();
    expect(result.currentProbabilities).toEqual([]);
    expect(result.regimePersistence).toBeNull();
    expect(result.statePath).toEqual([]);
    expect(result.almImplications).toBeNull();
    expect(result.almImplicationsEs).toBeNull();

    const warning = result.gaps?.find((g) => g.severity === 'WARNING');
    expect(warning).toBeDefined();
    expect(warning!.reason).toBe('STRESS_INPUTS_INSUFFICIENT');
    expect(warning!.field).toBe('hmmRegime.observations');
  });

  // ── D1: real-data Viterbi/forward computation ──────────────────

  it('detects RISING_RATES regime from rate-increase observations', () => {
    const obs = Array.from({ length: 20 }, () => [10, 0.12, 0.04]);
    const result = service.detectRegime(obs);

    expect(result.status).toBe('ok');
    expect(result.gaps).toBeUndefined();
    expect(result.currentRegime).toBe('RISING_RATES');
    const risingProb = result.currentProbabilities.find(
      (p) => p.regime === 'RISING_RATES',
    );
    expect(risingProb!.probability).toBeGreaterThan(0.1);
  });

  it('detects CRISIS regime from high-volatility observations', () => {
    const obs = Array.from({ length: 20 }, () => [-2, 0.35, 0.25]);
    const result = service.detectRegime(obs);

    expect(result.currentRegime).toBe('CRISIS');
    expect(result.almImplications).toContain('Crisis');
    expect(result.almImplicationsEs).toContain('crisis');
  });

  it('probabilities sum to approximately 1.0', () => {
    const obs = Array.from({ length: 10 }, () => [0, 0.06, 0]);
    const result = service.detectRegime(obs);

    const sum = result.currentProbabilities.reduce(
      (s, p) => s + p.probability,
      0,
    );
    expect(sum).toBeCloseTo(1.0, 1);
  });

  it('generates observations from a weekly rate series', () => {
    const rates = [0.04, 0.041, 0.042, 0.043, 0.044];
    const obs = service.generateObservationsFromRates(rates);

    expect(obs).toHaveLength(4); // n-1 observations
    expect(obs[0]).toHaveLength(3); // [change_bps, vol, spread]
    expect(obs[0][0]).toBeCloseTo(10, 0); // 10bps increase
  });

  it('state path length matches the observation count', () => {
    const obs = Array.from({ length: 8 }, () => [0.2, 0.06, 0]);
    const result = service.detectRegime(obs);

    expect(result.statePath).toHaveLength(8);
    for (const state of result.statePath) {
      expect(['RISING_RATES', 'PLATEAU', 'EASING', 'CRISIS']).toContain(state);
    }
  });
});
