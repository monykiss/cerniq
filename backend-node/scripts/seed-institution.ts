#!/usr/bin/env ts-node
/**
 * CLI: Idempotent institution seeding for cross-session pickup.
 *
 * Usage:
 *   pnpm seed:institution -- --workspace=<workspaceId> --fixture=<seedKey>
 *   pnpm seed:institution -- --workspace=ws_abc123 --fixture=pr-cooperativa-demo
 *
 * Re-running this command with the same arguments is the supported path. The CLI
 * exits 0 with a JSON delta describing what changed (or "unchanged" if nothing did),
 * so a future Claude session — or a CI workflow — can land in the same state without
 * duplicating data.
 *
 * The CLI talks directly to PrismaClient and reuses InstitutionSeedService. It does
 * NOT spin up the full Nest application, so it's fast enough to run from the loop of
 * a watch script.
 */
// Prisma 7 refuses a bare `new PrismaClient()` — it requires a driver adapter.
// PrismaService already constructs the PrismaPg adapter + pg.Pool from
// DATABASE_URL, so reuse it here rather than hand-rolling a second adapter and
// letting the two drift. Constructing it outside Nest is fine: the DI lifecycle
// hooks (onModuleInit/onModuleDestroy) are not required for a one-shot CLI, and
// Prisma connects lazily on first query.
import { PrismaService } from '../src/prisma.service';
import { InstitutionSeedService } from '../src/alm/institution-seed.service';
import { listFixtures } from '../src/alm/data/fixtures';

interface CliArgs {
  workspace: string;
  fixture: string;
}

function parseArgs(argv: string[]): CliArgs | null {
  const out: Partial<CliArgs> = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([a-zA-Z]+)=(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'workspace') out.workspace = value;
    else if (key === 'fixture') out.fixture = value;
  }
  if (!out.workspace || !out.fixture) return null;
  return out as CliArgs;
}

function printUsage(): void {
  const fixtures = listFixtures()
    .map((f) => `    - ${f.seedKey.padEnd(28)} ${f.name} (${f.type}, $${f.totalAssets}M)`)
    .join('\n');

  process.stderr.write(
    [
      '',
      'Usage: pnpm seed:institution -- --workspace=<id> --fixture=<seedKey>',
      '',
      'Available fixtures:',
      fixtures || '    (none registered)',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (!args) {
    printUsage();
    process.exit(2);
  }

  const prisma = new PrismaService();
  try {
    // The seed service expects a NestJS-injected PrismaService, but its surface is just
    // PrismaClient methods + $transaction. We can satisfy that contract directly.
    const service = new InstitutionSeedService(prisma as never);
    const result = await service.seedFromFixture(args.workspace, args.fixture);

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`seed-institution failed: ${message}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
