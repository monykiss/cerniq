import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import type { TranslationKeys } from '../types';

/**
 * Directory-suite parity test for the bilingual locale dictionaries.
 *
 * `tsc` proves key PRESENCE (both files satisfy `TranslationKeys`). This suite
 * locks the value-level invariants the type system is blind to — the same
 * invariants `scripts/verify-i18n-parity.mjs` enforces in the lint chain, here
 * exercised against the real locales in the test phase (and counted toward the
 * coverage floor). The general "es===en untranslated" rule (which needs an
 * allowlist of intentional shared tokens) lives only in the .mjs gate to keep
 * a single source of truth; this suite asserts structure + a regression lock.
 */

type Tree = Record<string, unknown>;

function collectPaths(obj: Tree, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [cp, cv] of collectPaths(v as Tree, p)) out.set(cp, cv);
    } else {
      out.set(p, v);
    }
  }
  return out;
}

describe('i18n locale parity (en/es)', () => {
  const enPaths = collectPaths(en as unknown as Tree);
  const esPaths = collectPaths(es as unknown as Tree);

  it('has identical key structure in both directions', () => {
    const enKeys = [...enPaths.keys()].sort();
    const esKeys = [...esPaths.keys()].sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('has matching array lengths for every list-valued key', () => {
    const mismatches: string[] = [];
    for (const [path, enVal] of enPaths) {
      if (Array.isArray(enVal)) {
        const esVal = esPaths.get(path);
        if (!Array.isArray(esVal) || esVal.length !== enVal.length) {
          mismatches.push(`${path}: en=${enVal.length} es=${Array.isArray(esVal) ? esVal.length : 'n/a'}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('contains no empty or whitespace-only string values', () => {
    const empties: string[] = [];
    const scan = (locale: 'en' | 'es', paths: Map<string, unknown>) => {
      for (const [path, val] of paths) {
        if (typeof val === 'string' && val.trim() === '') empties.push(`${locale}:${path}`);
        if (Array.isArray(val)) {
          val.forEach((x, i) => {
            if (typeof x === 'string' && x.trim() === '') empties.push(`${locale}:${path}[${i}]`);
          });
        }
      }
    };
    scan('en', enPaths);
    scan('es', esPaths);
    expect(empties).toEqual([]);
  });

  it('translates the scenario-builder verdict labels to Spanish (regression lock)', () => {
    // These three leaked their English uppercase values into `es` until the
    // 2026-06-07 accent sweep. risk.critical was already 'Crítico', proving
    // these were oversights, not an intentional shared-token style.
    const verdicts: Array<keyof TranslationKeys['scenarioBuilder']> = ['resilient', 'adequate', 'critical'];
    for (const key of verdicts) {
      expect(es.scenarioBuilder[key]).not.toBe(en.scenarioBuilder[key]);
    }
    expect(es.scenarioBuilder.resilient).toBe('RESILIENTE');
    expect(es.scenarioBuilder.adequate).toBe('ADECUADO');
    expect(es.scenarioBuilder.critical).toBe('CRÍTICO');
  });
});
