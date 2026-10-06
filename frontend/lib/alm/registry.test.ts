/**
 * Registry invariants. These tests are structural — they should never need to
 * be updated when a new module is added, only when the registry schema itself
 * changes. If one of these fails, assume a quiet cascade bug across the 96-
 * module surface and investigate the root cause before editing the test.
 */

import { describe, expect, it } from 'vitest';

import {
  ALM_CATEGORIES,
  ALM_CATEGORIES_BY_ID,
  ALM_MODULE_COUNT,
  ALM_MODULES,
  MIGRATED_COUNT,
  MIGRATED_SLUGS,
  MODULES_BY_CATEGORY,
  MODULES_BY_SLUG,
  getAlmModule,
  getAlmModuleFromPathname,
  getModuleName,
  isMigrated,
  type AlmCategoryId,
} from './registry';

const CATEGORY_IDS: readonly AlmCategoryId[] = [
  'core', 'rate', 'liquidity', 'credit', 'quant',
  'strategy', 'regulatory', 'intelligence', 'frontier',
];

// ─── Structural invariants ──────────────────────────────────────────────────

describe('ALM_MODULES structural invariants', () => {
  it('has at least the 9 core categories × 2 modules floor (sanity)', () => {
    expect(ALM_MODULE_COUNT).toBeGreaterThanOrEqual(18);
  });

  it('ALM_MODULE_COUNT matches the array length (no constant drift)', () => {
    expect(ALM_MODULE_COUNT).toBe(ALM_MODULES.length);
  });

  it('every module has a unique slug', () => {
    const slugs = ALM_MODULES.map((m) => m.slug);
    const unique = new Set(slugs);
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    expect(dupes, `duplicate slugs: ${dupes.join(', ')}`).toHaveLength(0);
    expect(unique.size).toBe(slugs.length);
  });

  it('every module has href prefixed with /alm (or exactly /alm for overview)', () => {
    for (const mod of ALM_MODULES) {
      expect(
        mod.href === '/alm' || mod.href.startsWith('/alm/'),
        `module ${mod.slug} has invalid href: ${mod.href}`,
      ).toBe(true);
    }
  });

  it('every module has a non-empty bilingual name', () => {
    for (const mod of ALM_MODULES) {
      expect(mod.name.en.length, `${mod.slug} missing en name`).toBeGreaterThan(0);
      expect(mod.name.es.length, `${mod.slug} missing es name`).toBeGreaterThan(0);
    }
  });

  it('every module has a non-empty bilingual description', () => {
    for (const mod of ALM_MODULES) {
      expect(mod.description.en.length, `${mod.slug} missing en desc`).toBeGreaterThan(0);
      expect(mod.description.es.length, `${mod.slug} missing es desc`).toBeGreaterThan(0);
    }
  });

  it('every module belongs to a known category', () => {
    for (const mod of ALM_MODULES) {
      expect(CATEGORY_IDS).toContain(mod.category);
    }
  });

  it('per-institution endpoint templates contain the {id} placeholder', () => {
    // Global endpoints like '/api/alm/usvi/framework' are allowed — they're
    // institution-agnostic. Any endpoint that includes '{id}' MUST be well-
    // formed (surrounded by slashes), and any endpoint starting with the
    // institution-scoped prefix should include {id}.
    for (const mod of ALM_MODULES) {
      if (!mod.endpoint) continue;

      // Well-formedness of the placeholder.
      if (mod.endpoint.includes('{id}')) {
        expect(
          /\/\{id\}(\/|$)/.test(mod.endpoint),
          `${mod.slug} endpoint "${mod.endpoint}" uses {id} but not as a path segment`,
        ).toBe(true);
      }

      // If the path is the institution-scoped pattern `/api/alm/<something>/...`,
      // and `<something>` doesn't match a known global prefix, require {id}.
      const GLOBAL_PREFIXES = ['/api/alm/usvi/'];
      const isGlobal = GLOBAL_PREFIXES.some((p) => mod.endpoint!.startsWith(p));
      if (!isGlobal && mod.endpoint.startsWith('/api/alm/') && !mod.endpoint.includes('{id}')) {
        throw new Error(
          `${mod.slug} endpoint "${mod.endpoint}" looks institution-scoped but has no {id} placeholder`,
        );
      }
    }
  });

  it('tier is one of core | advanced | frontier', () => {
    const validTiers = new Set(['core', 'advanced', 'frontier']);
    for (const mod of ALM_MODULES) {
      expect(validTiers.has(mod.tier), `${mod.slug} has invalid tier ${mod.tier}`).toBe(true);
    }
  });

  it('status is one of ga | beta | alpha', () => {
    const validStatuses = new Set(['ga', 'beta', 'alpha']);
    for (const mod of ALM_MODULES) {
      expect(validStatuses.has(mod.status), `${mod.slug} has invalid status ${mod.status}`).toBe(true);
    }
  });
});

// ─── Derived lookups ────────────────────────────────────────────────────────

describe('derived lookups', () => {
  it('MODULES_BY_SLUG is a bijection with ALM_MODULES', () => {
    expect(Object.keys(MODULES_BY_SLUG).length).toBe(ALM_MODULES.length);
    for (const mod of ALM_MODULES) {
      expect(MODULES_BY_SLUG[mod.slug]).toBe(mod);
    }
  });

  it('MODULES_BY_CATEGORY partitions ALM_MODULES (sum = total)', () => {
    const totalFromCategories = CATEGORY_IDS.reduce(
      (sum, id) => sum + MODULES_BY_CATEGORY[id].length,
      0,
    );
    expect(totalFromCategories).toBe(ALM_MODULES.length);
  });

  it('MODULES_BY_CATEGORY assigns each module to exactly one bucket', () => {
    const seen = new Set<string>();
    for (const id of CATEGORY_IDS) {
      for (const mod of MODULES_BY_CATEGORY[id]) {
        expect(seen.has(mod.slug), `${mod.slug} appears in >1 category`).toBe(false);
        seen.add(mod.slug);
      }
    }
    expect(seen.size).toBe(ALM_MODULES.length);
  });

  it('ALM_CATEGORIES_BY_ID has an entry for every CATEGORY_IDS value', () => {
    for (const id of CATEGORY_IDS) {
      expect(ALM_CATEGORIES_BY_ID[id]).toBeDefined();
      expect(ALM_CATEGORIES_BY_ID[id].id).toBe(id);
    }
  });

  it('ALM_CATEGORIES orders are unique and monotonically increasing', () => {
    const orders = ALM_CATEGORIES.map((c) => c.order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('getAlmModule', () => {
  it('returns the module for a known slug', () => {
    expect(getAlmModule('var')?.slug).toBe('var');
    expect(getAlmModule('cecl')?.name.en).toBe('CECL');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getAlmModule('definitely-not-a-real-module')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getAlmModule('')).toBeUndefined();
  });
});

describe('getModuleName', () => {
  it('returns English name by default', () => {
    expect(getModuleName('var', 'en')).toBe('VaR Suite');
  });

  it('returns Spanish name when locale=es', () => {
    expect(getModuleName('var', 'es')).toBe('Suite VaR');
  });

  it('falls back to full name when shortName is absent and short=true', () => {
    // None of the current modules define a shortName, so short=true should
    // always fall through to full name — this test locks in that contract.
    const mod = ALM_MODULES.find((m) => !m.shortName);
    expect(mod).toBeDefined();
    const shortEn = getModuleName(mod!.slug, 'en', { short: true });
    expect(shortEn).toBe(mod!.name.en);
  });

  it('returns null for unknown slug', () => {
    expect(getModuleName('unknown-slug', 'en')).toBeNull();
  });
});

describe('getAlmModuleFromPathname', () => {
  it('resolves /alm/var to the var module', () => {
    expect(getAlmModuleFromPathname('/alm/var')?.slug).toBe('var');
  });

  it('resolves nested /alm/var/details to the var module', () => {
    expect(getAlmModuleFromPathname('/alm/var/details')?.slug).toBe('var');
  });

  it('resolves /alm/board-report with hyphen slugs', () => {
    expect(getAlmModuleFromPathname('/alm/board-report')?.slug).toBe('board-report');
  });

  it('returns undefined for non-/alm paths', () => {
    expect(getAlmModuleFromPathname('/dashboard')).toBeUndefined();
    expect(getAlmModuleFromPathname('/')).toBeUndefined();
  });

  it('resolves /alm/ (trailing slash) to the overview module', () => {
    expect(getAlmModuleFromPathname('/alm/')?.slug).toBe('overview');
  });

  it('returns undefined for unregistered slugs', () => {
    expect(getAlmModuleFromPathname('/alm/this-does-not-exist')).toBeUndefined();
  });

  it('resolves nested registered hrefs', () => {
    expect(getAlmModuleFromPathname('/alm/agents/alerts')?.slug).toBe('agent-alerts');
  });
});

// ─── Regression: the specific slugs the P0 bug touched ─────────────────────

// ─── Migration tracking ────────────────────────────────────────────────────

describe('MIGRATED_SLUGS', () => {
  it('every migrated slug is a registered module', () => {
    for (const slug of MIGRATED_SLUGS) {
      expect(MODULES_BY_SLUG[slug], `migrated slug "${slug}" is not in ALM_MODULES`).toBeDefined();
    }
  });

  it('MIGRATED_COUNT matches the set size', () => {
    expect(MIGRATED_COUNT).toBe(MIGRATED_SLUGS.size);
  });

  it('MIGRATED_COUNT never exceeds ALM_MODULE_COUNT', () => {
    expect(MIGRATED_COUNT).toBeLessThanOrEqual(ALM_MODULE_COUNT);
  });

  it('isMigrated returns true for a known migrated slug', () => {
    expect(isMigrated('var')).toBe(true);
    expect(isMigrated('cecl')).toBe(true);
    expect(isMigrated('overview')).toBe(true);
    expect(isMigrated('agent-alerts')).toBe(true);
  });

  it('isMigrated returns false for an unmigrated slug', () => {
    // Pick any module NOT in MIGRATED_SLUGS. Use a slug known to be in
    // ALM_MODULES but not yet migrated.
    const unmigrated = ALM_MODULES.find((m) => !MIGRATED_SLUGS.has(m.slug));
    expect(unmigrated, 'expected at least one unmigrated module').toBeDefined();
    if (unmigrated) expect(isMigrated(unmigrated.slug)).toBe(false);
  });

  it('isMigrated returns false for an unknown slug', () => {
    expect(isMigrated('this-is-not-a-real-slug')).toBe(false);
  });
});

describe('P0 regression coverage', () => {
  it('has registry entries for the three modules that leaked raw keys', () => {
    expect(MODULES_BY_SLUG['board-report']).toBeDefined();
    expect(MODULES_BY_SLUG['svensson']).toBeDefined();
    expect(MODULES_BY_SLUG['usvi']).toBeDefined();
  });

  it('has registry entries for reseller (the previously unregistered route)', () => {
    expect(MODULES_BY_SLUG['reseller']).toBeDefined();
  });
});
