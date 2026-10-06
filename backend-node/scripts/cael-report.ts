#!/usr/bin/env ts-node
/**
 * CLI: CAEL — Puerto Rico cooperativa quarterly compliance filings.
 *
 * Runs the offline, DB-free harness against the canonical `pr-cooperativa-demo`
 * fixture, computes the THREE quarterly CAEL variants (Reglamento 7790 on the
 * incurred-loss basis, CAEL-with-CECL, and CAEL Piloto), and prints / renders
 * the bilingual filing — the W1.1 Slice 2 compute→render path end to end, with
 * no database and no Nest bootstrap.
 *
 * Usage:
 *   npm run cael:report                  # formatted bilingual summary
 *   npm run cael:report -- --json        # full machine-readable result
 *   npm run cael:report -- --html        # print-ready HTML (cael-report.html)
 *   npm run cael:report -- --html=/tmp/cael.html
 *
 * Deterministic: the same fixture renders the same filing (SR 11-7) — the
 * underlying engines (COSSEC + incurred-loss/WARM allowance) are themselves
 * golden-locked. Watermarked a DEMOSTRACIÓN, never a regulatory filing.
 */
import { writeFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../src/prisma.service';
import { getFixture } from '../src/alm/data/fixtures';
import { makeInMemoryPrismaFromFixture } from '../src/alm/data/fixtures/in-memory-prisma';
import { AlmService } from '../src/alm/alm.service';
import { DurationService } from '../src/alm/duration.service';
import { AlmEnterpriseService } from '../src/alm/alm-enterprise.service';
import { CECLService } from '../src/alm/cecl.service';
import {
  CaelComplianceService,
  type CaelComplianceResult,
} from '../src/alm/cael-compliance.service';
import {
  renderCaelReport,
  type CaelReportContext,
} from '../src/alm/cael-report';

const FIXTURE_KEY = 'pr-cooperativa-demo';
const INSTITUTION_ID = 'inst-cael-cli';

function fmtPct(n: number | null): string {
  return n === null ? '   —  ' : `${n.toFixed(2)}%`;
}

async function compute(): Promise<{
  results: CaelComplianceResult[];
  ctx: CaelReportContext;
}> {
  const fixture = getFixture(FIXTURE_KEY);
  const prisma = makeInMemoryPrismaFromFixture(fixture, {
    institutionId: INSTITUTION_ID,
  }) as unknown as PrismaService;
  const alm = new AlmEnterpriseService(
    prisma,
    new AlmService(),
    new DurationService(),
  );
  const cecl = new CECLService(prisma);

  const cossec = await alm.getCOSSECCompliance(INSTITUTION_ID);
  const incurred = await cecl.getCECLAnalysis(INSTITUTION_ID, 'incurredloss');
  const warm = await cecl.getCECLAnalysis(INSTITUTION_ID, 'warm');

  const svc = new CaelComplianceService();
  const results = [
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('reg7790', cossec.summary, incurred),
    ),
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('cecl', cossec.summary, warm),
    ),
    svc.evaluateCaelCompliance(
      svc.caelInputsFromEngines('piloto', cossec.summary, null),
    ),
  ];

  const ctx: CaelReportContext = {
    institutionName: cossec.institutionName,
    reportingDate: cossec.reportingDate,
    regulator: 'COSSEC',
    generatedFor: 'CAEL — radicación trimestral (demostración)',
  };
  return { results, ctx };
}

function printReport(
  results: CaelComplianceResult[],
  ctx: CaelReportContext,
): void {
  const line = '─'.repeat(72);
  console.log(line);
  console.log(
    '  CAEL — radicación trimestral (demostración) · quarterly filings',
  );
  console.log(
    `  ${ctx.institutionName} · ${ctx.regulator} · as of ${ctx.reportingDate}`,
  );
  console.log(line);

  for (const r of results) {
    console.log(`\n  ${r.frameworkName}  [${r.overallStatus.toUpperCase()}]`);
    console.log(
      `    Loss basis: ${r.allowance.basis}` +
        (r.allowance.coveragePct !== null
          ? `   ·   allowance coverage ${fmtPct(r.allowance.coveragePct)}`
          : ''),
    );
    console.log(
      `    Exam readiness: ${r.composite.examReadinessScore ?? '—'}` +
        (r.composite.provisional ? ' (incl. provisional bands)' : ''),
    );
    for (const leg of r.ratios) {
      const mark =
        leg.status === 'pass'
          ? '✓'
          : leg.status === 'fail'
            ? '✗'
            : leg.status === 'data_unavailable'
              ? '—'
              : '·';
      const tag = leg.provisional ? 'provisional' : 'statutory';
      console.log(
        `      ${mark} ${leg.category.padEnd(14)} ${fmtPct(leg.value).padStart(7)}  (${leg.threshold.padEnd(8)}) [${tag}]`,
      );
    }
  }

  const incurred = results.find((r) => r.lossBasis === 'incurred-loss');
  const cecl = results.find((r) => r.lossBasis === 'cecl');
  if (incurred && cecl) {
    const a = incurred.allowance.coveragePct;
    const c = cecl.allowance.coveragePct;
    const delta = a !== null && c !== null ? c - a : null;
    console.log('\n  LOSS-BASIS COMPARISON (the reason for the dual filing)');
    console.log(
      `    Incurred-loss ${fmtPct(a)}   ·   CECL ${fmtPct(c)}   ·   Δ ${fmtPct(delta)}`,
    );
  }

  const gaps = dedupeGaps(results);
  console.log(`\n  DATA GAPS (D1): ${gaps.length}`);
  for (const g of gaps) {
    console.log(`    - [${g.severity}] ${g.field}`);
  }
  console.log(line);
}

function dedupeGaps(
  results: CaelComplianceResult[],
): { field: string; severity: string }[] {
  const seen = new Set<string>();
  const out: { field: string; severity: string }[] = [];
  for (const r of results) {
    for (const g of r.gaps) {
      if (seen.has(g.field)) continue;
      seen.add(g.field);
      out.push({ field: g.field, severity: g.severity });
    }
  }
  return out;
}

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  const argv = process.argv.slice(2);
  const { results, ctx } = await compute();

  const htmlArg = argv.find((a) => a === '--html' || a.startsWith('--html='));
  if (htmlArg) {
    const outPath = htmlArg.includes('=')
      ? htmlArg.split('=')[1]
      : 'cael-report.html';
    writeFileSync(outPath, renderCaelReport(results, ctx), 'utf-8');
    console.log(`CAEL filing written to ${outPath}`);
    return;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  printReport(results, ctx);
}

main().catch((err) => {
  console.error('CAEL report failed:', err);
  process.exit(1);
});
