#!/usr/bin/env ts-node
/**
 * CLI: SIC 2026 — "Global Restructuring" demo.
 *
 * Runs the offline, deterministic demo harness against the dynamically-built
 * "Cooperativa San Juan Federal" and prints the model-derived headline for the
 * live Mauldin call — baseline → stressed capital ratio vs the COSSEC floor.
 *
 * Usage:
 *   npm run demo:sic                 # formatted bilingual report
 *   npm run demo:sic -- --json       # full machine-readable result
 *   npm run demo:sic -- --html       # print-ready HTML one-pager (sic-demo.html)
 *   npm run demo:sic -- --html=/tmp/sic.html
 *   npm run demo:sic -- --backtest   # SR 11-7 model backtest (calibration vs theory)
 *   npm run demo:sic -- --paths=20000
 *
 * No database, no Nest bootstrap — the harness serves the institution from an
 * in-memory fixture and runs the real ALM engines against it.
 */
import { writeFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import {
  SicDemoService,
  SicDemoResult,
} from '../src/alm/demo/sic-demo.service';
import { renderSicDemoHtml } from '../src/alm/demo/sic-demo-report';
import { backtestProjectionCalibration } from '../src/alm/demo/capital-ratio-backtest';

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}
function usd(n: number): string {
  return `$${n.toFixed(2)}M`;
}

function printReport(r: SicDemoResult): void {
  const line = '─'.repeat(72);
  console.log(line);
  console.log(`  ${r.generatedFor}`);
  console.log(
    `  ${r.institution.name} · ${usd(r.institution.totalAssets)} · ${r.institution.regulator} · as of ${r.institution.reportingDate}`,
  );
  console.log(line);

  console.log('\n  BASELINE');
  console.log(
    `    Capital ratio (leverage):   ${pct(r.baseline.capitalRatioPct)}`,
  );
  if (r.baseline.capitalRatioRWAPct != null) {
    console.log(
      `    Capital ratio (RWA, statutory): ${pct(r.baseline.capitalRatioRWAPct)}`,
    );
  }
  console.log(`    Net worth / equity:          ${usd(r.baseline.equity)}`);
  console.log(`    NIM:                          ${pct(r.baseline.nim)}`);
  console.log(
    `    COSSEC status:                ${r.baseline.cossecOverallStatus}`,
  );
  console.log(
    `    Exam readiness:               ${r.baseline.examReadinessScore}`,
  );

  console.log(
    `\n  SCENARIO: ${r.scenario.name} (${r.scenario.rateShiftBps}bps · deposits ${r.scenario.depositShockPct}% · +${r.scenario.creditShockPct}% default on ${r.scenario.creditShockSegment})`,
  );
  console.log(`    Credit loss:    ${usd(r.stress.creditLoss)}`);
  console.log(`    Deposit cost:   ${usd(r.stress.depositImpact)}`);
  console.log(`    NII impact:     ${usd(r.stress.niiImpact)}`);
  console.log(`    Pass/fail:      ${r.stress.passFailStatus}`);

  const d = r.capitalRatioUnderStress.distribution;
  console.log('\n  CAPITAL RATIO UNDER STRESS (seeded projection)');
  console.log(
    `    p5 (adverse): ${pct(d.p5)}   p25: ${pct(d.p25)}   p50: ${pct(d.p50)}   p75: ${pct(d.p75)}   p95: ${pct(d.p95)}`,
  );
  console.log(
    `    Breach probability (< ${pct(r.headline.cossecMinimumPct)}): ${pct(r.headline.breachProbabilityPct)}`,
  );

  console.log(
    '\n  COSSEC FINDINGS (the binding constraints capital ratio hides)',
  );
  if (r.findings.length === 0) {
    console.log('    none — all ratios within limits');
  } else {
    for (const f of r.findings) {
      const mark = f.status === 'fail' ? '✗' : '!';
      console.log(
        `    ${mark} [${f.status.toUpperCase().padEnd(7)}] ${f.name} = ${f.value}${f.unit}  (limit: ${f.threshold})`,
      );
    }
  }

  console.log('\n  HEADLINE');
  console.log(`    ${r.headline.narrative}`);
  console.log(`    ${r.headline.narrativeEs}`);

  console.log('\n  REVERSE STRESS (distance to breach)');
  console.log(`    ${r.reverseStress.narrative}`);

  console.log('\n  7-STEP PIPELINE');
  for (const s of r.pipeline) {
    const mark = s.status === 'completed' ? '✓' : '·';
    console.log(`    ${mark} ${s.step}. ${s.name} [${s.status}]`);
  }

  if (r.gaps.length) {
    console.log(`\n  DATA GAPS (D1): ${r.gaps.length}`);
    for (const g of r.gaps) {
      console.log(`    - [${g.severity}] ${g.field}: ${g.reason}`);
    }
  } else {
    console.log('\n  DATA GAPS (D1): none — all inputs present');
  }

  console.log(`\n  Artifact checksum (SHA-256): ${r.resultChecksum}`);
  console.log(line);
}

function printBacktest(): void {
  const r = backtestProjectionCalibration();
  const line = '─'.repeat(72);
  console.log(line);
  console.log('  SIC 2026 capital-ratio projection — BACKTEST (SR 11-7)');
  console.log(`  ${r.seeds} seeds · ${r.paths} paths/run`);
  console.log(line);
  for (const c of r.checks) {
    console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}`);
    console.log(`      ${c.detail}`);
  }
  console.log(line);
  console.log(
    `  RESULT: ${r.passed ? '✓ CALIBRATED — all checks passed' : '✗ FAILED'}`,
  );
  console.log(line);
}

async function main(): Promise<void> {
  // Silence the Nest service loggers so the CLI emits a clean report only.
  Logger.overrideLogger(false);

  const argv = process.argv.slice(2);
  if (argv.includes('--backtest')) {
    printBacktest();
    return;
  }
  const asJson = argv.includes('--json');
  const htmlArg = argv.find((a) => a === '--html' || a.startsWith('--html='));
  const pathsArg = argv.find((a) => a.startsWith('--paths='));
  const paths = pathsArg ? parseInt(pathsArg.split('=')[1], 10) : undefined;

  const result = await new SicDemoService().run({ paths });

  if (htmlArg) {
    const outPath = htmlArg.includes('=')
      ? htmlArg.split('=')[1]
      : 'sic-demo.html';
    writeFileSync(outPath, renderSicDemoHtml(result), 'utf-8');
    console.log(`SIC 2026 demo report written to ${outPath}`);
    return;
  }
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
}

main().catch((err) => {
  console.error('SIC demo failed:', err);
  process.exit(1);
});
