import {
  DEFAULT_MACRO_STALENESS_DAYS,
  getMacroOverlayMode,
  resolveMacroStalenessDays,
} from './macro-overlay-config.util';

describe('macro-overlay-config util — truth tables (W1.2)', () => {
  describe('getMacroOverlayMode', () => {
    // Truth table: only the exact string 'hardcoded' flips the kill switch.
    it.each([
      ['hardcoded', 'hardcoded'],
      ['derived', 'derived'],
      [undefined, 'derived'],
      ['', 'derived'],
      ['HARDCODED', 'derived'], // case-sensitive by design — schema pins the enum
      ['true', 'derived'],
      ['0', 'derived'],
    ] as const)('CECL_MACRO_OVERLAY_MODE=%p → %p', (raw, expected) => {
      const env: NodeJS.ProcessEnv = {};
      if (raw !== undefined) env.CECL_MACRO_OVERLAY_MODE = raw;
      expect(getMacroOverlayMode(env)).toBe(expected);
    });
  });

  describe('resolveMacroStalenessDays', () => {
    it.each([
      [undefined, DEFAULT_MACRO_STALENESS_DAYS],
      ['', DEFAULT_MACRO_STALENESS_DAYS],
      ['  ', DEFAULT_MACRO_STALENESS_DAYS],
      ['90', 90],
      ['1', 1],
      ['730', 730],
      ['0', DEFAULT_MACRO_STALENESS_DAYS], // below range
      ['731', DEFAULT_MACRO_STALENESS_DAYS], // above range
      ['90.5', DEFAULT_MACRO_STALENESS_DAYS], // non-integer
      ['90abc', DEFAULT_MACRO_STALENESS_DAYS], // parseInt would have taken 90 — Number rejects
      ['NaN', DEFAULT_MACRO_STALENESS_DAYS],
    ] as const)('PR_MACRO_STALENESS_DAYS=%p → %p', (raw, expected) => {
      const env: NodeJS.ProcessEnv = {};
      if (raw !== undefined) env.PR_MACRO_STALENESS_DAYS = raw;
      expect(resolveMacroStalenessDays(env)).toBe(expected);
    });
  });
});
