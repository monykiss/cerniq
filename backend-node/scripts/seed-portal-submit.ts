#!/usr/bin/env ts-node
/**
 * Seed an upload-ready portal account for manual `/portal/submit` E2E testing.
 *
 * What it creates:
 *   1. A verified user for the supplied email
 *   2. A workspace owned by that user
 *   3. An active paid subscription (monthly by default)
 *   4. A pending `AWAITING_DATA` report job visible on `/portal/submit`
 *   5. A fresh magic link so the tester can jump straight into the portal
 *
 * It also validates the CSV fixture before seeding so the upload step uses
 * a known-good file. The default fixture lives under `frontend/e2e/fixtures`
 * so both Playwright and manual QA can use the same upload payload.
 */

import 'dotenv/config';

import * as crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  SubscriptionStatus,
  type SubscriptionTier,
} from '@prisma/client';
import pg from 'pg';
import { CSVIngestionService } from '../src/alm/csv-ingestion.service';
import { InstitutionSeedService } from '../src/alm/institution-seed.service';
import { getFixture, listFixtures } from '../src/alm/data/fixtures';
import { requireEnv } from '../src/config/required-env';
import type {
  InstitutionFixture,
  SeedResult,
} from '../src/alm/data/fixtures/_schema';

type BillingTier = Extract<
  SubscriptionTier,
  'one_time' | 'monthly' | 'annual' | 'partner'
>;

interface CliArgs {
  email: string;
  name: string;
  institution: string;
  workspaceName: string;
  csvPath: string;
  fixture: string;
  tier: BillingTier;
  json: boolean;
}

const DEFAULT_FIXTURE = 'pr-cooperativa-demo';

function repoCsvPath(): string {
  return resolve(
    __dirname,
    '../../frontend/e2e/fixtures/portal-submit-cooperativa.csv',
  );
}

function frontendUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3001'
  ).replace(/\/+$/, '');
}

function backendUrl(): string {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_NODE_API_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

async function resolveConnectionString(): Promise<string> {
  const connectionString = requireEnv('DATABASE_URL');
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query('select 1');
    return connectionString;
  } catch (error) {
    throw error instanceof Error
      ? new Error(`Unable to connect using DATABASE_URL: ${error.message}`)
      : new Error('Unable to connect using DATABASE_URL.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

function usage(): string {
  const fixtures = listFixtures()
    .map((fixture) => `    - ${fixture.seedKey.padEnd(24)} ${fixture.name}`)
    .join('\n');

  return [
    '',
    'Usage: npm run seed:portal-submit -- [options]',
    '',
    'Options:',
    '  --email <email>           Portal user email (default: portal-submit@example.com)',
    '  --name <name>             Display name (default: Portal Submit QA)',
    '  --institution <name>      Report job institution name (default: Cooperativa E2E Submit)',
    '  --workspace <name>        Workspace name (default: <institution> Workspace)',
    '  --csv <absolute-path>     CSV to upload on /portal/submit',
    `  --fixture <key>           Institution fixture to seed (default: ${DEFAULT_FIXTURE})`,
    '  --tier <tier>             one_time | monthly | annual | partner (default: monthly)',
    '  --json                    Print machine-readable JSON only',
    '  --help                    Show help',
    '',
    `Default CSV: ${repoCsvPath()}`,
    'Available fixtures:',
    fixtures || '    (none registered)',
    '',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const defaults = {
    email: 'portal-submit@example.com',
    name: 'Portal Submit QA',
    institution: 'Cooperativa E2E Submit',
    workspaceName: '',
    csvPath: repoCsvPath(),
    fixture: DEFAULT_FIXTURE,
    tier: 'monthly' as BillingTier,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === '--json') {
      defaults.json = true;
      continue;
    }
    if (arg === '--email') {
      defaults.email = argv[++i] || defaults.email;
      continue;
    }
    if (arg === '--name') {
      defaults.name = argv[++i] || defaults.name;
      continue;
    }
    if (arg === '--institution') {
      defaults.institution = argv[++i] || defaults.institution;
      continue;
    }
    if (arg === '--workspace') {
      defaults.workspaceName = argv[++i] || defaults.workspaceName;
      continue;
    }
    if (arg === '--csv') {
      defaults.csvPath = argv[++i] || defaults.csvPath;
      continue;
    }
    if (arg === '--fixture') {
      defaults.fixture = argv[++i] || defaults.fixture;
      continue;
    }
    if (arg === '--tier') {
      const tier = argv[++i] as BillingTier | undefined;
      if (
        !tier ||
        !['one_time', 'monthly', 'annual', 'partner'].includes(tier)
      ) {
        throw new Error(
          `Invalid --tier "${tier}". Expected one_time, monthly, annual, or partner.`,
        );
      }
      defaults.tier = tier;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return {
    ...defaults,
    workspaceName:
      defaults.workspaceName || `${defaults.institution} Workspace`,
    csvPath: resolve(defaults.csvPath),
  };
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function createMagicLinkUrls(token: string): {
  frontend: string;
  backend: string;
} {
  return {
    frontend: `${frontendUrl()}/auth/magic?token=${token}`,
    backend: `${backendUrl()}/api/auth/magic?token=${token}`,
  };
}

function isMissingSeedKeyColumn(error: unknown): boolean {
  return (
    error instanceof Error &&
    /institutions\.seed_key/i.test(error.message) &&
    /does not exist/i.test(error.message)
  );
}

async function seedInstitutionCompat(
  prisma: PrismaClient,
  workspaceId: string,
  fixture: InstitutionFixture,
): Promise<SeedResult> {
  const seedService = new InstitutionSeedService(prisma as never);

  try {
    return await seedService.seedFromFixture(workspaceId, fixture.seedKey);
  } catch (error) {
    if (!isMissingSeedKeyColumn(error)) {
      throw error;
    }

    const existing = await prisma.institution.findFirst({
      where: {
        workspaceId,
        name: fixture.name,
      },
    });

    const institutionData = {
      workspaceId,
      name: fixture.name,
      type: fixture.type,
      totalAssets: fixture.totalAssets,
      currency: fixture.currency,
      reportingDate: new Date(fixture.reportingDate),
      primaryRegulator: fixture.primaryRegulator ?? 'COSSEC',
      cossecRegistrationNumber: fixture.cossecRegistrationNumber ?? null,
      fiscalYearEnd: fixture.fiscalYearEnd ?? null,
      preferredLanguage: fixture.preferredLanguage ?? 'es',
    };

    const institution = existing
      ? await prisma.institution.update({
          where: { id: existing.id },
          data: institutionData,
        })
      : await prisma.institution.create({
          data: institutionData,
        });

    const before = await prisma.balanceSheetItem.count({
      where: { institutionId: institution.id },
    });

    await prisma.balanceSheetItem.deleteMany({
      where: { institutionId: institution.id },
    });

    await prisma.balanceSheetItem.createMany({
      data: fixture.items.map((item) => ({
        institutionId: institution.id,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate / 100,
        duration: item.duration,
        rateType: item.rateType,
        depositBeta: item.depositBeta ?? null,
      })),
    });

    const liquidityDate = new Date(
      fixture.liquidity.date ?? fixture.reportingDate,
    );
    const liquidityPayload = {
      hqlaLevel1: fixture.liquidity.hqlaLevel1,
      hqlaLevel2: fixture.liquidity.hqlaLevel2,
      cashOutflows: fixture.liquidity.cashOutflows,
      cashInflows: fixture.liquidity.cashInflows,
      lcr: fixture.liquidity.lcr,
      nsfr: fixture.liquidity.nsfr,
    };

    const existingLiquidity = await prisma.liquidityPosition.findFirst({
      where: {
        institutionId: institution.id,
        date: liquidityDate,
      },
    });

    let liquidityDelta: SeedResult['delta']['liquidityPosition'] = 'created';
    if (existingLiquidity) {
      await prisma.liquidityPosition.update({
        where: { id: existingLiquidity.id },
        data: liquidityPayload,
      });
      liquidityDelta = 'updated';
    } else {
      await prisma.liquidityPosition.create({
        data: {
          institutionId: institution.id,
          date: liquidityDate,
          ...liquidityPayload,
        },
      });
    }

    return {
      institutionId: institution.id,
      seedKey: fixture.seedKey,
      delta: {
        institution: existing ? 'updated' : 'created',
        balanceSheetItems: {
          before,
          after: fixture.items.length,
          replaced: before > 0,
        },
        liquidityPosition: liquidityDelta,
      },
      fixture: {
        seedKey: fixture.seedKey,
        name: fixture.name,
        itemCount: fixture.items.length,
      },
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixture = getFixture(args.fixture);

  if (!existsSync(args.csvPath)) {
    throw new Error(`CSV file not found: ${args.csvPath}`);
  }

  const csvContent = readFileSync(args.csvPath, 'utf-8');
  const csvIngestion = new CSVIngestionService();
  const parseResult = csvIngestion.parseCSV(csvContent);

  if (!parseResult.valid) {
    const firstError = parseResult.errors[0];
    const detail = firstError
      ? `row ${firstError.row}, field "${firstError.field}": ${firstError.message}`
      : 'unknown CSV validation failure';
    throw new Error(`Upload CSV is invalid: ${detail}`);
  }

  const connectionString = await resolveConnectionString();
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const email = args.email.toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: args.name,
        provider: 'magic_link',
        emailVerified: true,
      },
      update: {
        name: args.name,
        provider: 'magic_link',
        emailVerified: true,
      },
    });

    const workspace =
      (await prisma.workspace.findFirst({
        where: { ownerId: user.id },
        orderBy: { createdAt: 'asc' },
      })) ||
      (await prisma.workspace.create({
        data: {
          ownerId: user.id,
          name: args.workspaceName,
        },
      }));

    const seededInstitution = await seedInstitutionCompat(
      prisma,
      workspace.id,
      fixture,
    );
    const institution = await prisma.institution.findUniqueOrThrow({
      where: { id: seededInstitution.institutionId },
    });

    const currentPeriodEnd =
      args.tier === 'one_time'
        ? null
        : addMonths(new Date(), args.tier === 'annual' ? 12 : 1);

    const subscription = await prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tier: args.tier,
        status: SubscriptionStatus.active,
        currentPeriodEnd,
      },
      update: {
        tier: args.tier,
        status: SubscriptionStatus.active,
        currentPeriodEnd,
        cancelledAt: null,
      },
    });

    const existingPendingJob = await prisma.reportJob.findFirst({
      where: {
        userId: user.id,
        institutionId: institution.id,
        status: { in: ['AWAITING_DATA', 'VALIDATION_FAILED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const reportJob = existingPendingJob
      ? await prisma.reportJob.update({
          where: { id: existingPendingJob.id },
          data: {
            status: 'AWAITING_DATA',
            analysisPeriod: null,
            previousJobId: null,
            submittedAt: null,
            processingStartedAt: null,
            completedAt: null,
            reportUrl: null,
            reportUrlEn: null,
            rawData: null,
            rawDataPurgedAt: null,
            errorMessage: null,
            retryCount: 0,
            institutionId: institution.id,
            institutionName: institution.name,
            reportLang: 'es',
            triggeredBy: 'portal_submit_seed',
          },
        })
      : await prisma.reportJob.create({
          data: {
            userId: user.id,
            institutionId: institution.id,
            institutionName: institution.name,
            status: 'AWAITING_DATA',
            reportLang: 'es',
            triggeredBy: 'portal_submit_seed',
          },
        });

    const token = crypto.randomBytes(32).toString('hex');
    const magicLinkExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        token,
        expiresAt: magicLinkExpiresAt,
      },
    });

    const magicLinks = createMagicLinkUrls(token);
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      institution: {
        id: institution.id,
        name: institution.name,
        fixture: fixture.seedKey,
        seedDelta: seededInstitution.delta,
      },
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      },
      reportJob: {
        id: reportJob.id,
        institutionName: reportJob.institutionName,
        status: reportJob.status,
      },
      uploadCsv: {
        path: args.csvPath,
        validRows: parseResult.summary.validRows,
        totalAssets: parseResult.summary.totalAssets,
        totalLiabilities: parseResult.summary.totalLiabilities,
        warningCount: parseResult.warnings.length,
      },
      magicLink: {
        frontendUrl: magicLinks.frontend,
        backendUrl: magicLinks.backend,
        expiresAt: magicLinkExpiresAt.toISOString(),
      },
      nextStep: `${frontendUrl()}/portal/submit`,
    };

    if (args.json) {
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    process.stdout.write(
      [
        '',
        'Portal submit seed ready.',
        '',
        `User:        ${payload.user.email}`,
        `Workspace:   ${payload.workspace.name} (${payload.workspace.id})`,
        `Institution: ${payload.institution.name} (${payload.institution.id})`,
        `Report job:  ${payload.reportJob.id} [${payload.reportJob.status}]`,
        `CSV:         ${payload.uploadCsv.path}`,
        `Magic link:  ${payload.magicLink.frontendUrl}`,
        `Fallback:    ${payload.magicLink.backendUrl}`,
        `Next step:   ${payload.nextStep}`,
        '',
        'CSV summary:',
        `  valid rows         ${payload.uploadCsv.validRows}`,
        `  total assets       ${payload.uploadCsv.totalAssets}`,
        `  total liabilities  ${payload.uploadCsv.totalLiabilities}`,
        `  warnings           ${payload.uploadCsv.warningCount}`,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  const code =
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : null;
  const message =
    code === 'ECONNREFUSED'
      ? 'database connection refused. Start Postgres (for local dev: `docker compose up -d postgres`) and retry.'
      : err instanceof Error &&
          /password authentication failed/i.test(err.message)
        ? 'database authentication failed. Update DATABASE_URL (or your local Postgres password) and retry.'
        : isMissingSeedKeyColumn(err)
          ? 'the database is missing the `institutions.seed_key` migration, but the script can fall back automatically once it connects with a role that can read and write institutions.'
          : err instanceof Error
            ? err.message
            : String(err);
  process.stderr.write(`${message}\n\n${usage()}`);
  process.exit(1);
});
