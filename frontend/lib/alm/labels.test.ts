/**
 * Labels invariants. The most important thing these tests lock in is that
 * label() NEVER returns a raw identifier — even for unregistered keys it
 * must fall through to humanize(). The P0 bug we just fixed was exactly
 * that: `{key}` rendered directly. If one of these tests regresses, that
 * bug class is back.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  humanize,
  isKnownLabel,
  label,
  labelMeta,
  labelUnit,
  LABELS,
} from './labels';

// ─── humanize() — the last-line-of-defense fallback ────────────────────────

describe('humanize', () => {
  it('splits camelCase', () => {
    expect(humanize('loanToShare')).toBe('Loan To Share');
  });

  it('splits PascalCase', () => {
    expect(humanize('NetInterestMargin')).toBe('Net Interest Margin');
  });

  it('splits snake_case', () => {
    expect(humanize('net_interest_margin')).toBe('Net Interest Margin');
  });

  it('splits kebab-case', () => {
    expect(humanize('rate-shock-v2')).toBe('Rate Shock V2');
  });

  it('handles mixed separators', () => {
    expect(humanize('lambda_0')).toBe('Lambda 0');
    expect(humanize('beta_1_hat')).toBe('Beta 1 Hat');
  });

  it('handles single-word all-lowercase', () => {
    expect(humanize('nim')).toBe('Nim');
  });

  it('handles all-uppercase (NCUA, LCR)', () => {
    // Current behaviour: all-uppercase stays as one word but is preserved.
    // We document the behaviour here rather than fix it — for true
    // acronyms like NCUA, the answer is "register them explicitly".
    expect(humanize('NCUA')).toBe('NCUA');
  });

  it('handles empty string gracefully', () => {
    expect(humanize('')).toBe('');
  });

  it('is idempotent (safe to call twice)', () => {
    const once = humanize('loanToShare');
    expect(humanize(once)).toBe('Loan To Share');
  });

  it('caches repeated calls', () => {
    // Not a behavioural assertion so much as documentation — humanize uses
    // an internal Map cache to avoid re-walking the same key hundreds of
    // times per second in a dense table.
    const a = humanize('some_cached_key');
    const b = humanize('some_cached_key');
    expect(a).toBe(b);
  });
});

// ─── label() — the primary API surface ──────────────────────────────────────

describe('label', () => {
  it('resolves a direct hit (en)', () => {
    expect(label('nim', 'en')).toBe('Net Interest Margin');
  });

  it('resolves a direct hit (es)', () => {
    expect(label('nim', 'es')).toBe('Margen de Interés Neto');
  });

  it('resolves Svensson curve parameters with subscript notation', () => {
    expect(label('beta0', 'en')).toContain('β₀');
    expect(label('lambda_0', 'es')).toContain('λ₀');
    expect(label('tau', 'en')).toContain('τ');
  });

  it('resolves camelCase keys (loanToShare) via direct hit', () => {
    expect(label('loanToShare', 'en')).toBe('Loan-to-Share');
    expect(label('loanToShare', 'es')).toBe('Préstamo / Aportación');
  });

  it('resolves via lowercase fallback when case differs', () => {
    // LABELS has 'lcr' — capitalised access should still match
    expect(label('LCR', 'en')).toBe('Liquidity Coverage Ratio');
  });

  it('falls back to humanize() for unknown keys — NEVER returns raw key', () => {
    const out = label('thisKeyIsNotRegistered', 'en');
    expect(out).toBe('This Key Is Not Registered');
    // The critical assertion — if this ever becomes the raw key, the P0
    // bug class is back.
    expect(out).not.toBe('thisKeyIsNotRegistered');
  });

  it('warns once in dev mode for missing keys', () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error — overriding read-only for test
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      label('xyz_warn_once_key', 'en');
      label('xyz_warn_once_key', 'en'); // second call should NOT re-warn
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('xyz_warn_once_key');
    } finally {
      warn.mockRestore();
      // @ts-expect-error — restoring
      process.env.NODE_ENV = originalEnv;
    }
  });
});

// ─── labelUnit() ────────────────────────────────────────────────────────────

describe('labelUnit', () => {
  it('returns the unit for a known numeric key', () => {
    expect(labelUnit('nim')).toBe('%');
    expect(labelUnit('lcr')).toBe('%');
    expect(labelUnit('var')).toBe('USD_M');
    expect(labelUnit('duration')).toBe('years');
  });

  it('returns undefined for a key without a unit', () => {
    expect(labelUnit('beta0')).toBeUndefined();
    expect(labelUnit('tau')).toBeUndefined();
  });

  it('returns undefined for a totally unknown key', () => {
    expect(labelUnit('not-a-real-key')).toBeUndefined();
  });

  it('respects case-insensitive lookup', () => {
    expect(labelUnit('NIM')).toBe('%');
  });
});

// ─── labelMeta() + isKnownLabel() ───────────────────────────────────────────

describe('labelMeta', () => {
  it('returns full label record for known key', () => {
    const meta = labelMeta('lcr');
    expect(meta?.en).toBe('Liquidity Coverage Ratio');
    expect(meta?.regulatoryRef).toBe('Basel III LCR');
  });

  it('returns undefined for unknown key', () => {
    expect(labelMeta('nope')).toBeUndefined();
  });
});

describe('isKnownLabel', () => {
  it('is true for registered key', () => {
    expect(isKnownLabel('nim')).toBe(true);
  });

  it('is true for case-variant of registered key', () => {
    expect(isKnownLabel('NIM')).toBe(true);
  });

  it('is false for unregistered key', () => {
    expect(isKnownLabel('definitelyNotRegistered')).toBe(false);
  });
});

// ─── Dictionary coverage sanity ─────────────────────────────────────────────

describe('LABELS dictionary coverage', () => {
  it('has entries for the keys that were leaking pre-fix', () => {
    // These are the exact keys that board-report, svensson, and usvi
    // were rendering raw before the P0 fix. If any disappears from the
    // dictionary, the old bug is one PR away from returning.
    const leakedKeys = [
      // board-report
      'nim', 'lcr', 'nsfr', 'nwr', 'eve', 'npl', 'cecl', 'roa',
      // svensson / nelson-siegel
      'beta', 'beta0', 'beta1', 'beta2', 'beta3', 'lambda', 'lambda_0', 'lambda_1', 'lambda2', 'tau',
      // usvi
      'loanShare', 'loanToShare', 'nplr',
    ];
    for (const key of leakedKeys) {
      expect(LABELS[key], `missing dictionary entry: ${key}`).toBeDefined();
    }
  });

  it('every entry has non-empty en and es strings', () => {
    for (const [key, value] of Object.entries(LABELS)) {
      expect(value.en.length, `${key}.en is empty`).toBeGreaterThan(0);
      expect(value.es.length, `${key}.es is empty`).toBeGreaterThan(0);
    }
  });
});
