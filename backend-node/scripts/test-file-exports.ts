#!/usr/bin/env ts-node
/**
 * CLI: Exercise every CERNIQ portal file-export path end-to-end and write
 * the resulting PDFs to /tmp so you can `open` them and verify they render
 * correctly without spinning up the web server or logging into the portal.
 *
 * What it generates:
 *   1. ALM Report PDF (Spanish)     — full 14+ page report from ReportsService
 *   2. ALM Report PDF (English)     — same pipeline, different language
 *   3. ALCO Board Pack PDF          — 8-page board-ready summary from AlcoPackService
 *   4. Balance Sheet CSV Template   — downloadable template served by the portal
 *
 * Data source: the Caguas COSSEC snapshot (or whichever slug you pass). A
 * temporary workspace + institution is created just for this run, then
 * torn down in a `finally` block so nothing pollutes the database.
 *
 * USAGE
 * ─────
 *   npx ts-node scripts/test-file-exports.ts
 *   npx ts-node scripts/test-file-exports.ts --slug acacia
 *   npx ts-node scripts/test-file-exports.ts --slug caguas --out /tmp/caguas-exports
 *
 * Pre-flight: Postgres reachable via DATABASE_URL. No Redis / R2 / Stripe
 * required — this script touches only the report-generation code paths.
 *
 * EXIT CODES
 * ──────────
 *   0  all exports generated successfully
 *   1  data source not found (unknown slug)
 *   2  runtime error during generation
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { AlmEnterpriseService } from '../src/alm/alm-enterprise.service';
import { ReportsService } from '../src/alm/reports/reports.service';
import { AlcoPackService } from '../src/pipeline/alco-pack.service';
import { CSVIngestionService } from '../src/alm/csv-ingestion.service';
import { CossecDataPullService } from '../src/alm/data-pull/cossec-data-pull.service';
import { COSSEC_SNAPSHOT_BY_SLUG } from '../src/alm/data-pull/cossec-snapshots/cossec-2025q4';

interface CliArgs {
  slug: string;
  outDir: string;
  language: 'en' | 'es' | 'both';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    slug: 'caguas',
    outDir: '/tmp',
    language: 'both',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--slug') {
      args.slug = argv[++i] ?? args.slug;
    } else if (arg === '--out') {
      args.outDir = argv[++i] ?? args.outDir;
    } else if (arg === '--lang') {
      const raw = argv[++i];
      if (raw !== 'en' && raw !== 'es' && raw !== 'both') {
        throw new Error(`--lang must be 'en', 'es', or 'both', got "${raw}"`);
      }
      args.language = raw;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      args.slug = arg;
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  process.stdout
    .write(`test-file-exports — Exercise every CERNIQ file-export path

USAGE:
  ts-node scripts/test-file-exports.ts [<slug>] [flags]

POSITIONAL:
  <slug>         COSSEC snapshot slug (default: caguas)

FLAGS:
  --slug <slug>  Same as positional
  --out <dir>    Output directory (default: /tmp)
  --lang <es|en|both>   Languages to generate (default: both)
  --help, -h     Show this help

EXAMPLES:
  npx ts-node scripts/test-file-exports.ts
  npx ts-node scripts/test-file-exports.ts caguas
  npx ts-node scripts/test-file-exports.ts --slug acacia --lang es
  npx ts-node scripts/test-file-exports.ts --slug bayamon --out ~/Desktop/bayamon-exports
`);
}

interface ExportResult {
  label: string;
  path: string;
  bytes: number;
  durationMs: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const snapshot = COSSEC_SNAPSHOT_BY_SLUG.get(args.slug.toLowerCase());
  if (!snapshot) {
    process.stderr.write(
      `error: no COSSEC snapshot for slug "${args.slug}". Available: ${Array.from(COSSEC_SNAPSHOT_BY_SLUG.keys()).join(', ')}\n`,
    );
    process.exit(1);
  }

  if (!fs.existsSync(args.outDir)) {
    fs.mkdirSync(args.outDir, { recursive: true });
  }

  process.stderr.write(
    `[test-file-exports] Bootstrapping NestJS application context...\n`,
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });

  let tempInstitutionId: string | null = null;
  let tempWorkspaceId: string | null = null;
  let tempUserId: string | null = null;
  const results: ExportResult[] = [];

  try {
    const prisma = app.get(PrismaService);
    const almEnterprise = app.get(AlmEnterpriseService);
    const reports = app.get(ReportsService);
    const alcoPack = app.get(AlcoPackService);
    const csvIngestion = app.get(CSVIngestionService);
    const cossec = app.get(CossecDataPullService);

    // 1. Pull public data
    process.stderr.write(
      `[test-file-exports] Pulling COSSEC data for ${snapshot.name}...\n`,
    );
    const data = await cossec.pullBySlug(args.slug.toLowerCase());

    // 2. Create ephemeral workspace + institution
    process.stderr.write(
      `[test-file-exports] Creating ephemeral workspace + institution...\n`,
    );
    const tempUser = await prisma.user.create({
      data: {
        email: `test-file-exports-${Date.now()}@example.com`,
        name: '__TEST_FILE_EXPORTS__',
        provider: 'system',
        emailVerified: true,
      },
    });
    tempUserId = tempUser.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: `__TEST_FILE_EXPORTS__${Date.now()}`,
        ownerId: tempUser.id,
      },
    });
    tempWorkspaceId = workspace.id;

    const institution = await almEnterprise.createInstitution({
      workspaceId: workspace.id,
      name: data.institutionName,
      type: 'cooperativa',
      totalAssets: data.totalAssets,
      currency: 'USD',
      reportingDate: data.asOfDate,
      primaryRegulator: 'COSSEC',
    });
    tempInstitutionId = institution.id;

    // 3. Import balance sheet items
    await almEnterprise.importBalanceSheetItems(
      institution.id,
      data.items.map((item) => ({
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate,
        duration: item.duration,
        rateType: item.rateType,
      })),
    );
    process.stderr.write(
      `[test-file-exports]   → ${data.items.length} balance sheet items imported\n`,
    );

    // 4. Generate exports
    const watermark = `PRELIMINARY — Built from COSSEC public filings, ${data.asOfQuarter}`;

    if (args.language === 'es' || args.language === 'both') {
      results.push(
        await time('ALM Report (ES)', async () => {
          const buffer = await reports.generateALMReport(institution.id, 'es', {
            watermark,
          });
          const filename = `cerniq-alm-report-${args.slug}-es.pdf`;
          return writePdf(args.outDir, filename, buffer);
        }),
      );
    }

    if (args.language === 'en' || args.language === 'both') {
      results.push(
        await time('ALM Report (EN)', async () => {
          const buffer = await reports.generateALMReport(institution.id, 'en', {
            watermark,
          });
          const filename = `cerniq-alm-report-${args.slug}-en.pdf`;
          return writePdf(args.outDir, filename, buffer);
        }),
      );
    }

    // ALCO pack — always both languages since that's the typical board ask
    if (args.language === 'es' || args.language === 'both') {
      results.push(
        await time('ALCO Board Pack (ES)', async () => {
          const buffer = await alcoPack.buildALCOPack(institution.id, 'es');
          const filename = `cerniq-alco-pack-${args.slug}-es.pdf`;
          return writePdf(args.outDir, filename, buffer);
        }),
      );
    }
    if (args.language === 'en' || args.language === 'both') {
      results.push(
        await time('ALCO Board Pack (EN)', async () => {
          const buffer = await alcoPack.buildALCOPack(institution.id, 'en');
          const filename = `cerniq-alco-pack-${args.slug}-en.pdf`;
          return writePdf(args.outDir, filename, buffer);
        }),
      );
    }

    // 5. CSV template export (no institution needed — just exercise the
    //    template generator so the file export UX is covered end-to-end)
    results.push(
      await time('Balance Sheet CSV Template (cooperativa)', async () => {
        const csv = csvIngestion.getCooperativaTemplate();
        const filename = `cerniq-balance-sheet-template.csv`;
        const outPath = path.join(args.outDir, filename);
        fs.writeFileSync(outPath, csv, 'utf-8');
        return {
          path: outPath,
          bytes: Buffer.byteLength(csv, 'utf-8'),
        };
      }),
    );
  } catch (err: any) {
    process.stderr.write(`error: ${err?.message || err}\n`);
    if (err?.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(2);
  } finally {
    // 6. Clean up ephemeral data
    try {
      const prisma = app.get(PrismaService);
      if (tempInstitutionId) {
        await prisma.balanceSheetItem
          .deleteMany({ where: { institutionId: tempInstitutionId } })
          .catch(() => undefined);
        await prisma.institution
          .delete({ where: { id: tempInstitutionId } })
          .catch(() => undefined);
      }
      if (tempWorkspaceId) {
        await prisma.workspace
          .delete({ where: { id: tempWorkspaceId } })
          .catch(() => undefined);
      }
      if (tempUserId) {
        await prisma.user
          .delete({ where: { id: tempUserId } })
          .catch(() => undefined);
      }
    } catch {
      // Best-effort cleanup — don't mask the real error
    }
    await app.close().catch(() => undefined);
  }

  printSummary(snapshot.name, results);
  process.exit(0);
}

async function time<T extends { path: string; bytes: number }>(
  label: string,
  fn: () => Promise<T>,
): Promise<ExportResult> {
  const started = Date.now();
  process.stderr.write(`[test-file-exports] Generating ${label}...\n`);
  const result = await fn();
  return {
    label,
    path: result.path,
    bytes: result.bytes,
    durationMs: Date.now() - started,
  };
}

function writePdf(outDir: string, filename: string, buffer: Buffer) {
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, buffer);
  return { path: outPath, bytes: buffer.length };
}

function printSummary(institutionName: string, results: ExportResult[]) {
  const out = process.stdout;
  out.write('\n');
  out.write(
    '  ╭──────────────────────────────────────────────────────────────╮\n',
  );
  out.write(
    '  │  CERNIQ File Export Test — Results                           │\n',
  );
  out.write(
    '  ╰──────────────────────────────────────────────────────────────╯\n',
  );
  out.write('\n');
  out.write(`    Institution:  ${institutionName}\n`);
  out.write(`    Exports:      ${results.length} generated\n`);
  out.write('\n');

  for (const r of results) {
    const sizeLabel =
      r.bytes >= 1_000_000
        ? `${(r.bytes / 1_000_000).toFixed(2)} MB`
        : r.bytes >= 1000
          ? `${(r.bytes / 1000).toFixed(1)} KB`
          : `${r.bytes} B`;
    out.write(
      `    ✓ ${r.label.padEnd(36)}  ${sizeLabel.padStart(10)}  ${r.durationMs}ms\n`,
    );
    out.write(`        ${r.path}\n`);
  }

  out.write('\n');
  out.write('    Open any of these to verify the export renders correctly:\n');
  for (const r of results) {
    out.write(`      open "${r.path}"\n`);
  }
  out.write('\n');
}

main().catch((err) => {
  Logger.error(`Fatal error in test-file-exports: ${err?.message || err}`);
  process.exit(2);
});
