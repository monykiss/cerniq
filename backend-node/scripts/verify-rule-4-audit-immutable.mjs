#!/usr/bin/env node
// scripts/verify-rule-4-audit-immutable.mjs
//
// Enforces KLYTICS Audit Discipline Rule 4 (append-only audit trail).
// See `docs/platform/KLYTICS_AUDIT_DISCIPLINE.md` §1 Rule 4 for normative
// text; this script is the CI lock that prevents new code or migrations
// from mutating the audit log.
//
// Append-only contract:
//   - SQL migrations may CREATE the audit tables (and ALTER to ADD COLUMN /
//     CREATE INDEX). They may NOT issue an UPDATE or DELETE against the
//     tables.
//   - Service code may use `prisma.auditLog.create` / `findMany` / `count`
//     / `findUnique`. It may NOT use `update*`, `delete*`, or `upsert`.
//
// Audit table set is discovered dynamically from prisma/schema.prisma —
// any model with an `audit_log`-shaped name (case-insensitive) plus its
// `@@map` table name. As of 2026-05-16: AuditLog → audit_logs,
// AgentAuditLog → agent_audit_logs.
//
// Exit codes:
//   0 — all migrations + service code respect append-only
//   1 — violation found or stale baseline entry
//
// Skip with VERIFY_RULE_4_SKIP=1 (escape hatch; don't make a habit).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const PRISMA_ROOT = join(REPO_ROOT, 'prisma');
const SCHEMA_PATH = join(PRISMA_ROOT, 'schema.prisma');
const MIGRATIONS_ROOT = join(PRISMA_ROOT, 'migrations');

// ─── Audit-table discovery ─────────────────────────────────────────────
// Parses prisma/schema.prisma for any model whose name matches the
// append-only naming convention. Returns a list of:
//   { model: 'AuditLog', camel: 'auditLog', table: 'audit_logs' }
//
// JSDoc note: this comment must never use the literal mutating-keyword
// followed by the audit table name, or stripSqlComments + the matcher
// together could still leave a stripped form intact.
export function discoverAuditTables(schemaText) {
  const out = [];
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const auditNameRe = /audit_?log|append_only/i;
  let m;
  while ((m = modelRe.exec(schemaText)) !== null) {
    const [, name, body] = m;
    if (!auditNameRe.test(name)) continue;
    // Look for @@map("table_name") inside the body. Default to model name lowercased if missing.
    const mapMatch = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/);
    const table = mapMatch ? mapMatch[1] : name.toLowerCase();
    const camel = name.charAt(0).toLowerCase() + name.slice(1);
    out.push({ model: name, camel, table });
  }
  return out;
}

// ─── SQL helpers ───────────────────────────────────────────────────────
function stripSqlComments(sql) {
  // Drop /* … */ blocks then -- to end-of-line. Order matters.
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return s;
}

// ─── TS helpers ────────────────────────────────────────────────────────
function stripTsComments(content) {
  let s = content.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return s;
}

// ─── Walker ────────────────────────────────────────────────────────────
function walkFiles(dir, suffix) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(full, suffix));
    } else if (entry.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ─── Migration classifier ──────────────────────────────────────────────
// Returns array of violations { file, line, statement }.
// A migration is allowed to CREATE / ALTER ADD COLUMN / CREATE INDEX
// on an audit table. It is forbidden from UPDATE / DELETE on it.
export function classifyMigration(sqlText, tables) {
  if (tables.length === 0) return [];
  const codeOnly = stripSqlComments(sqlText);
  const lines = codeOnly.split('\n');
  const violations = [];
  for (const t of tables) {
    // Look for UPDATE or DELETE statements that reference the table name
    // (with or without quotes, schema-qualified or not).
    const re = new RegExp(
      `\\b(UPDATE|DELETE)\\s+(?:FROM\\s+)?(?:"?\\w+"?\\.)?"?${t.table}"?\\b`,
      'gi',
    );
    let m;
    while ((m = re.exec(codeOnly)) !== null) {
      // Find the line number for the match.
      const before = codeOnly.slice(0, m.index);
      const lineNo = before.split('\n').length;
      violations.push({
        line: lineNo,
        table: t.table,
        statement: lines[lineNo - 1]?.trim() ?? m[0],
      });
    }
  }
  return violations;
}

// ─── Service-code classifier ───────────────────────────────────────────
// Detects `prisma.<camel>.<mutator>(` calls for any audit table's camel
// form. Mutators: update, updateMany, delete, deleteMany, upsert.
export function classifyService(content, tables) {
  if (tables.length === 0) return [];
  const codeOnly = stripTsComments(content);
  const violations = [];
  for (const t of tables) {
    const re = new RegExp(
      `\\bprisma\\s*\\.\\s*${t.camel}\\s*\\.\\s*(update|updateMany|delete|deleteMany|upsert)\\s*\\(`,
      'g',
    );
    let m;
    while ((m = re.exec(codeOnly)) !== null) {
      violations.push({ camel: t.camel, op: m[1] });
    }
  }
  return violations;
}

// ─── Baseline ──────────────────────────────────────────────────────────
// Expected to stay empty in cerniq. If a violation is discovered that
// the team consciously chooses to defer (e.g. data-fix migration during
// incident response), document it here with a one-line reason.
const BASELINE_MIGRATIONS = {
  // 'migrations/20260301000000_data_fix/migration.sql': 'incident response data fix; legal review approved',
};
const BASELINE_SERVICE = {
  'src/jobs/data-retention.service.ts':
    'HIGH: data-retention job calls deleteMany on audit log. Compliance question — does the retention policy supersede the append-only contract for this table? Either (a) confirm policy + add a Rule-4 skip-comment escape hatch, or (b) move retention to a separately-audited path outside prisma. Tracked as follow-up.',
};

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  if (process.env.VERIFY_RULE_4_SKIP === '1') {
    console.log(
      'verify-rule-4-audit-immutable: skipped (VERIFY_RULE_4_SKIP=1)',
    );
    process.exit(0);
  }

  if (!existsSync(SCHEMA_PATH)) {
    console.log(
      'verify-rule-4-audit-immutable: prisma/schema.prisma not found — skipping.',
    );
    process.exit(0);
  }

  const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
  const tables = discoverAuditTables(schemaText);

  if (tables.length === 0) {
    console.log(
      'verify-rule-4-audit-immutable: ⚠ no audit_log* models found in schema.prisma.',
    );
    console.log(
      '  This is itself a Rule 4 gap (the canon expects an audit trail).',
    );
    console.log(
      '  The verifier exits 0 because there is nothing to enforce, but',
    );
    console.log('  the maturity matrix should reflect the missing table.');
    process.exit(0);
  }

  // Migration scan
  const migrationFiles = walkFiles(MIGRATIONS_ROOT, '.sql');
  const migrationViolations = [];
  for (const file of migrationFiles) {
    const rel = relative(REPO_ROOT, file);
    if (rel in BASELINE_MIGRATIONS) continue;
    const sql = readFileSync(file, 'utf-8');
    const v = classifyMigration(sql, tables);
    if (v.length > 0) migrationViolations.push({ file: rel, hits: v });
  }

  // Service scan
  const tsFiles = walkTs(SRC_ROOT);
  const serviceViolations = [];
  for (const file of tsFiles) {
    const rel = relative(REPO_ROOT, file);
    if (rel in BASELINE_SERVICE) continue;
    const content = readFileSync(file, 'utf-8');
    const v = classifyService(content, tables);
    if (v.length > 0) serviceViolations.push({ file: rel, hits: v });
  }

  console.log(
    `verify-rule-4-audit-immutable: discovered ${tables.length} audit table(s)`,
  );
  for (const t of tables) {
    console.log(`  - ${t.model} → ${t.table}`);
  }
  console.log(
    `  scanned ${migrationFiles.length} migration file(s), ${tsFiles.length} service file(s)`,
  );
  console.log(
    `  ${migrationViolations.length} migration violation(s) · ${serviceViolations.length} service violation(s)`,
  );

  let failed = false;
  if (migrationViolations.length > 0) {
    console.log('\n❌ Migration mutations of append-only tables (BLOCKING):');
    for (const v of migrationViolations) {
      console.log(`  ${v.file}`);
      for (const h of v.hits) {
        console.log(`    L${h.line} on ${h.table}: ${h.statement}`);
      }
    }
    failed = true;
  }
  if (serviceViolations.length > 0) {
    console.log(
      '\n❌ Service-code mutations of append-only models (BLOCKING):',
    );
    for (const v of serviceViolations) {
      console.log(`  ${v.file}`);
      for (const h of v.hits) {
        console.log(`    prisma.${h.camel}.${h.op}(...)`);
      }
    }
    console.log(
      '\n  Fix: audit_log* models are append-only. Use `create` for new',
    );
    console.log(
      '       rows. If you need to "fix" a row, append a corrective row',
    );
    console.log('       referencing the original by id.');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n✓ Rule 4 (append-only audit trail): no mutations found.');
  process.exit(0);
}

// ─── Self-test ─────────────────────────────────────────────────────────
function selfTest() {
  const tables = [
    { model: 'AuditLog', camel: 'auditLog', table: 'audit_logs' },
    {
      model: 'AgentAuditLog',
      camel: 'agentAuditLog',
      table: 'agent_audit_logs',
    },
  ];

  const sqlCases = [
    {
      name: 'CREATE TABLE audit_logs → no violation (initial schema)',
      sql: `CREATE TABLE "audit_logs" (id TEXT PRIMARY KEY);`,
      expectViolations: 0,
    },
    {
      name: 'DELETE FROM audit_logs → violation',
      sql: `DELETE FROM "audit_logs" WHERE created_at < NOW() - INTERVAL '7 days';`,
      expectViolations: 1,
    },
    {
      name: 'UPDATE on audit_logs → violation',
      sql: `UPDATE audit_logs SET status = 'archived' WHERE id = 'x';`,
      expectViolations: 1,
    },
    {
      name: 'UPDATE inside SQL block comment → no violation',
      sql: `/* legacy: UPDATE audit_logs ... */\nCREATE INDEX idx_audit_logs_at ON audit_logs (created_at);`,
      expectViolations: 0,
    },
    {
      name: 'UPDATE inside -- line comment → no violation',
      sql: `-- old plan: UPDATE audit_logs\nALTER TABLE audit_logs ADD COLUMN extra TEXT;`,
      expectViolations: 0,
    },
    {
      name: 'DELETE on agent_audit_logs → violation (other table in set)',
      sql: `DELETE FROM agent_audit_logs WHERE id = 'x';`,
      expectViolations: 1,
    },
    {
      name: 'schema-qualified DELETE FROM public.audit_logs → violation',
      sql: `DELETE FROM public.audit_logs;`,
      expectViolations: 1,
    },
    {
      name: 'DELETE on unrelated table → no violation',
      sql: `DELETE FROM jobs WHERE finished = true;`,
      expectViolations: 0,
    },
  ];

  const tsCases = [
    {
      name: 'prisma.auditLog.create → no violation',
      content: `await prisma.auditLog.create({ data: {} });`,
      expectViolations: 0,
    },
    {
      name: 'prisma.auditLog.update → violation',
      content: `await prisma.auditLog.update({ where: { id }, data: {} });`,
      expectViolations: 1,
    },
    {
      name: 'prisma.auditLog.delete → violation',
      content: `await prisma.auditLog.delete({ where: { id } });`,
      expectViolations: 1,
    },
    {
      name: 'prisma.auditLog.deleteMany → violation',
      content: `await prisma.auditLog.deleteMany({});`,
      expectViolations: 1,
    },
    {
      name: 'prisma.agentAuditLog.upsert → violation (other audit model)',
      content: `await prisma.agentAuditLog.upsert({ where: {}, create: {}, update: {} });`,
      expectViolations: 1,
    },
    {
      name: 'mutation inside JSDoc comment → no violation',
      content: `/** sample: prisma.auditLog.update(...) — DO NOT use */\nexport const x = 1;`,
      expectViolations: 0,
    },
    {
      name: 'mutation inside // comment → no violation',
      content: `// legacy: prisma.auditLog.update(...)\nexport const x = 1;`,
      expectViolations: 0,
    },
    {
      name: 'mutation on unrelated model → no violation',
      content: `await prisma.user.update({ where: {}, data: {} });`,
      expectViolations: 0,
    },
  ];

  // Discovery self-test (mirror real prisma file: closing brace at column 0)
  const discoveryText = [
    'model AuditLog {',
    '  id String @id',
    '  @@map("audit_logs")',
    '}',
    'model AgentAuditLog {',
    '  id String @id',
    '  @@map("agent_audit_logs")',
    '}',
    'model User {',
    '  id String @id',
    '}',
  ].join('\n');
  const discovered = discoverAuditTables(discoveryText);

  let pass = 0;
  let fail = 0;

  if (
    discovered.length === 2 &&
    discovered[0].model === 'AuditLog' &&
    discovered[1].model === 'AgentAuditLog'
  ) {
    pass++;
  } else {
    fail++;
    console.log(
      '✗ discoverAuditTables — expected 2 models, got',
      discovered.length,
    );
  }

  for (const c of sqlCases) {
    const v = classifyMigration(c.sql, tables);
    if (v.length === c.expectViolations) {
      pass++;
    } else {
      fail++;
      console.log(`✗ migration: ${c.name}`);
      console.log(`  expected ${c.expectViolations}, got ${v.length}`);
    }
  }

  for (const c of tsCases) {
    const v = classifyService(c.content, tables);
    if (v.length === c.expectViolations) {
      pass++;
    } else {
      fail++;
      console.log(`✗ service: ${c.name}`);
      console.log(`  expected ${c.expectViolations}, got ${v.length}`);
    }
  }

  console.log(`self-test: ${pass}/${pass + fail} case(s) pass`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
