import { HedgeLanguageDetector } from './hedge-language.detector';

describe('HedgeLanguageDetector', () => {
  let d: HedgeLanguageDetector;

  beforeEach(() => {
    d = new HedgeLanguageDetector();
  });

  it('detects common hedge tokens as WARN', () => {
    const vs = d.detect(
      'The institution may face rate risk and could potentially breach LCR.',
    );
    expect(vs.length).toBeGreaterThanOrEqual(3);
    for (const v of vs) {
      expect(v.rule).toBe('HEDGE_LANGUAGE');
      expect(v.severity).toBe('WARN');
    }
  });

  it('returns empty on clean CFO-level prose', () => {
    expect(
      d.detect(
        'Raise Fed Funds duration by 0.4 years via $15M swap by 2026-06-30.',
      ),
    ).toEqual([]);
  });

  it('count includes "approximately"', () => {
    expect(d.count('approximately $1M')).toBe(1);
    expect(d.count('may fall approximately')).toBe(2);
  });
});
