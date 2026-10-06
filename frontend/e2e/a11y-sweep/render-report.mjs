#!/usr/bin/env node
/**
 * Render the latest a11y sweep run as a human-readable Markdown report.
 *
 * Input:  e2e/a11y-sweep/results/latest.json
 * Output: e2e/a11y-sweep/results/latest.md  (+ stdout)
 *
 * Used by the CI workflow to post a summary to the PR, and locally for
 * triaging "which route do I fix next?"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LATEST = join(__dirname, 'results', 'latest.json');
const LATEST_AUTHED = join(__dirname, 'results', 'latest-authed.json');
const OUT = join(__dirname, 'results', 'latest.md');

if (!existsSync(LATEST)) {
  console.error('results/latest.json not found — run `npm run a11y:sweep` first');
  process.exit(1);
}

const run = JSON.parse(readFileSync(LATEST, 'utf8'));

// Merge authed results IF they exist AND were produced in the same run window.
// We treat the authed file as fresh only if its generatedAt is within 30 min
// of the public file's generatedAt — otherwise it's a stale leftover from a
// prior full run and would produce a misleading report.
const STALE_WINDOW_MS = 30 * 60 * 1000;
let authedStatus = 'not present';
if (existsSync(LATEST_AUTHED)) {
  try {
    const authed = JSON.parse(readFileSync(LATEST_AUTHED, 'utf8'));
    const delta = Math.abs(
      new Date(authed.generatedAt).getTime() - new Date(run.generatedAt).getTime(),
    );
    if (Number.isNaN(delta)) {
      authedStatus = 'skipped (timestamp unparseable)';
    } else if (delta > STALE_WINDOW_MS) {
      const min = Math.round(delta / 60000);
      authedStatus = `skipped (authed file is ${min} min older than public — stale)`;
    } else {
      run.results.push(...authed.results);
      run.totalRoutes += authed.totalRoutes;
      run.totalViolations += authed.totalViolations;
      for (const [k, v] of Object.entries(authed.byImpact || {})) {
        run.byImpact[k] = (run.byImpact[k] || 0) + v;
      }
      authedStatus = `merged (${authed.totalRoutes} authed routes, ${authed.totalViolations} violations)`;
    }
  } catch (err) {
    authedStatus = `skipped (parse error: ${err.message})`;
  }
}

function emoji(impact) {
  return (
    {
      critical: '🔴',
      serious: '🟠',
      moderate: '🟡',
      minor: '🔵',
    }[impact] || '⚪'
  );
}

const byRule = new Map();
for (const r of run.results) {
  for (const v of r.violations) {
    const prev = byRule.get(v.id) ?? { id: v.id, help: v.help, impact: v.impact, helpUrl: v.helpUrl, nodes: 0, routes: new Set() };
    prev.nodes += v.nodeCount;
    prev.routes.add(r.route);
    byRule.set(v.id, prev);
  }
}
const topRules = [...byRule.values()]
  .sort((a, b) => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    return (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.nodes - a.nodes;
  })
  .slice(0, 25);

const worstRoutes = [...run.results]
  .map((r) => ({
    route: r.route,
    blocking: r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length,
    total: r.violations.length,
  }))
  .filter((r) => r.total > 0)
  .sort((a, b) => b.blocking - a.blocking || b.total - a.total)
  .slice(0, 25);

const lines = [];
lines.push(`# CERNIQ a11y sweep — ${run.generatedAt}`);
lines.push('');
lines.push(`**Routes swept:** ${run.totalRoutes}`);
lines.push(`**Total violations:** ${run.totalViolations}`);
lines.push(`**Authed sweep:** ${authedStatus}`);
lines.push(
  `**By impact:** ${Object.entries(run.byImpact)
    .map(([k, v]) => `${emoji(k)} ${k}: ${v}`)
    .join(' · ') || 'none'}`,
);
lines.push('');

lines.push('## Top 25 rules (grouped)');
lines.push('');
lines.push('| Impact | Rule | Nodes | Routes | Help |');
lines.push('|---|---|---:|---:|---|');
for (const r of topRules) {
  lines.push(
    `| ${emoji(r.impact)} ${r.impact ?? '—'} | \`${r.id}\` | ${r.nodes} | ${r.routes.size} | [${r.help}](${r.helpUrl}) |`,
  );
}
lines.push('');

lines.push('## Worst 25 routes');
lines.push('');
lines.push('| Route | Blocking (crit+serious) | Total |');
lines.push('|---|---:|---:|');
for (const r of worstRoutes) {
  lines.push(`| ${r.route} | ${r.blocking} | ${r.total} |`);
}
lines.push('');

lines.push('## Fix order suggestion');
lines.push('');
lines.push('Work top-down on the **rule** table — fixing a single rule often');
lines.push('resolves violations on dozens of routes at once (shared components).');
lines.push('Only drop to the route table when you\'re hunting page-specific issues.');
lines.push('');
lines.push('To lock the current state as the new baseline after triaging:');
lines.push('');
lines.push('```bash');
lines.push('npm run a11y:baseline');
lines.push('```');

const out = lines.join('\n');
writeFileSync(OUT, out);
console.log(out);
