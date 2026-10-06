#!/usr/bin/env node
/**
 * verify-institution-scope-guard.mjs — CI guard against cross-tenant IDOR
 * regressions on NestJS controllers.
 *
 * Originally locked the floor restored in commit 8f69c148 (the 132-route
 * `:institutionId` sweep). Now generalized into a multi-rule framework so
 * each tenancy root in the platform — currently `Workspace.ownerId` and
 * `OrganizationMember` — is enforced by the same parser through one config
 * entry per root. The filename is kept for git-blame continuity but the
 * scope is the wider "tenant-scope" invariant.
 *
 * One file scan, N rules, each fail-closed. To enforce a new tenancy root
 * (e.g. a future `FirmOwnsClientGuard`), add a `RULES` entry below + a
 * self-test case. No parser changes.
 *
 * Per-rule contract:
 *
 *   (R1) **Canonical param name.** Any path-param naming the rule's
 *        resource must be exactly `:<canonicalParam>`. Variants are
 *        errors — the guard reads `req.params.<canonicalParam>` literally,
 *        so a variant silently bypasses ownership enforcement.
 *
 *   (R2) **Guard required.** Every route whose effective path
 *        (`@Controller(base)` + route decorator) contains
 *        `:<canonicalParam>` must be guarded by the rule's named guard,
 *        either via:
 *          - class-level `@UseGuards(..., GuardName, ...)`
 *            anywhere in the decorator stack above `export class X { ... }`, or
 *          - method-level `@UseGuards(..., GuardName, ...)`
 *            on the route handler itself, or
 *          - a `// verify:tenant-scope-skip — <reason>` comment in the
 *            immediate decorator block above the route handler (the
 *            legacy `// verify:institution-scope-skip` is also accepted
 *            for backward compatibility). The skip is an explicit,
 *            reviewable opt-out for legitimate cross-tenant cases.
 *            The reason MUST be non-empty.
 *
 * Wired into `npm run lint` as `verify:tenant-scope` (alias:
 * `verify:institution-scope`). Standalone via
 * `node scripts/verify-institution-scope-guard.mjs`.
 *
 * Flags:
 *   (none)        scan + report; exit 1 on any violation
 *   --quiet       suppress per-violation detail; final summary only
 *   --self-test   exercise the rules against in-memory fixture cases
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_ROOT = join(ROOT, 'src');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const SELF_TEST = argv.includes('--self-test');

const CONTROLLER_RE = /\.controller\.ts$/;

// ─── Rules: one entry per tenancy root ─────────────────────────────────────
//
// Adding a new rule:
//   1. Append an entry below with the canonical param + guard + variants.
//   2. Add a self-test case that asserts the new rule fires.
//   3. Run `node scripts/verify-institution-scope-guard.mjs` — fix any
//      surfaced gaps in production code OR document them with a skip
//      comment giving the rationale.

// Optional `secondaryParam` field (new in commit 0cf2c87c+): when set, the
// rule fires ONLY if the effective path contains BOTH `:canonicalParam`
// AND `:secondaryParam`. Used by the firm-owns-client rule whose contract
// is a (firmId, institutionId) relationship pair — neither param alone
// implies the relationship guard is required.
//
// KNOWN LIMITATION: skip comments (`// verify:tenant-scope-skip — ...`)
// are rule-agnostic — a skip on a route exempts ALL rules whose
// canonicalParam matches. For routes that legitimately skip one rule but
// require another (e.g. CPA route skips institution-scope but requires
// firm-owns-client), the active guard's presence is what makes the rule
// pass, NOT the skip — but if someone removes the guard, the skip would
// also exempt the new rule. Future: rule-targeted skip syntax
// (`// verify:tenant-scope-skip[rule-id] — ...`). For now: the self-test
// asserts the rule fires correctly when guards are absent, and the spec
// for FirmOwnsClientGuard locks the runtime behavior.

const RULES = [
  {
    id: 'institution-scope',
    canonicalParam: 'institutionId',
    variants: ['instId', 'institution', 'institution_id', 'institutionID'],
    guard: 'InstitutionScopeGuard',
    model: 'Workspace.ownerId',
    docRef:
      'commit 8f69c148 — InstitutionScopeGuard reads req.params.institutionId',
  },
  {
    id: 'org-membership',
    canonicalParam: 'orgId',
    variants: ['organizationId', 'org_id', 'organization_id'],
    guard: 'OrgMembershipGuard',
    model: 'OrganizationMember',
    docRef:
      'docs/security/IDOR_RESIDUAL_AUDIT.md — OrgMembershipGuard reads req.params.orgId',
  },
  {
    id: 'close-cycle-membership',
    canonicalParam: 'cycleId',
    variants: ['cycle_id'],
    guard: 'OrgMembershipGuard',
    model: 'OrganizationMember (1-hop via CloseCycle.organizationId)',
    docRef:
      'docs/security/IDOR_RESIDUAL_AUDIT.md — OrgMembershipGuard 1-hop cycleId resolution',
  },
  {
    id: 'firm-owns-client',
    canonicalParam: 'institutionId',
    secondaryParam: 'firmId',
    variants: [],
    guard: 'FirmOwnsClientGuard',
    model: 'CpaClientRelationship (cpaFirmId, institutionId, removedAt: null)',
    docRef:
      'commit 0cf2c87c — FirmOwnsClientGuard for CPA white-label routes carrying both :firmId AND :institutionId',
  },
];

// ─── Parser ─────────────────────────────────────────────────────────────────
//
// Decorator-aware line walker. NestJS controllers follow a tight syntactic
// shape that we don't need a TS parser for. The walker tracks the most-
// recent run of class-level decorators (between the first decorator and
// `export class X`) and groups method-level decorators into a "block" that
// closes when a non-decorator/non-blank/non-comment line is hit.
//
// `@UseGuards()` may come BEFORE the route decorator (`@Get`) or AFTER —
// both orders are valid NestJS. The block-aware design handles either.

const ROUTE_DECORATOR_RE =
  /^\s*@(Get|Post|Put|Delete|Patch|Sse|All|Head|Options)\s*\(\s*['"`]([^'"`]*)['"`]/;
const USE_GUARDS_RE = /@UseGuards\s*\(([^)]*)\)/;
const CONTROLLER_RE_DECO = /^\s*@Controller\s*\(\s*['"`]([^'"`]*)['"`]/;
const EXPORT_CLASS_RE = /^\s*export\s+(?:abstract\s+)?class\s+\w+/;
// Backward-compat: accept both the new generic skip keyword and the
// legacy institution-specific one.
const SKIP_COMMENT_RE =
  /\/\/\s*verify:(?:tenant-scope-skip|institution-scope-skip)(?:\s*[—\-:]\s*(.+?))?\s*$/;

/**
 * Parse a controller's source text and apply every rule.
 * Pure function over the file text. Returns the set of violations.
 */
export function parseController(text) {
  const lines = text.split('\n');
  const routes = [];
  const errors = [];

  let basePath = '';
  /** Class-level guard identifiers (Set<string> of names inside @UseGuards). */
  const classGuards = new Set();
  let seenClass = false;

  let block = freshBlock();

  function freshBlock() {
    return {
      routeDecorators: [], // [{ line, decorator, routePath }]
      guards: new Set(), // method-level guard identifiers
      skip: null, // { reason, line } from a // verify:*-skip comment
    };
  }

  function flushBlock() {
    if (block.routeDecorators.length === 0) {
      block = freshBlock();
      return;
    }
    for (const rd of block.routeDecorators) {
      routes.push({
        line: rd.line,
        decorator: rd.decorator,
        routePath: rd.routePath,
        effectivePath: joinPath(basePath, rd.routePath),
        methodGuards: new Set(block.guards),
        skip: block.skip,
      });
    }
    block = freshBlock();
  }

  function parseGuardList(guardsListText) {
    // Extract identifier names from inside `@UseGuards(...)`. Tolerates
    // newlines/commas/whitespace and ignores anything that isn't a bare
    // identifier (string literals, decorators with calls, etc.).
    const names = [];
    for (const m of guardsListText.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      names.push(m[1]);
    }
    return names;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (!basePath) {
      const m = CONTROLLER_RE_DECO.exec(raw);
      if (m) basePath = m[1];
    }

    if (!seenClass && EXPORT_CLASS_RE.test(line)) {
      seenClass = true;
      continue;
    }

    if (!seenClass) {
      const useGuardsMatch = USE_GUARDS_RE.exec(raw);
      if (useGuardsMatch) {
        for (const name of parseGuardList(useGuardsMatch[1])) {
          classGuards.add(name);
        }
      }
      continue;
    }

    // Inside class body.
    const useGuardsMatch = USE_GUARDS_RE.exec(raw);
    if (useGuardsMatch) {
      for (const name of parseGuardList(useGuardsMatch[1])) {
        block.guards.add(name);
      }
      continue;
    }

    const skipMatch = SKIP_COMMENT_RE.exec(raw);
    if (skipMatch) {
      const reason = (skipMatch[1] ?? '').trim();
      block.skip = { reason, line: lineNo };
      continue;
    }

    const routeMatch = ROUTE_DECORATOR_RE.exec(raw);
    if (routeMatch) {
      block.routeDecorators.push({
        line: lineNo,
        decorator: routeMatch[1],
        routePath: routeMatch[2],
      });
      continue;
    }

    // Block-keeping lines.
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.startsWith('@')) continue;

    flushBlock();
  }
  flushBlock();

  // R1: scan decorator strings for variant param names across all rules.
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!CONTROLLER_RE_DECO.test(raw) && !ROUTE_DECORATOR_RE.test(raw))
      continue;
    for (const rule of RULES) {
      for (const variant of rule.variants) {
        const variantRe = new RegExp(`:${variant}(?=[/'"\`?]|$)`);
        if (variantRe.test(raw)) {
          errors.push({
            rule: `${rule.id}/R1`,
            line: i + 1,
            message:
              `non-canonical path param ":${variant}" — use ` +
              `":${rule.canonicalParam}" so ${rule.guard} can scope the route ` +
              `(${rule.docRef}). Rename and update the @Param() destructuring.`,
          });
        }
      }
    }
  }

  // R2: per rule, every canonical-param route must be guarded.
  for (const r of routes) {
    for (const rule of RULES) {
      const token = `:${rule.canonicalParam}`;
      if (!r.effectivePath.includes(token)) continue;
      // Two-param rules (e.g. firm-owns-client) require BOTH params in
      // the effective path before the rule applies. Single-param routes
      // shouldn't trigger the guard requirement just because they
      // happen to share the primary canonical param.
      if (
        rule.secondaryParam &&
        !r.effectivePath.includes(`:${rule.secondaryParam}`)
      ) {
        continue;
      }

      const guarded =
        classGuards.has(rule.guard) || r.methodGuards.has(rule.guard);
      if (guarded) continue;

      if (r.skip) {
        if (!r.skip.reason) {
          errors.push({
            rule: `${rule.id}/R2`,
            line: r.line,
            message:
              `@${r.decorator}('${r.routePath}') has a verify:tenant-scope-skip ` +
              `comment but no reason. Format: ` +
              `"// verify:tenant-scope-skip — <why this is safe>". ` +
              `Skip without rationale is not allowed.`,
          });
        }
        continue;
      }
      errors.push({
        rule: `${rule.id}/R2`,
        line: r.line,
        message:
          `@${r.decorator}('${r.routePath}') resolves to effective path ` +
          `"${r.effectivePath}" which contains "${token}" but the controller ` +
          `has no ${rule.guard} (neither class-level above "export class" nor ` +
          `method-level above this route). Add ${rule.guard} to @UseGuards at ` +
          `the class level, or — if the route is cross-tenant by design — add ` +
          `a "// verify:tenant-scope-skip — <reason>" comment.`,
      });
    }
  }

  return { basePath, routes, errors, classGuards };
}

function joinPath(basePath, routePath) {
  const a = basePath.replace(/^\/+|\/+$/g, '');
  const b = routePath.replace(/^\/+|\/+$/g, '');
  if (!a) return `/${b}`;
  if (!b) return `/${a}`;
  return `/${a}/${b}`;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function runSelfTest() {
  const fixtures = [
    {
      name: 'institution-scope: class-level guard on method-path :institutionId — OK',
      text: `
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class AlmController {
  @Get(':institutionId/summary')
  getSummary() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'institution-scope: method-level guard, no class guard — OK',
      text: `
@Controller('api/foo')
export class FooController {
  @UseGuards(AuthGuard, InstitutionScopeGuard)
  @Get(':institutionId/bar')
  bar() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'institution-scope: base-path :institutionId with class guard — OK',
      text: `
@Controller('api/v1/agents/:institutionId')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AgentRunsController {
  @Get('runs')
  list() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'institution-scope: method-path :institutionId with NO guard — R2',
      text: `
@Controller('api/foo')
export class FooController {
  @Get(':institutionId/bar')
  bar() {}
}`,
      expectedErrors: 1,
      expectedRule: 'institution-scope/R2',
    },
    {
      name: 'institution-scope: base-path :institutionId with NO guard — R2',
      text: `
@Controller('api/v2/widgets/:institutionId')
export class WidgetsController {
  @Get('list')
  list() {}
}`,
      expectedErrors: 1,
      expectedRule: 'institution-scope/R2',
    },
    {
      name: 'institution-scope: variant :instId — R1',
      text: `
@Controller('api/foo')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class FooController {
  @Get(':instId/bar')
  bar() {}
}`,
      expectedErrors: 1,
      expectedRule: 'institution-scope/R1',
    },
    {
      name: 'institution-scope: variant :institution_id — R1',
      text: `
@Controller('api/foo')
export class FooController {
  @Get(':institution_id/bar')
  bar() {}
}`,
      // Both R1 (variant name) and R2 (no guard) fire, since "institution_id"
      // does NOT contain ":institutionId" literally so R2 sees the route as
      // unscoped. The variant rename is the real fix; once renamed the
      // controller picks up the missing guard naturally.
      expectedErrors: 1,
      expectedRule: 'institution-scope/R1',
    },
    {
      name: 'no :institutionId / :orgId / :cycleId — no rule fires',
      text: `
@Controller('api/alm')
export class AlmController {
  @Get('treasury/rates')
  treasury() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'org-membership: :orgId guarded by OrgMembershipGuard at class — OK',
      text: `
@Controller('api/close')
@UseGuards(AuthGuard, OrgMembershipGuard)
export class CloseController {
  @Get(':orgId/cycles')
  cycles() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'org-membership: :cycleId guarded (1-hop) — OK',
      text: `
@Controller('api/close')
@UseGuards(AuthGuard, OrgMembershipGuard)
export class CloseController {
  @Post('cycles/:cycleId/sign-off')
  signOff() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'org-membership: :orgId with NO guard — R2',
      text: `
@Controller('api/expenses')
export class ExpensesController {
  @Post(':orgId/upload')
  upload() {}
}`,
      expectedErrors: 1,
      expectedRule: 'org-membership/R2',
    },
    {
      name: 'org-membership: :cycleId with NO guard — R2',
      text: `
@Controller('api/foo')
export class FooController {
  @Get('cycles/:cycleId/items')
  items() {}
}`,
      expectedErrors: 1,
      expectedRule: 'close-cycle-membership/R2',
    },
    {
      name: 'org-membership: variant :organizationId — R1',
      text: `
@Controller('api/foo')
@UseGuards(AuthGuard, OrgMembershipGuard)
export class FooController {
  @Get(':organizationId/bar')
  bar() {}
}`,
      expectedErrors: 1,
      expectedRule: 'org-membership/R1',
    },
    {
      name: 'tenant-scope-skip with reason exempts unguarded :institutionId — OK',
      text: `
@Controller('api/cpa/firms/:firmId')
@UseGuards(AuthGuard, RolesGuard)
export class CpaController {
  // verify:tenant-scope-skip — CPA firms cross tenants via CpaClientRelationship
  @Delete('clients/:institutionId')
  removeClient() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'legacy institution-scope-skip alias also accepted — OK',
      text: `
@Controller('api/cpa/firms/:firmId')
@UseGuards(AuthGuard, RolesGuard)
export class CpaController {
  // verify:institution-scope-skip — legacy keyword still works
  @Delete('clients/:institutionId')
  removeClient() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'tenant-scope-skip without reason still fails — R2',
      text: `
@Controller('api/foo')
export class FooController {
  // verify:tenant-scope-skip
  @Get(':institutionId/bar')
  bar() {}
}`,
      expectedErrors: 1,
      expectedRule: 'institution-scope/R2',
    },
    {
      name: 'skip is one-shot — does not leak to the next route',
      text: `
@Controller('api/foo')
export class FooController {
  // verify:tenant-scope-skip — first route is cross-tenant by design
  @Get(':institutionId/skipped')
  skipped() {}

  @Get(':institutionId/not-skipped')
  notSkipped() {}
}`,
      expectedErrors: 1,
      expectedRule: 'institution-scope/R2',
    },
    {
      name: 'one route satisfies one rule but violates another — both flagged independently',
      text: `
@Controller('api/foo')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class FooController {
  @Get(':institutionId/x/:orgId')
  weird() {}
}`,
      // institutionId is guarded, but orgId is not.
      expectedErrors: 1,
      expectedRule: 'org-membership/R2',
    },
    {
      name: 'firm-owns-client: :firmId + :institutionId with FirmOwnsClientGuard at class — OK',
      text: `
@Controller('api/cpa/firms/:firmId')
@UseGuards(AuthGuard, RolesGuard, FirmOwnsClientGuard)
export class CpaClientController {
  // verify:tenant-scope-skip — CPA cross-tenant, firm-owns-client gate applies
  @Delete('clients/:institutionId')
  removeClient() {}
}`,
      expectedErrors: 0,
    },
    {
      name: 'firm-owns-client: :firmId + :institutionId with NO FirmOwnsClientGuard and NO skip — R2',
      text: `
@Controller('api/cpa/firms/:firmId')
@UseGuards(AuthGuard, RolesGuard)
export class CpaClientController {
  @Delete('clients/:institutionId')
  removeClient() {}
}`,
      // BOTH institution-scope/R2 AND firm-owns-client/R2 fire here —
      // the route has :institutionId (institution-scope cares) AND
      // (:firmId + :institutionId) (firm-owns-client cares). Without a
      // skip comment to exempt institution-scope, the existing rule
      // would catch this independently. Asserting on errors.length=2
      // and that firm-owns-client/R2 is among them.
      expectedErrors: 2,
    },
    {
      name: 'firm-owns-client: :firmId alone (no :institutionId) — rule does NOT fire',
      text: `
@Controller('api/cpa/firms/:firmId')
export class CpaListController {
  @Get('clients')
  listClients() {}
  @Get('dashboard')
  dashboard() {}
}`,
      // No :institutionId in any route → firm-owns-client doesn't apply.
      // No :institutionId / :orgId / :cycleId either → no other rule fires.
      expectedErrors: 0,
    },
  ];

  const failures = [];
  for (const fx of fixtures) {
    const { errors } = parseController(fx.text);
    const ok =
      errors.length === fx.expectedErrors &&
      (fx.expectedRule == null ||
        errors.every((e) => e.rule === fx.expectedRule));
    if (!ok) {
      failures.push(
        `self-test FAIL: ${fx.name}\n` +
          `  expected: ${fx.expectedErrors} error(s)` +
          (fx.expectedRule ? ` of rule ${fx.expectedRule}` : '') +
          `\n` +
          `  got:      ${errors.length} error(s)\n` +
          errors
            .map((e) => `    - ${e.rule} L${e.line}: ${e.message}`)
            .join('\n'),
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(
      `\nverify-institution-scope-guard --self-test: ${failures.length} failure(s)`,
    );
    process.exit(1);
  }
  console.log(
    `verify-institution-scope-guard --self-test: ${fixtures.length} case(s) pass`,
  );
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ─── Walk + check ───────────────────────────────────────────────────────────

function* walkControllers(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkControllers(full);
    else if (entry.isFile() && CONTROLLER_RE.test(entry.name)) yield full;
  }
}

const violations = [];
let scanned = 0;
const perRuleTotals = Object.fromEntries(
  RULES.map((r) => [r.id, { found: 0, guarded: 0 }]),
);

for (const file of walkControllers(SRC_ROOT)) {
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  const { routes, errors, classGuards } = parseController(text);
  const relPath = relative(ROOT, file);

  for (const r of routes) {
    for (const rule of RULES) {
      if (!r.effectivePath.includes(`:${rule.canonicalParam}`)) continue;
      if (
        rule.secondaryParam &&
        !r.effectivePath.includes(`:${rule.secondaryParam}`)
      ) {
        continue;
      }
      perRuleTotals[rule.id].found += 1;
      const guarded =
        classGuards.has(rule.guard) || r.methodGuards.has(rule.guard);
      if (
        guarded ||
        (r.skip && r.skip.reason) ||
        !errors.find((e) => e.rule === `${rule.id}/R2` && e.line === r.line)
      ) {
        perRuleTotals[rule.id].guarded += 1;
      }
    }
  }

  for (const e of errors) {
    violations.push({ file: relPath, ...e });
  }
}

const summaryParts = RULES.map(
  (r) => `${r.id}: ${perRuleTotals[r.id].guarded}/${perRuleTotals[r.id].found}`,
).join(', ');
const summary =
  `verify-institution-scope-guard: ${scanned} controller(s) scanned ` +
  `[${summaryParts}], ${violations.length} violation(s).`;

if (violations.length > 0) {
  if (!QUIET) {
    for (const v of violations) {
      console.error(`error [${v.rule}] ${v.file}:${v.line}`);
      console.error(`  ${v.message}`);
    }
    console.error('');
    console.error('Each violation must be one of:');
    console.error(
      "  • R1: rename the non-canonical path param to its rule's canonical name",
    );
    console.error(
      '  • R2: add the matching guard to @UseGuards at the class or method level',
    );
    console.error(
      '  • Skip: add "// verify:tenant-scope-skip — <rationale>" above the route',
    );
    console.error('');
    console.error('See:');
    console.error('  • commit 8f69c148 — InstitutionScopeGuard');
    console.error(
      '  • docs/security/IDOR_RESIDUAL_AUDIT.md — OrgMembershipGuard',
    );
  }
  console.error(summary);
  process.exit(1);
}

console.log(summary);
process.exit(0);
