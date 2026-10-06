#!/usr/bin/env ts-node
/**
 * CLI: Member 360 live population + correctness audit.
 *
 * The Member 360 slice (ADR-member-360-layer3) shipped fixture-first with
 * unit tests over mocked Prisma. Those prove the CLASSIFIER; they cannot
 * prove the BOOK — that the migration applies, that the write path persists
 * what the lifecycle service decided, and that a seeded demo institution is
 * actually populated the way a sales demo needs it to be.
 *
 * This drives the REAL services against a REAL Postgres and asserts the
 * invariants the schema comments promise. Every check maps to a claim made
 * somewhere in the design:
 *
 *   D1 (never silent zeros) — riskScore/ceclStage/delinquencyDays are NULL
 *   when unknown, never a fabricated 0 or 50; cossecClassification is never
 *   blanket-"pass" (compliant-by-omission is the hazard the roadmap flagged).
 *
 *   Determinism — MemberFixtureService seeds mulberry32 from the institution
 *   id, so re-seeding the same institution must reproduce the same book.
 *   A demo that drifts between runs is not demoable.
 *
 *   Tenant isolation — members are institution-scoped; a second institution
 *   must not see the first's book.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx ts-node scripts/verify-member-360.ts
 *   DATABASE_URL=postgresql://... npx ts-node scripts/verify-member-360.ts --count 250
 *   npx ts-node scripts/verify-member-360.ts --self-test   # no DB required
 *
 * Exits non-zero on any violation so this is a gate, not a vibe check.
 */
import { PrismaService } from '../src/prisma.service';
import { Member360Service } from '../src/alm/member360/member-360.service';
import { MemberFixtureService } from '../src/alm/member360/member-fixture.service';
import { MemberLifecycleService } from '../src/alm/member360/member-lifecycle.service';
import {
  LOAN_LIFECYCLE_STAGES,
  LoanLifecycleService,
} from '../src/alm/member360/loan-lifecycle.service';

const VERIFY_INSTITUTION_ID = 'm360-verify-inst';
const EMPTY_INSTITUTION_ID = 'm360-verify-empty';

/** The subset of a Member row (with relations) this audit reads. */
interface MemberRow {
  id: string;
  memberNumber: string;
  lifecycleStage: string;
  riskScore: number | null;
  ceclStage: number | null;
  source: string;
  accounts: {
    category: string;
    balance: unknown;
    cossecClassification: string | null;
    productCode: string | null;
    loanStage: string | null;
    originalPrincipal: unknown;
  }[];
  lifecycleEvents: { id: string }[];
}

const failures: string[] = [];
let passed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passed += 1;
    process.stdout.write(`  ok   ${line}\n`);
  } else {
    failures.push(line);
    process.stdout.write(` FAIL  ${line}\n`);
  }
}

/**
 * Self-test: exercises the pure classifier + fixture generator with no DB, so
 * CI can run this gate without provisioning Postgres (D24 §4 — every gate
 * carries a --self-test).
 */
function runSelfTest(): void {
  const fixtures = new MemberFixtureService(new LoanLifecycleService());
  const lifecycle = new MemberLifecycleService();

  const a = fixtures.generateMembers('inst-selftest', 40);
  const b = fixtures.generateMembers('inst-selftest', 40);
  check(
    'self-test: fixture generation is deterministic for one institution',
    JSON.stringify(a) === JSON.stringify(b),
  );

  const other = fixtures.generateMembers('inst-different', 40);
  check(
    'self-test: different institutions produce different books',
    JSON.stringify(a) !== JSON.stringify(other),
  );

  check(
    'self-test: requested count honored',
    a.length === 40,
    `${a.length}/40`,
  );
  check(
    'self-test: every generated member carries at least one account',
    a.every((m) => m.accounts.length > 0),
  );
  check(
    'self-test: member numbers unique within the generated book',
    new Set(a.map((m) => m.memberNumber)).size === a.length,
  );

  // A member with no accounts must score NULL, never 0 — the D1 contract.
  const empty = lifecycle.assessRisk('member-selftest', []);
  check(
    'self-test: D1 — a member with no accounts scores riskScore=null, not 0',
    empty.riskScore === null,
    `got ${JSON.stringify(empty.riskScore)}`,
  );
  check(
    'self-test: D1 — a member with no accounts reports a data gap',
    Array.isArray(empty.gaps) && empty.gaps.length > 0,
    `gaps=${empty.gaps?.length ?? 0}`,
  );
  check(
    'self-test: D1 — ceclStage is null with no accounts, not a phantom stage 1',
    empty.ceclStage === null,
    `got ${JSON.stringify(empty.ceclStage)}`,
  );

  summarize('self-test');
}

function summarize(label: string): never {
  process.stdout.write(`\n${'='.repeat(64)}\n`);
  process.stdout.write(
    `Member 360 ${label}: ${passed} passed, ${failures.length} failed\n`,
  );
  if (failures.length) {
    process.stdout.write('\nFailures:\n');
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
  }
  process.stdout.write(`${'='.repeat(64)}\n`);
  process.exit(failures.length ? 1 : 0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    runSelfTest();
  }

  const countArg = argv.indexOf('--count');
  const count = countArg >= 0 ? Number(argv[countArg + 1]) : 250;
  if (!Number.isInteger(count) || count < 1) {
    process.stderr.write('--count must be a positive integer\n');
    process.exit(2);
  }

  if (!process.env.DATABASE_URL) {
    process.stderr.write(
      'DATABASE_URL is required (or pass --self-test to run the DB-free checks).\n',
    );
    process.exit(2);
  }

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const service = new Member360Service(
      prisma,
      new MemberFixtureService(new LoanLifecycleService()),
      new MemberLifecycleService(),
      new LoanLifecycleService(),
    );

    // ── Institutions ────────────────────────────────────────────────────
    // Institution.workspaceId is a real FK, so the workspace has to exist
    // first — a fixed UUID keeps this idempotent across runs.
    const workspaceId = '00000000-0000-4000-8000-000000000360';
    await prisma.workspace.upsert({
      where: { id: workspaceId },
      update: {},
      create: { id: workspaceId, name: 'Member 360 verification workspace' },
    });

    const baseInstitution = {
      name: 'Cooperativa de Verificación M360',
      type: 'cooperativa',
      totalAssets: 185_000_000,
      reportingDate: new Date('2026-06-30'),
      workspaceId,
    };
    await prisma.institution.upsert({
      where: { id: VERIFY_INSTITUTION_ID },
      update: {},
      create: { id: VERIFY_INSTITUTION_ID, ...baseInstitution },
    });
    await prisma.institution.upsert({
      where: { id: EMPTY_INSTITUTION_ID },
      update: {},
      create: {
        id: EMPTY_INSTITUTION_ID,
        ...baseInstitution,
        name: 'Cooperativa Vacía (control)',
        totalAssets: 50_000_000,
      },
    });

    // ── Populate ────────────────────────────────────────────────────────
    const startedAt = Date.now();
    const seedResult = await service.seedDemoMembers(
      VERIFY_INSTITUTION_ID,
      count,
    );
    process.stdout.write(
      `\nseedDemoMembers(${count}) -> ${JSON.stringify(seedResult)} in ${Date.now() - startedAt}ms\n\n`,
    );

    // Annotated explicitly: the `include` generic does not resolve under this
    // tsconfig from scripts/, so every row would land as implicit `any` and
    // trip verify:rule-11. Only the fields this audit actually reads are
    // declared — a narrower contract than the full model, on purpose.
    const members: MemberRow[] = await prisma.member.findMany({
      where: { institutionId: VERIFY_INSTITUTION_ID },
      include: { accounts: true, lifecycleEvents: true },
    });

    // ── Shape ───────────────────────────────────────────────────────────
    check(
      'member count matches request',
      members.length === count,
      `${members.length}/${count}`,
    );
    check(
      'every member holds at least one account',
      members.every((m) => m.accounts.length > 0),
      `accounts/member min=${Math.min(...members.map((m) => m.accounts.length))} max=${Math.max(...members.map((m) => m.accounts.length))}`,
    );
    check(
      'memberNumber unique within the institution',
      new Set(members.map((m) => m.memberNumber)).size === members.length,
    );
    check(
      'source column honestly marks fixture data',
      members.every((m) => m.source === 'fixture'),
      `distinct=${[...new Set(members.map((m) => m.source))].join(',')}`,
    );

    // ── D1: no phantom numbers ──────────────────────────────────────────
    const scored = members.filter((m) => m.riskScore !== null);
    check(
      'riskScore within 0-100 wherever present',
      scored.every((m) => m.riskScore! >= 0 && m.riskScore! <= 100),
      `scored=${scored.length}/${members.length}`,
    );
    check(
      'riskScore shows real variance (not one fabricated constant)',
      new Set(scored.map((m) => m.riskScore)).size > 5,
      `distinct=${new Set(scored.map((m) => m.riskScore)).size}`,
    );
    check(
      'ceclStage restricted to {1,2,3}',
      members
        .filter((m) => m.ceclStage !== null)
        .every((m) => [1, 2, 3].includes(m.ceclStage!)),
    );
    const withoutLoans = members.filter(
      (m) => !m.accounts.some((a) => a.category === 'LOAN'),
    );
    check(
      'ceclStage NULL for every member holding no loan',
      withoutLoans.every((m) => m.ceclStage === null),
      `loanless members=${withoutLoans.length}`,
    );

    // ── Demo quality: the book must show the wedge ──────────────────────
    const stageDistribution: Record<string, number> = {};
    for (const m of members) {
      stageDistribution[m.lifecycleStage] =
        (stageDistribution[m.lifecycleStage] ?? 0) + 1;
    }
    process.stdout.write(
      `\nlifecycle distribution: ${JSON.stringify(stageDistribution)}\n`,
    );
    check(
      'more than one lifecycle stage represented',
      Object.keys(stageDistribution).length > 1,
      `stages=${Object.keys(stageDistribution).length}`,
    );
    check(
      'a distressed cohort exists (AT_RISK/DELINQUENT/WORKOUT)',
      (stageDistribution.AT_RISK ?? 0) +
        (stageDistribution.DELINQUENT ?? 0) +
        (stageDistribution.WORKOUT ?? 0) >
        0,
    );
    // Every stage the classifier can actually emit must be populated, or the
    // UI renders permanently empty lifecycle columns in a sales demo.
    // CHARGED_OFF is deliberately excluded — the classifier never assigns it
    // (documented back-office decision), so demanding it here would be
    // asserting a behaviour the design explicitly rejects.
    for (const stage of [
      'ONBOARDING',
      'ACTIVE',
      'AT_RISK',
      'DELINQUENT',
      'WORKOUT',
      'CHURNED',
    ]) {
      check(
        `lifecycle stage ${stage} is represented in the demo book`,
        (stageDistribution[stage] ?? 0) > 0,
        `n=${stageDistribution[stage] ?? 0}`,
      );
    }

    // ── Accounts ────────────────────────────────────────────────────────
    const accounts = members.flatMap((m) => m.accounts);
    const categoryDistribution: Record<string, number> = {};
    for (const a of accounts) {
      categoryDistribution[a.category] =
        (categoryDistribution[a.category] ?? 0) + 1;
    }
    process.stdout.write(
      `accounts: ${accounts.length} total, categories ${JSON.stringify(categoryDistribution)}\n\n`,
    );
    check(
      'no negative balances',
      accounts.every((a) => Number(a.balance) >= 0),
    );
    check(
      'cossecClassification not blanket-defaulted to "pass"',
      !(
        accounts.length > 0 &&
        accounts.every((a) => a.cossecClassification === 'pass')
      ),
    );
    check(
      'the book contains loan accounts',
      accounts.some((a) => a.category === 'LOAN'),
    );

    // ── Canonical product taxonomy ──────────────────────────────────────
    // Free-text product labels used to have no path to the product registry,
    // so a member's auto loan could not reach its own PD/LGD. Every seeded
    // account must now carry a canonical code.
    const withoutCode = accounts.filter((a) => a.productCode === null);
    check(
      'every seeded account carries a canonical product code',
      withoutCode.length === 0,
      `uncoded=${withoutCode.length}`,
    );

    const productCounts: Record<string, number> = {};
    for (const a of accounts) {
      const key = a.productCode ?? 'NULL';
      productCounts[key] = (productCounts[key] ?? 0) + 1;
    }
    console.log(`product mix: ${JSON.stringify(productCounts)}`);

    for (const code of [
      'PRESTAMO_AUTO',
      'PRESTAMO_PERSONAL',
      'HIPOTECA',
      'PRESTAMO_COMERCIAL',
    ]) {
      check(
        `product ${code} is represented in the demo book`,
        (productCounts[code] ?? 0) > 0,
        `n=${productCounts[code] ?? 0}`,
      );
    }

    // ── Per-loan lifecycle ──────────────────────────────────────────────
    const loanAccounts = accounts.filter((a) => a.category === 'LOAN');
    const stageCounts: Record<string, number> = {};
    for (const a of loanAccounts) {
      const key = a.loanStage ?? 'NULL';
      stageCounts[key] = (stageCounts[key] ?? 0) + 1;
    }
    console.log(`loan stage distribution: ${JSON.stringify(stageCounts)}`);

    // Every stage the engine can emit must actually appear, or a sales demo
    // shows permanently empty columns — the same failure the ONBOARDING and
    // CHURNED member cohorts were pinned to prevent.
    for (const stage of LOAN_LIFECYCLE_STAGES) {
      check(
        `loan stage ${stage} is represented in the demo book`,
        (stageCounts[stage] ?? 0) > 0,
        `n=${stageCounts[stage] ?? 0}`,
      );
    }

    check(
      'no non-loan account carries a loan lifecycle stage',
      accounts
        .filter((a) => a.category !== 'LOAN')
        .every((a) => a.loanStage === null),
    );

    check(
      'loan stages are not all one constant',
      new Set(loanAccounts.map((a) => a.loanStage)).size > 1,
      `distinct=${new Set(loanAccounts.map((a) => a.loanStage)).size}`,
    );

    // A paid-off loan is the ONE place a zero loan balance is honest.
    const zeroBalanceLoans = loanAccounts.filter(
      (a) => Number(a.balance) === 0,
    );
    check(
      'every zero-balance loan is explicitly PAID_OFF (no phantom zeros)',
      zeroBalanceLoans.every((a) => a.loanStage === 'PAID_OFF'),
      `zeroBalanceLoans=${zeroBalanceLoans.length}`,
    );

    check(
      'original principal is never below the outstanding balance',
      loanAccounts.every(
        (a) =>
          a.originalPrincipal === null ||
          Number(a.originalPrincipal) >= Number(a.balance),
      ),
    );

    // ── Audit trail (KLYTICS Rule 4) ────────────────────────────────────
    check(
      'lifecycle events written',
      members.flatMap((m) => m.lifecycleEvents).length > 0,
      `events=${members.flatMap((m) => m.lifecycleEvents).length}`,
    );

    // ── Determinism ─────────────────────────────────────────────────────
    const fingerprint = (
      rows: {
        memberNumber: string;
        lifecycleStage: string;
        riskScore: number | null;
      }[],
    ) =>
      JSON.stringify(
        rows
          .map(
            (m) =>
              `${m.memberNumber}:${m.lifecycleStage}:${m.riskScore ?? 'null'}`,
          )
          .sort(),
      );
    const before = fingerprint(members);
    await service.seedDemoMembers(VERIFY_INSTITUTION_ID, count);
    const after = fingerprint(
      await prisma.member.findMany({
        where: { institutionId: VERIFY_INSTITUTION_ID },
      }),
    );
    check(
      're-seeding reproduces an identical book (seeded RNG holds)',
      before === after,
    );

    // ── Read paths the UI calls ─────────────────────────────────────────
    const listed = await service.listMembers(VERIFY_INSTITUTION_ID, {});
    const listedRows = (listed as { members?: unknown[] }).members ?? [];
    check(
      'listMembers returns populated rows',
      listedRows.length > 0,
      `rows=${listedRows.length}`,
    );

    const profile = await service.getMemberProfile(
      VERIFY_INSTITUTION_ID,
      members[0].id,
    );
    check(
      'getMemberProfile returns a profile for a seeded member',
      profile !== null,
    );

    // ── Tenant isolation ────────────────────────────────────────────────
    const foreignRows = await prisma.member.count({
      where: { institutionId: EMPTY_INSTITUTION_ID },
    });
    check(
      'a second institution sees none of this book',
      foreignRows === 0,
      `rows=${foreignRows}`,
    );

    summarize('live audit');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`verify-member-360 failed: ${message}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(2);
});
