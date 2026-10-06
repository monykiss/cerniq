#!/usr/bin/env node
/**
 * verify-i18n-parity.mjs — CI guard for bilingual (es/en) locale parity.
 *
 * CerniQ is a Spanish-first ALM platform for Puerto Rico cooperativas. The
 * translation dictionaries live in `lib/i18n/locales/{en,es}.ts`, both typed
 * against `TranslationKeys`. `tsc` already proves every *key* exists in both
 * locales — but the type system is blind to the failure modes that actually
 * break a bilingual regulated UI:
 *
 *   • An empty / whitespace-only value         (`breach: ''` typechecks)
 *   • An array whose length differs per locale (`string[]` hides 4-vs-3 drift)
 *   • English text leaking into the `es` locale (copy-paste of the `en` value)
 *
 * That last one is the live "Spanish-first accent residual" class of bug. This
 * gate caught three on its first run: scenarioBuilder.{resilient,adequate,
 * critical} all still held their English uppercase strings while risk.critical
 * had already been translated to "Crítico".
 *
 * ── How the "untranslated" check works (D24 ratchet) ─────────────────────────
 * Some es===en collisions are CORRECT: acronyms (NII, LCR, HQLA), brand names
 * (Google, GitHub), proper nouns (Monte Carlo, Black-Litterman), and words
 * spelled identically in both languages (Neutral, Capital, VULNERABLE). Those
 * are enumerated in ALLOWLIST below — that list is the baseline. The gate fails
 * when:
 *   • a NEW es===en collision appears that is not in ALLOWLIST   (regression)
 *   • an ALLOWLIST entry no longer collides                      (stale entry)
 * Translating an allowlisted token is always allowed — just remove its entry
 * and take the credit. The stale detector makes sure you don't forget.
 *
 * Mirrors the discipline of verify-no-silent-catch.mjs / verify-d1-*.mjs.
 *
 * Exit codes:
 *   0 — locales are at parity; allowlist is exact (no new, no stale)
 *   1 — a parity defect or a stale/missing allowlist entry was found
 *
 * Flags:
 *   (none)        scan the real locale files; exit 1 on any defect
 *   --quiet       suppress per-defect detail; print the summary only
 *   --self-test   exercise the checks against embedded fixtures (no file I/O)
 *
 * Wired into `npm run lint` next to verify-alm-registry.mjs. Run standalone via
 * `node scripts/verify-i18n-parity.mjs`.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'lib', 'i18n', 'locales');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const SELF_TEST = argv.includes('--self-test');

// ─── Allowlist (baseline) ────────────────────────────────────────────────────
// es===en collisions that are intentional: acronyms, brand/proper nouns, and
// words spelled identically in Spanish. Locked 2026-06-07: 17 entries.
// Adding a new entry requires a real reason (it is a token, not a translation).
// Removing one when its translation lands is always allowed (and required —
// the stale detector fails CI otherwise).
const ALLOWLIST = new Set([
  'common.neutral', //            "Neutral" — same spelling in es
  'common.google', //             brand
  'common.github', //             brand
  'demo.familyOffice', //         "Family Office" — recognized English term, kept verbatim
  'demo.capital', //              "Capital" — same spelling in es
  'demo.niiLabel', //             "NII" — acronym
  'alm.lcr', //                   "LCR" — acronym
  'alm.hqla', //                  "HQLA" — acronym
  'sidebar.monteCarlo', //        proper noun
  'sidebar.blackLitterman', //    proper noun
  'sidebar.creditMetrics', //     product/proper noun
  'sidebar.kmvMerton', //         proper noun
  'sidebar.frtbIma', //           "FRTB-IMA" — acronym
  'sidebar.capFloor', //          "IR Cap/Floor" — financial jargon kept verbatim
  'sidebar.rbc2', //              "NCUA RBC2" — proper noun
  'sidebar.form5300', //          "NCUA 5300" — form name
  'scenarioBuilder.vulnerable', //"VULNERABLE" — same spelling in es
]);

// ─── Locale loader ───────────────────────────────────────────────────────────
// The locale files are pure data literals (strings, arrays, nested objects) of
// the shape `export const <name>: TranslationKeys = { ... };`. We strip the
// import + the typed-export prefix and evaluate the remaining object literal.
// This is exact for nested arrays/objects (regex parsing is not) and avoids a
// TS loader (the files' value-style `import { TranslationKeys }` would fail
// under runtime type-stripping because the interface is erased).
function loadLocale(file, name) {
  let txt = readFileSync(file, 'utf8');
  txt = txt.replace(/^\s*import[^\n]*\n/gm, '');
  txt = txt.replace(
    new RegExp(`export\\s+const\\s+${name}\\s*:\\s*[A-Za-z0-9_]+\\s*=`),
    'return ',
  );
  const body = txt.trim().replace(/;\s*$/, '').trim();
  const expr = body.replace(/^return\s*/, '');
  if (!expr.startsWith('{')) {
    throw new Error(
      `[i18n-parity] ${name}: could not isolate the object literal (got "${expr.slice(0, 40)}…"). ` +
        `Has the locale file format changed?`,
    );
  }
  if (expr.includes('`')) {
    throw new Error(
      `[i18n-parity] ${name}: template literals are not supported by this gate; ` +
        `use plain quoted strings in locale files.`,
    );
  }
  // eslint-disable-next-line no-new-func -- evaluating our own version-controlled data literal at lint time
  return new Function(`return (${expr});`)();
}

// ─── Parity checks ───────────────────────────────────────────────────────────
// Pure over two locale objects. Returns an array of { type, path, detail }.
// `base` is the reference locale (en), `other` the locale under test (es).
function checkParity(en, es, allowlist) {
  const defects = [];
  const seenCollisions = new Set();

  function walk(a, b, path) {
    const aKeys = Object.keys(a);
    const bKeys = b && typeof b === 'object' ? Object.keys(b) : [];

    for (const k of aKeys) {
      const p = path ? `${path}.${k}` : k;
      const av = a[k];
      if (b == null || !(k in b)) {
        defects.push({ type: 'MISSING_KEY', path: p, detail: 'present in en, missing in es' });
        continue;
      }
      const bv = b[k];

      if (Array.isArray(av)) {
        if (!Array.isArray(bv)) {
          defects.push({ type: 'TYPE_MISMATCH', path: p, detail: 'array in en, non-array in es' });
          continue;
        }
        if (av.length !== bv.length) {
          defects.push({
            type: 'ARRAY_LENGTH',
            path: p,
            detail: `en has ${av.length} item(s), es has ${bv.length}`,
          });
        }
        const n = Math.min(av.length, bv.length);
        for (let i = 0; i < n; i++) {
          checkLeaf(`${p}[${i}]`, av[i], bv[i]);
        }
      } else if (av && typeof av === 'object') {
        if (!bv || typeof bv !== 'object' || Array.isArray(bv)) {
          defects.push({ type: 'TYPE_MISMATCH', path: p, detail: 'object in en, non-object in es' });
          continue;
        }
        walk(av, bv, p);
      } else {
        checkLeaf(p, av, bv);
      }
    }

    // keys present in es but absent in en (reverse parity)
    for (const k of bKeys) {
      if (!(k in a)) {
        const p = path ? `${path}.${k}` : k;
        defects.push({ type: 'EXTRA_KEY', path: p, detail: 'present in es, missing in en' });
      }
    }
  }

  function checkLeaf(p, av, bv) {
    if (typeof av === 'string' && av.trim() === '') {
      defects.push({ type: 'EMPTY_VALUE', path: p, detail: 'en value is empty/whitespace' });
    }
    if (typeof bv === 'string' && bv.trim() === '') {
      defects.push({ type: 'EMPTY_VALUE', path: p, detail: 'es value is empty/whitespace' });
    }
    if (typeof av === 'string' && av === bv) {
      const keyPath = p.replace(/\[\d+\]$/, ''); // array items inherit their key's allowlist entry
      seenCollisions.add(keyPath);
      if (!allowlist.has(keyPath)) {
        defects.push({
          type: 'UNTRANSLATED',
          path: p,
          detail: `es === en (${JSON.stringify(av)}); translate it or add "${keyPath}" to ALLOWLIST with a reason`,
        });
      }
    }
  }

  walk(en, es, '');

  // stale allowlist entries: listed but no longer colliding
  for (const entry of allowlist) {
    if (!seenCollisions.has(entry)) {
      defects.push({
        type: 'STALE_ALLOWLIST',
        path: entry,
        detail: 'allowlisted but es no longer equals en — remove the entry and take the credit',
      });
    }
  }

  return defects;
}

// ─── Self-test ───────────────────────────────────────────────────────────────
function selfTest() {
  let failures = 0;
  const check = (name, cond) => {
    if (!cond) {
      failures++;
      console.error(`  ✗ ${name}`);
    } else if (!QUIET) {
      console.log(`  ✓ ${name}`);
    }
  };

  const cleanEn = {
    common: { ok: 'Save', acro: 'LCR', steps: ['one', 'two'] },
  };
  const cleanEs = {
    common: { ok: 'Guardar', acro: 'LCR', steps: ['uno', 'dos'] },
  };
  const cleanAllow = new Set(['common.acro']);
  check('clean pair → no defects', checkParity(cleanEn, cleanEs, cleanAllow).length === 0);

  // untranslated leak
  const leakEs = { common: { ok: 'Save', acro: 'LCR', steps: ['uno', 'dos'] } };
  const leak = checkParity(cleanEn, leakEs, cleanAllow);
  check('untranslated leak → UNTRANSLATED', leak.some((d) => d.type === 'UNTRANSLATED' && d.path === 'common.ok'));
  check('untranslated leak → only that defect', leak.length === 1);

  // empty value
  const emptyEs = { common: { ok: '   ', acro: 'LCR', steps: ['uno', 'dos'] } };
  check('whitespace value → EMPTY_VALUE', checkParity(cleanEn, emptyEs, cleanAllow).some((d) => d.type === 'EMPTY_VALUE'));

  // array length drift
  const shortEs = { common: { ok: 'Guardar', acro: 'LCR', steps: ['uno'] } };
  check('array length drift → ARRAY_LENGTH', checkParity(cleanEn, shortEs, cleanAllow).some((d) => d.type === 'ARRAY_LENGTH'));

  // array-item untranslated leak
  const itemLeakEs = { common: { ok: 'Guardar', acro: 'LCR', steps: ['one', 'dos'] } };
  check('array item leak → UNTRANSLATED', checkParity(cleanEn, itemLeakEs, cleanAllow).some((d) => d.type === 'UNTRANSLATED' && d.path === 'common.steps[0]'));

  // missing / extra keys
  const missingEs = { common: { acro: 'LCR', steps: ['uno', 'dos'] } };
  check('missing key → MISSING_KEY', checkParity(cleanEn, missingEs, cleanAllow).some((d) => d.type === 'MISSING_KEY' && d.path === 'common.ok'));
  const extraEs = { common: { ok: 'Guardar', acro: 'LCR', steps: ['uno', 'dos'], bonus: 'x' } };
  check('extra key → EXTRA_KEY', checkParity(cleanEn, extraEs, cleanAllow).some((d) => d.type === 'EXTRA_KEY' && d.path === 'common.bonus'));

  // stale allowlist entry
  check('stale allowlist → STALE_ALLOWLIST', checkParity(cleanEn, cleanEs, new Set(['common.acro', 'common.ok'])).some((d) => d.type === 'STALE_ALLOWLIST' && d.path === 'common.ok'));

  // type mismatch
  const typeEs = { common: { ok: 'Guardar', acro: 'LCR', steps: 'no-array' } };
  check('type mismatch → TYPE_MISMATCH', checkParity(cleanEn, typeEs, cleanAllow).some((d) => d.type === 'TYPE_MISMATCH'));

  if (failures > 0) {
    console.error(`\n[i18n-parity] self-test FAILED (${failures} case(s))`);
    process.exit(1);
  }
  console.log('\n[i18n-parity] self-test passed (11 cases)');
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const en = loadLocale(join(LOCALES_DIR, 'en.ts'), 'en');
  const es = loadLocale(join(LOCALES_DIR, 'es.ts'), 'es');
  const defects = checkParity(en, es, ALLOWLIST);

  if (defects.length === 0) {
    console.log(`[i18n-parity] OK — en/es at parity; ${ALLOWLIST.size} allowlisted token(s), all live.`);
    process.exit(0);
  }

  if (!QUIET) {
    for (const d of defects) {
      console.error(`  ✗ [${d.type}] ${d.path} — ${d.detail}`);
    }
    console.error('');
  }
  console.error(`[i18n-parity] FAIL — ${defects.length} defect(s) across en/es locales.`);
  process.exit(1);
}

if (SELF_TEST) {
  selfTest();
} else {
  main();
}
