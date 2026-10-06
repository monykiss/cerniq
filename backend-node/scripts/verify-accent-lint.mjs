#!/usr/bin/env node
/**
 * verify-accent-lint.mjs — CI guard for Spanish-first accent correctness.
 *
 * CerniQ is a Spanish-first ALM platform for Puerto Rico cooperativas. Customer-
 * and examiner-facing Spanish text (COSSEC report PDFs, ALCO board packs, exam-
 * prep labels) must be spelled with its accents — "Razón de Liquidez", not
 * "Razon de Liquidez". A missing accent on a regulated-report label is a small
 * but real credibility defect, and a recurring one: the 2026-06-07 accent sweep
 * (`fc81493` ES-1/4/5) fixed several by hand and explicitly deferred the larger
 * `src/pipeline` PDF generators "to an accent-lint ratchet" — this is it.
 *
 * ── HONEST SCOPE (what we DO and do NOT scan) ────────────────────────────────
 * The same bare token is a BUG in a display label but a STABLE KEY elsewhere:
 *   • t('Credito', 'Credit')                         ← display label, BUG
 *   • name: 'Cooperativa de Ahorro y Credito ...'    ← institution name / match key, LEAVE
 *   • normalize('...Credito ACACIA')                 ← name-matching test, LEAVE
 * So this gate scans ONLY two proven Spanish-display contexts and nothing else —
 * every hit is a true positive, no data key is ever touched:
 *   (1) the FIRST argument of a `t(<es>, <en>)` bilingual-helper call
 *       (the dominant pattern in src/pipeline + report builders)
 *   (2) the value of any `*Es:` object key  (nameEs / labelEs / descriptionEs …)
 * It does NOT scan arbitrary string literals, identifiers, or comments.
 *
 * Detection is a curated dictionary of high-frequency Spanish financial/UI terms
 * whose bare (unaccented) singular form is unambiguous — not an English word and
 * not a valid unaccented Spanish word. Plurals that legitimately drop the accent
 * (interés→intereses, razón→razones) do NOT match the singular bare form, so
 * they are correctly ignored.
 *
 * ── D24 ratchet ──────────────────────────────────────────────────────────────
 * Count-based per file (mirrors verify-no-silent-catch / verify-rule-11): a file
 * fails if its accent-defect count EXCEEDS its baseline or it is a NEW file with
 * any defect. Fixing a file below baseline is always allowed; driving it to 0
 * makes its baseline entry stale (remove it, take the credit — the stale
 * detector fails CI if you forget).
 *
 * Exit codes:
 *   0 — every scanned file is clean or at/under baseline; no stale entries
 *   1 — a new/grown defect appeared, or a baseline entry is stale
 *
 * Flags:
 *   (none)        scan src/ ; exit 1 on any new/grown defect or stale entry
 *   --quiet       suppress per-defect detail; summary only
 *   --report      list every defect ignoring the baseline (calibration aid)
 *   --self-test   exercise the checks against embedded fixtures (no src I/O)
 *
 * Wired into `npm run lint`. Run standalone via `node scripts/verify-accent-lint.mjs`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const REPORT = argv.includes('--report');
const SELF_TEST = argv.includes('--self-test');

// ─── Dictionary: bare (wrong) → accented (right) ─────────────────────────────
// High-confidence: each bare singular is not English and not valid unaccented
// Spanish. Keep additions conservative (verbs like "calculo"/"numero" exist, but
// in a display-label context they are the nouns Cálculo/Número).
const ACCENTS = {
  Razon: 'Razón',
  Prestamo: 'Préstamo',
  Prestamos: 'Préstamos',
  Deposito: 'Depósito',
  Depositos: 'Depósitos',
  Interes: 'Interés',
  Duracion: 'Duración',
  Analisis: 'Análisis',
  Credito: 'Crédito',
  Creditos: 'Créditos',
  Gestion: 'Gestión',
  Posicion: 'Posición',
  Proyeccion: 'Proyección',
  Simulacion: 'Simulación',
  Evaluacion: 'Evaluación',
  Concentracion: 'Concentración',
  Calculo: 'Cálculo',
  Metodo: 'Método',
  Informacion: 'Información',
  Liquidacion: 'Liquidación',
  Migracion: 'Migración',
  Optimizacion: 'Optimización',
  Atribucion: 'Atribución',
  Comparacion: 'Comparación',
  Distribucion: 'Distribución',
  Asignacion: 'Asignación',
  Proteccion: 'Protección',
  Ejecucion: 'Ejecución',
  Validacion: 'Validación',
  Configuracion: 'Configuración',
  Notificacion: 'Notificación',
  Linea: 'Línea',
  Lineas: 'Líneas',
  Dias: 'Días',
  Region: 'Región',
  // Second wave (2026-06-07): high-frequency terms surfaced by the first scan.
  // Each bare form is unambiguous in a Spanish display context (the gate's
  // scope) — not a valid unaccented Spanish word. "Provision"/"Region" are
  // English words too, but the gate only reads *Es:/t()-es contexts where the
  // Spanish form is the intended one, so the English `name:` field is untouched.
  Provision: 'Provisión',
  Compensacion: 'Compensación',
  Vehiculo: 'Vehículo',
  Vehiculos: 'Vehículos',
  Institucion: 'Institución',
  Exposicion: 'Exposición',
  Deteccion: 'Detección',
  Recuperacion: 'Recuperación',
  Depreciacion: 'Depreciación',
  Documentacion: 'Documentación',
  Verificacion: 'Verificación',
  Aprobacion: 'Aprobación',
  Operacion: 'Operación',
  Transaccion: 'Transacción',
  Reduccion: 'Reducción',
  Conexion: 'Conexión',
  Comision: 'Comisión',
  Adecuacion: 'Adecuación',
  Economico: 'Económico',
  Economica: 'Económica',
  Estandar: 'Estándar',
  Metrica: 'Métrica',
  Metricas: 'Métricas',
  Guia: 'Guía',
  Guias: 'Guías',
  Liquidos: 'Líquidos',
  Estres: 'Estrés',
  Anomalia: 'Anomalía',
  Anomalias: 'Anomalías',
  Publicos: 'Públicos',
  Automaticamente: 'Automáticamente',
  Despues: 'Después',
  Huracan: 'Huracán',
  Recesion: 'Recesión',
  Garantia: 'Garantía',
  Tasacion: 'Tasación',
  Categoria: 'Categoría',
  Categorias: 'Categorías',
  Limites: 'Límites',
  Ultimo: 'Último',
  Ultima: 'Última',
  Ultimos: 'Últimos',
  Ultimas: 'Últimas',
  Exportacion: 'Exportación',
  Investigacion: 'Investigación',
};

// Build one case-insensitive whole-word matcher per bare form.
const MATCHERS = Object.keys(ACCENTS).map((bare) => ({
  bare,
  accented: ACCENTS[bare],
  re: new RegExp(`(^|[^\\p{L}])${bare}(?=[^\\p{L}]|$)`, 'giu'),
}));

// ─── Baseline (files with known, not-yet-fixed defects) ──────────────────────
// Locked 2026-06-07. Each entry: relPath → defect count. The big untested PDF
// generator src/pipeline/pipeline.worker.ts is baselined for a focused,
// render-reviewed pass; everything else was driven to 0 in this landing.
const BASELINE = {
  // Remaining offenders after the 2026-06-07 cleanup landings. Counts reflect
  // the expanded 73-term dictionary. Two classes left, both deferred:
  //   • Large/untested customer-PDF generators (pipeline.worker, alco-pack)
  //     — need a render-reviewed pass (ES-2/ES-3).
  //   • Files that also carry ñ-tildes / contextually-risky words (más, está)
  //     the accent dictionary deliberately can't enforce (portal, evidence-package, lgd-table) — need manual proofreading.
  // ncua-field-mapper, capital-adequacy, csv-ingestion, compliance-calendar,
  // and credit-risk-portfolio were driven to 0 and removed from this list.
  'pipeline/pipeline.worker.ts': 100,
  'pipeline/alco-pack.service.ts': 18,
  'exam-prep/evidence-package.service.ts': 11,
  'alm/quant/credit/lgd-table.ts': 8,
  'portal/portal.controller.ts': 7,
};

// ─── Comment stripper (keeps string literals; drops // and /* */) ────────────
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += c2 ?? '';
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ─── Extract Spanish display strings from the two in-scope contexts ──────────
// Returns [{ text, kind }] where kind is 't-arg' | 'es-key'.
const T_ARG = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const ES_KEY = /\b[a-zA-Z_$][\w$]*Es\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

function extractSpanish(src) {
  const found = [];
  let m;
  T_ARG.lastIndex = 0;
  while ((m = T_ARG.exec(src)) !== null)
    found.push({ text: m[2], kind: 't-arg' });
  ES_KEY.lastIndex = 0;
  while ((m = ES_KEY.exec(src)) !== null)
    found.push({ text: m[2], kind: 'es-key' });
  return found;
}

// ─── Defect scan over one file's source ──────────────────────────────────────
// Pure over source text. Returns [{ bare, accented, kind, snippet }].
function scanSource(src) {
  const clean = stripComments(src);
  const strings = extractSpanish(clean);
  const defects = [];
  for (const { text, kind } of strings) {
    for (const { bare, accented, re } of MATCHERS) {
      re.lastIndex = 0;
      if (re.test(text)) {
        defects.push({
          bare,
          accented,
          kind,
          snippet: text.length > 60 ? text.slice(0, 60) + '…' : text,
        });
      }
    }
  }
  return defects;
}

// ─── File walk ───────────────────────────────────────────────────────────────
function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git')
        continue;
      walk(p, acc);
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      acc.push(p);
    }
  }
  return acc;
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

  check(
    't-arg bare form → defect',
    scanSource(`t('Razon de Liquidez', 'Liquidity Ratio')`).some(
      (d) => d.bare === 'Razon',
    ),
  );
  check(
    'es-key bare form → defect',
    scanSource(`labelEs: 'Margen de Interes Neto',`).some(
      (d) => d.bare === 'Interes',
    ),
  );
  check(
    'accented label → clean',
    scanSource(`t('Razón de Liquidez', 'Liquidity Ratio')`).length === 0,
  );
  check(
    'english 2nd arg ignored',
    scanSource(`t('Razón', 'Region')`).length === 0,
  ); // "Region" only flagged in es-context, here it is the EN arg → not scanned
  check(
    'plural that drops accent ignored (intereses)',
    scanSource(`t('Intereses devengados', 'Accrued interest')`).length === 0,
  );
  check(
    'data key NOT scanned',
    scanSource(`name: 'Cooperativa de Ahorro y Credito Ejemplo Este'`).length === 0,
  );
  check(
    'normalize() arg NOT scanned',
    scanSource(`normalize('Credito ACACIA')`).length === 0,
  );
  check(
    'commented t() ignored',
    scanSource(`// t('Razon', 'Ratio')`).length === 0,
  );
  check(
    'multiple defects in one string',
    scanSource(`t('Razon de Prestamos', 'x')`).length === 2,
  );
  check(
    'whole-word: miRazon not matched',
    scanSource(`t('miRazonable', 'x')`).length === 0,
  );
  check(
    'lineas plural flagged',
    scanSource(`t('Lineas de Credito', 'Lines of Credit')`).length === 2,
  );

  // baseline classifier: a baselined file at count stays OK, growth fails
  const classify = (count, baseline) => {
    if (baseline === undefined) return count > 0 ? 'violation-new' : 'clean';
    return count > baseline ? 'violation-grew' : 'baselined';
  };
  check(
    'classify: new file w/ defect → violation',
    classify(2, undefined) === 'violation-new',
  );
  check('classify: at baseline → baselined', classify(3, 3) === 'baselined');
  check(
    'classify: grew past baseline → violation',
    classify(4, 3) === 'violation-grew',
  );

  const total = 14;
  if (failures > 0) {
    console.error(
      `\n[accent-lint] self-test: ${total - failures}/${total} case(s) pass — FAILED`,
    );
    process.exit(1);
  }
  console.log(`\n[accent-lint] self-test: ${total}/${total} case(s) pass`);
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const files = walk(SRC_ROOT, []);
  const violations = [];
  const baselineHits = new Set();
  let cleanCount = 0;
  let baselinedCount = 0;
  const reportRows = [];

  for (const abs of files) {
    const rel = relative(SRC_ROOT, abs).split('\\').join('/'); // 'alm/...'
    const defects = scanSource(readFileSync(abs, 'utf8'));
    if (defects.length === 0) {
      cleanCount++;
      continue;
    }
    if (REPORT) {
      for (const d of defects) reportRows.push({ rel, ...d });
    }
    const baseline = BASELINE[rel];
    if (baseline === undefined) {
      violations.push({
        rel,
        count: defects.length,
        baseline: 0,
        reason: 'new file',
        defects,
      });
    } else {
      baselineHits.add(rel);
      if (defects.length > baseline) {
        violations.push({
          rel,
          count: defects.length,
          baseline,
          reason: 'grew past baseline',
          defects,
        });
      } else {
        baselinedCount++;
      }
    }
  }

  const stale = Object.keys(BASELINE).filter((k) => !baselineHits.has(k));

  if (REPORT) {
    for (const r of reportRows) {
      console.log(
        `  ${r.rel} [${r.kind}] ${r.bare} → ${r.accented}   "${r.snippet}"`,
      );
    }
    console.log(
      `\n[accent-lint] --report: ${reportRows.length} defect(s) across ${new Set(reportRows.map((r) => r.rel)).size} file(s).`,
    );
    process.exit(0);
  }

  if (violations.length === 0 && stale.length === 0) {
    console.log(
      `[accent-lint] OK — ${files.length} src file(s) scanned · ${cleanCount} clean · ${baselinedCount} baselined · 0 new defect(s).`,
    );
    process.exit(0);
  }

  if (!QUIET) {
    for (const v of violations) {
      console.error(
        `  ✗ ${v.rel} — ${v.count} accent defect(s) (${v.reason}, baseline ${v.baseline})`,
      );
      for (const d of v.defects.slice(0, 6)) {
        console.error(
          `       ${d.bare} → ${d.accented}   [${d.kind}] "${d.snippet}"`,
        );
      }
    }
    for (const s of stale) {
      console.error(
        `  ✗ STALE BASELINE: ${s} — no defects found; remove it from BASELINE and take the credit.`,
      );
    }
    console.error('');
  }
  console.error(
    `[accent-lint] FAIL — ${violations.length} violation(s), ${stale.length} stale baseline entr(y/ies).`,
  );
  process.exit(1);
}

if (SELF_TEST) {
  selfTest();
} else {
  main();
}
