// verify:no-orphan-spec-skip — tests nest-cli.json BUILD CONFIG, not a
// source module, so it has no co-located .ts sibling by construction.
// It guards a defect that exists only in dist/, which is why it asserts
// the config rather than the loader.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Guards the "runtime JSON never reached dist" bug class.
 *
 * On 2026-08-18 `POST /api/alm/institutions/seed` returned a 500 in the built
 * app — "Unknown institution fixture pr-cooperativa-demo. Available:
 * pr-cooperativa-san-juan-federal" — for every one of the four fixture keys
 * the frontend actually sends. The four fixtures are plain .json files that
 * `loadAllFixtures()` reads at runtime, and `nest-cli.json` only copied
 * `alm/data/registry/**` into dist. So the deployed backend shipped with the
 * fixtures missing and demo/onboarding seeding was broken.
 *
 * NO UNIT TEST OF THE LOADER CAN CATCH THIS: jest resolves from `src`, where
 * the files are always present. The defect only exists in `dist`. So this test
 * asserts the BUILD CONFIG covers the directory, which is checkable without a
 * build and fails the moment a new runtime-JSON directory is added without an
 * assets rule.
 */
const BACKEND_ROOT = resolve(__dirname, '../../../..');

interface AssetRule {
  include?: string;
  outDir?: string;
}

function assetRules(): AssetRule[] {
  const cfg = JSON.parse(
    readFileSync(join(BACKEND_ROOT, 'nest-cli.json'), 'utf8'),
  ) as { compilerOptions?: { assets?: AssetRule[] } };
  return cfg.compilerOptions?.assets ?? [];
}

describe('runtime JSON assets are copied into dist', () => {
  it('this directory actually contains runtime-loaded .json fixtures', () => {
    const jsons = readdirSync(__dirname).filter((f) => f.endsWith('.json'));
    // If this ever hits zero the guard below is vacuous, so assert the premise.
    expect(jsons.length).toBeGreaterThan(0);
  });

  it('nest-cli.json copies alm/data/fixtures/**/*.json into dist/src', () => {
    const rules = assetRules();
    const covered = rules.some(
      (r) =>
        typeof r.include === 'string' &&
        r.include.includes('alm/data/fixtures') &&
        r.include.endsWith('.json') &&
        r.outDir === 'dist/src',
    );
    expect(covered).toBe(true);
  });

  it('every asset rule targets dist/src, not dist', () => {
    // `outDir: "dist"` puts assets one level above where the compiled code
    // resolves them — the documented boot-failure trap in this repo.
    for (const rule of assetRules()) {
      expect(rule.outDir).toBe('dist/src');
    }
  });

  it('each frontend-referenced fixture key exists as a file here', () => {
    // These four keys are hard-coded in the frontend api client's
    // seedDemoInstitution() type->fixture map. A rename on either side breaks
    // seeding with a 500, so pin them.
    const present = new Set(
      readdirSync(__dirname)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, '')),
    );
    for (const key of [
      'pr-cooperativa-demo',
      'pr-bank-demo',
      'pr-credit-union-demo',
      'pr-family-office-demo',
    ]) {
      expect(present.has(key)).toBe(true);
    }
  });
});
