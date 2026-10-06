#!/usr/bin/env node
/**
 * verify-bundle-budget — D24 ratchet on Next.js first-load JS size.
 *
 * Reads .next/diagnostics/route-bundle-stats.json (emitted by `next build`
 * in Next.js 16+) and enforces two budgets:
 *
 *   MAX_ROUTE_BYTES   — ceiling on any single route's first-load JS.
 *                       Locks against "one fat new dep landed in a hot page".
 *   TOTAL_BYTES       — ceiling on summed first-load JS across all routes.
 *                       Multi-counts shared chunks; coarse signal for
 *                       "shared bundle bloat crept everywhere".
 *
 * Ratchet discipline: when a build measures comfortably under a budget,
 * LOWER the budget here. Never raise without an explicit decision
 * (and a SESSION_HANDOFF entry naming the reason).
 *
 * Mirror of backend's verify-tenant-scope / verify-no-orphan-spec pattern:
 * one focused gate, hand-rolled (no dep), with --self-test fixtures.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(__dirname, '..');
const STATS_PATH = resolve(FRONTEND_ROOT, '.next/diagnostics/route-bundle-stats.json');

// ---- Budgets (D24 — ratchet DOWN only) ----
// Measured 2026-05-16 against /Users/money/Desktop/Cerniq/frontend/.next:
//   171 routes, max=/alm/liquidity 1,304,105 B, total=161,355,597 B
// Locked at integer-above-measured (~0.5% headroom) so the gate fails on
// any meaningful regression but tolerates routine chunk-shuffle.
const MAX_ROUTE_BYTES = 1_310_720;    //  1.25 MiB — single-route ceiling
const TOTAL_BYTES     = 162_000_000;  // ~154.5 MB — summed first-load ceiling

const ANSI = {
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
  dim:   (s) => `\x1b[2m${s}\x1b[0m`,
};

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

/**
 * Audit a stats array against the budgets. Returns
 * { violations: string[], summary: { routes, maxRoute, maxBytes, total } }.
 * Pure — no I/O, no process.exit. Used by both main() and self-tests.
 */
function audit(stats) {
  if (!Array.isArray(stats)) {
    return {
      violations: ['route-bundle-stats.json is not an array'],
      summary: null,
    };
  }
  if (stats.length === 0) {
    return {
      violations: ['route-bundle-stats.json is empty (build produced 0 routes)'],
      summary: null,
    };
  }
  let total = 0;
  let maxRoute = null;
  const overMax = [];
  for (const r of stats) {
    if (typeof r?.firstLoadUncompressedJsBytes !== 'number' || typeof r?.route !== 'string') {
      return {
        violations: [`malformed entry: ${JSON.stringify(r).slice(0, 120)}`],
        summary: null,
      };
    }
    total += r.firstLoadUncompressedJsBytes;
    if (!maxRoute || r.firstLoadUncompressedJsBytes > maxRoute.firstLoadUncompressedJsBytes) {
      maxRoute = r;
    }
    if (r.firstLoadUncompressedJsBytes > MAX_ROUTE_BYTES) {
      overMax.push(r);
    }
  }
  const violations = [];
  for (const r of overMax) {
    violations.push(
      `route ${r.route}: ${fmtBytes(r.firstLoadUncompressedJsBytes)} > MAX_ROUTE_BYTES ${fmtBytes(MAX_ROUTE_BYTES)} ` +
      `(over by ${fmtBytes(r.firstLoadUncompressedJsBytes - MAX_ROUTE_BYTES)})`,
    );
  }
  if (total > TOTAL_BYTES) {
    violations.push(
      `summed first-load: ${fmtBytes(total)} > TOTAL_BYTES ${fmtBytes(TOTAL_BYTES)} ` +
      `(over by ${fmtBytes(total - TOTAL_BYTES)})`,
    );
  }
  return {
    violations,
    summary: { routes: stats.length, maxRoute, maxBytes: maxRoute.firstLoadUncompressedJsBytes, total },
  };
}

function selfTest() {
  const cases = [
    {
      name: 'empty array fails',
      stats: [],
      expectViolations: 1,
    },
    {
      name: 'non-array fails',
      stats: null,
      expectViolations: 1,
    },
    {
      name: 'malformed entry fails',
      stats: [{ route: '/x' }],
      expectViolations: 1,
    },
    {
      name: 'one route under budget passes',
      stats: [{ route: '/a', firstLoadUncompressedJsBytes: 500_000 }],
      expectViolations: 0,
    },
    {
      name: 'one route over MAX_ROUTE_BYTES fails',
      stats: [{ route: '/big', firstLoadUncompressedJsBytes: MAX_ROUTE_BYTES + 1 }],
      expectViolations: 1,
    },
    {
      // Build 200 routes at half-MAX each — each is fine individually,
      // sum exceeds TOTAL_BYTES. Surfaces the TOTAL rule in isolation.
      name: 'many small routes summing over TOTAL_BYTES surfaces total alone',
      stats: Array.from({ length: 300 }, (_, i) => ({
        route: `/r${i}`,
        firstLoadUncompressedJsBytes: Math.floor(MAX_ROUTE_BYTES / 2),
      })),
      expectViolations: 1, // total only — no per-route over MAX
    },
    {
      // Two fat + many tiny: per-route trips twice, total stays under.
      name: 'two over MAX with total under surfaces only the two route violations',
      stats: [
        { route: '/x', firstLoadUncompressedJsBytes: MAX_ROUTE_BYTES + 1 },
        { route: '/y', firstLoadUncompressedJsBytes: MAX_ROUTE_BYTES + 2 },
        { route: '/z', firstLoadUncompressedJsBytes: 100_000 },
      ],
      expectViolations: 2,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = audit(c.stats).violations.length;
    if (got !== c.expectViolations) {
      console.error(ANSI.red(`✗ ${c.name}: expected ${c.expectViolations} violations, got ${got}`));
      failed += 1;
    } else {
      console.log(ANSI.green(`✓ ${c.name}`));
    }
  }
  if (failed > 0) {
    console.error(ANSI.red(`\n${failed}/${cases.length} self-test cases failed.`));
    process.exit(1);
  }
  console.log(ANSI.green(`\n${cases.length}/${cases.length} self-test cases passed.`));
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  if (!existsSync(STATS_PATH)) {
    console.error(ANSI.red('✗ route-bundle-stats.json not found'));
    console.error(ANSI.dim(`  expected at: ${STATS_PATH}`));
    console.error(ANSI.dim('  run `npm run build` first (Next.js 16+ emits this)'));
    process.exit(1);
  }
  let stats;
  try {
    stats = JSON.parse(readFileSync(STATS_PATH, 'utf8'));
  } catch (e) {
    console.error(ANSI.red(`✗ failed to parse ${STATS_PATH}: ${e.message}`));
    process.exit(1);
  }
  const { violations, summary } = audit(stats);
  if (violations.length > 0) {
    console.error(ANSI.red(ANSI.bold('✗ bundle-budget violations:')));
    for (const v of violations) console.error('  ' + v);
    console.error('');
    console.error(ANSI.dim('  Either:'));
    console.error(ANSI.dim('    (a) shrink the bundle (dynamic import, dep diet, code-split), then re-run'));
    console.error(ANSI.dim('    (b) raise the budget in scripts/verify-bundle-budget.mjs WITH a SESSION_HANDOFF entry'));
    console.error(ANSI.dim('        naming the reason — never silently loosen'));
    process.exit(1);
  }
  console.log(
    ANSI.green('✓') + ` ${summary.routes} routes within budget — ` +
    `max ${ANSI.bold(summary.maxRoute.route)} ${fmtBytes(summary.maxBytes)} ≤ ${fmtBytes(MAX_ROUTE_BYTES)}, ` +
    `total ${fmtBytes(summary.total)} ≤ ${fmtBytes(TOTAL_BYTES)}`,
  );
  // Ratchet-down hint: if we're more than 5% below either ceiling, suggest lowering it.
  const maxHeadroom = (MAX_ROUTE_BYTES - summary.maxBytes) / MAX_ROUTE_BYTES;
  const totalHeadroom = (TOTAL_BYTES - summary.total) / TOTAL_BYTES;
  if (maxHeadroom > 0.05 || totalHeadroom > 0.05) {
    console.log(
      ANSI.dim(
        `  hint: budget has ${(Math.max(maxHeadroom, totalHeadroom) * 100).toFixed(1)}% headroom — ` +
        'consider ratcheting the ceiling DOWN to lock the gain.',
      ),
    );
  }
}

main();
