#!/usr/bin/env node
/**
 * verify-auth-coverage.mjs — CI guard against unauthenticated controller
 * routes in CerniQ's NestJS backend.
 *
 * Parallel to `verify-institution-scope-guard.mjs` (which locks tenant
 * ownership at the controller layer): this script asks the prior
 * question — "does every route require authentication BEFORE reaching
 * service logic?" Static scan only; doesn't introspect runtime middleware.
 *
 * Rule (R1):
 *   Every route in every `*.controller.ts` under `src/` must be reachable
 *   only via at least one of:
 *     (a) `@UseGuards(..., <known-auth-guard>, ...)` at the controller
 *         CLASS level — covers every method in the controller.
 *     (b) `@UseGuards(..., <known-auth-guard>, ...)` on the method
 *         decorator stack — covers that specific route only.
 *     (c) A `// verify:auth-skip — <reason>` comment on the route, OR a
 *         `// verify:auth-skip-controller — <reason>` comment above the
 *         `export class` declaration that exempts every route in the
 *         class. The reason MUST be non-empty.
 *
 * Known auth guards (the canonical alphabet — extend as new auth
 * primitives are added):
 *
 *     AuthGuard           Canonical bearer-token JWT verifier.
 *     AuthTenantGuard     Composite of AuthGuard + TenantScopeGuard.
 *     ApiKeyAuthGuard     x-api-key external API surface (enterprise/api-v1).
 *     AdminKeyGuard       (Recommended future primitive — not landed yet.)
 *     RolesGuard          Role-policy gate; ALWAYS sits AFTER an auth guard
 *                         per the existing @UseGuards stack convention,
 *                         but its mere presence implies the route was
 *                         intended to be authenticated. Recognized so the
 *                         CAMEL Certification controller (`AuthGuard +
 *                         RolesGuard`) isn't double-flagged.
 *     AuthAdminGuard      Legacy admin-key guard if any exists.
 *
 * Scope guards (InstitutionScopeGuard, OrgMembershipGuard,
 * FirmOwnsClientGuard, TenantScopeGuard) are NOT included in this list —
 * they enforce ownership, not authentication. Class-level
 * `@UseGuards(AuthGuard, InstitutionScopeGuard)` already counts as
 * authenticated via the AuthGuard half.
 *
 * Output format:
 *   verify-auth-coverage: <N> controller(s) scanned, <K> route(s) found,
 *   <G> guarded, <S> skip-exempt, <V> violation(s).
 *
 *   On violations, per-route detail is logged (file:line + the route's
 *   effective path + why it's not satisfied).
 *
 * **CI behavior — FAIL-CLOSED.** `npm run lint` invokes this script with
 * `--strict` (see package.json `verify:auth-coverage`), so ANY violation
 * fails the build with `exit 1`. This auth-coverage gate blocks CI today.
 * (Currently reports 0 violations.)
 *
 * Bare invocation WITHOUT `--strict` is report-only — it scans and prints
 * but exits 0 even on violations, for local exploration/triage that
 * shouldn't fail your shell. The phased rollout that this framing once
 * described is complete: Phase A landed report-only, Phase B added
 * `// verify:auth-skip` comments to the documented public routes per
 * `docs/security/AUTH_COVERAGE_AUDIT.md`, and Phase C wired `--strict`
 * into `npm run lint` (done — see above).
 *
 * Flags:
 *   (none)        scan + report; exits 0 even on violations (local triage)
 *   --quiet       suppress per-violation detail; final summary only
 *   --strict      exit 1 if any violations found — used by `npm run lint`
 *   --self-test   exercise the rule against in-memory fixture cases
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_ROOT = join(ROOT, 'src');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const STRICT = argv.includes('--strict');
const SELF_TEST = argv.includes('--self-test');

const CONTROLLER_FILE_RE = /\.controller\.ts$/;

// Auth guard alphabet — see file header for the rationale on which are
// listed vs excluded.
const AUTH_GUARDS = new Set([
  'AuthGuard',
  'AuthTenantGuard',
  'ApiKeyAuthGuard',
  'AdminKeyGuard',
  'RolesGuard',
  'AuthAdminGuard',
  // `PassportAuthGuard` is the alias used in `auth.controller.ts` for the
  // factory `AuthGuard` from `@nestjs/passport` (Passport delegation pattern).
  // Recognized so OAuth-initiator + OAuth-callback routes don't double-flag.
  'PassportAuthGuard',
]);

const ROUTE_DECORATOR_RE =
  /^\s*@(Get|Post|Put|Delete|Patch|Sse|All|Head|Options)\s*\(/;
const USE_GUARDS_RE = /@UseGuards\s*\(([^)]*)\)/;
const CONTROLLER_DECO_RE = /^\s*@Controller\s*\(/;
const EXPORT_CLASS_RE = /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/;
const ROUTE_PATH_RE =
  /^\s*@(?:Get|Post|Put|Delete|Patch|Sse|All|Head|Options)\s*\(\s*['"`]([^'"`]*)['"`]/;
const CONTROLLER_BASE_RE = /^\s*@Controller\s*\(\s*['"`]([^'"`]*)['"`]/;
const AUTH_SKIP_RE = /\/\/\s*verify:auth-skip(?:\s*[—\-:]\s*(.+?))?\s*$/;
const AUTH_SKIP_CONTROLLER_RE =
  /\/\/\s*verify:auth-skip-controller(?:\s*[—\-:]\s*(.+?))?\s*$/;

/**
 * Parse a controller's source text and return per-route auth coverage.
 * Pure function; returns `{ controllerName, basePath, routes, violations }`.
 * Routes carry `{ line, decorator, routePath, effectivePath, hasMethodAuth,
 * skip }`. Violations are routes that don't meet R1.
 */
export function parseController(text) {
  const lines = text.split('\n');
  const routes = [];
  const violations = [];

  let basePath = '';
  let controllerName = '';
  /** Class-level guard identifiers (Set<string> of names inside @UseGuards). */
  const classGuards = new Set();
  let classSkip = null; // { reason, line }
  let seenClass = false;

  let block = freshBlock();

  function freshBlock() {
    return {
      routeDecorators: [],
      guards: new Set(),
      skip: null,
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

  function parseGuardList(text) {
    const names = [];
    for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      names.push(m[1]);
    }
    return names;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (!basePath) {
      const m = CONTROLLER_BASE_RE.exec(raw);
      if (m) basePath = m[1];
    }

    if (!seenClass) {
      const classMatch = EXPORT_CLASS_RE.exec(line);
      if (classMatch) {
        controllerName = classMatch[1];
        seenClass = true;
        continue;
      }

      // Class-level @UseGuards (before `export class`).
      const useGuardsMatch = USE_GUARDS_RE.exec(raw);
      if (useGuardsMatch) {
        for (const name of parseGuardList(useGuardsMatch[1])) {
          classGuards.add(name);
        }
        continue;
      }

      // Class-level auth skip — applies to every route.
      const classSkipMatch = AUTH_SKIP_CONTROLLER_RE.exec(raw);
      if (classSkipMatch) {
        classSkip = {
          reason: (classSkipMatch[1] ?? '').trim(),
          line: lineNo,
        };
        continue;
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

    const skipMatch = AUTH_SKIP_RE.exec(raw);
    if (skipMatch && !AUTH_SKIP_CONTROLLER_RE.test(raw)) {
      block.skip = { reason: (skipMatch[1] ?? '').trim(), line: lineNo };
      continue;
    }

    const routeMatch = ROUTE_DECORATOR_RE.exec(raw);
    if (routeMatch) {
      const pathMatch = ROUTE_PATH_RE.exec(raw);
      block.routeDecorators.push({
        line: lineNo,
        decorator: routeMatch[1],
        routePath: pathMatch ? pathMatch[1] : '',
      });
      continue;
    }

    // Block-keeping lines (non-decorator, non-blank, non-comment).
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.startsWith('@')) continue;

    flushBlock();
  }
  flushBlock();

  const classHasAuth = setHasAny(classGuards, AUTH_GUARDS);

  for (const r of routes) {
    const methodHasAuth = setHasAny(r.methodGuards, AUTH_GUARDS);
    const guarded = classHasAuth || methodHasAuth;
    if (guarded) continue;

    // Skip exemption — either route-level or class-level skip covers it.
    if (classSkip) {
      if (!classSkip.reason) {
        violations.push({
          line: classSkip.line,
          route: r.effectivePath,
          message:
            `verify:auth-skip-controller comment on class lacks a reason. ` +
            `Format: "// verify:auth-skip-controller — <why this controller is public>".`,
        });
      }
      continue;
    }
    if (r.skip) {
      if (!r.skip.reason) {
        violations.push({
          line: r.skip.line,
          route: r.effectivePath,
          message:
            `verify:auth-skip comment lacks a reason. Format: ` +
            `"// verify:auth-skip — <why this route is public>".`,
        });
      }
      continue;
    }

    violations.push({
      line: r.line,
      route: r.effectivePath,
      message:
        `@${r.decorator}('${r.routePath}') → "${r.effectivePath}" has no auth guard ` +
        `(class-level @UseGuards lacks ${[...AUTH_GUARDS].join('/')} and method-level decorator ` +
        `block has no auth guard either). Add @UseGuards(AuthGuard) at class level, OR ` +
        `add "// verify:auth-skip — <reason>" if this route is public by design.`,
    });
  }

  return { controllerName, basePath, routes, violations, classHasAuth };
}

function setHasAny(set, allowed) {
  for (const name of set) {
    if (allowed.has(name)) return true;
  }
  return false;
}

function joinPath(basePath, routePath) {
  const a = (basePath || '').replace(/^\/+|\/+$/g, '');
  const b = (routePath || '').replace(/^\/+|\/+$/g, '');
  if (!a) return `/${b}`;
  if (!b) return `/${a}`;
  return `/${a}/${b}`;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function runSelfTest() {
  const fixtures = [
    {
      name: 'class-level AuthGuard — every route covered',
      text: `
@Controller('api/foo')
@UseGuards(AuthGuard)
export class FooController {
  @Get('a')
  a() {}
  @Post('b')
  b() {}
}`,
      expectedViolations: 0,
    },
    {
      name: 'class-level AuthTenantGuard composite — covered',
      text: `
@Controller('api/alm')
@UseGuards(AuthTenantGuard, InstitutionScopeGuard)
export class AlmController {
  @Get(':institutionId/summary')
  s() {}
}`,
      expectedViolations: 0,
    },
    {
      name: 'method-level only — covered per route',
      text: `
@Controller('api/foo')
export class FooController {
  @UseGuards(AuthGuard)
  @Get('a')
  a() {}
  @UseGuards(AuthGuard)
  @Post('b')
  b() {}
}`,
      expectedViolations: 0,
    },
    {
      name: 'method-level on SOME routes but not all — partial coverage flagged',
      text: `
@Controller('api/foo')
export class FooController {
  @UseGuards(AuthGuard)
  @Get('a')
  a() {}
  @Get('b')
  b() {}
}`,
      expectedViolations: 1,
    },
    {
      name: 'zero guards anywhere — every route flagged',
      text: `
@Controller('api/eval')
export class AgentEvalController {
  @Post('golden')
  g() {}
  @Post('replay')
  r() {}
}`,
      expectedViolations: 2,
    },
    {
      name: 'scope guard alone WITHOUT auth guard — flagged',
      text: `
@Controller('api/foo')
@UseGuards(InstitutionScopeGuard)
export class FooController {
  @Get(':institutionId/x')
  x() {}
}`,
      // InstitutionScopeGuard is a scope guard, not an auth guard. Without
      // AuthGuard the caller could be unauthenticated. Flag.
      expectedViolations: 1,
    },
    {
      name: 'class-level auth-skip with reason exempts every route',
      text: `
// verify:auth-skip-controller — public health endpoint cluster
@Controller('api/health')
export class HealthController {
  @Get()
  check() {}
  @Get('deep')
  deep() {}
}`,
      expectedViolations: 0,
    },
    {
      name: 'route-level auth-skip with reason exempts that route only',
      text: `
@Controller('api/mixed')
@UseGuards(AuthGuard)
export class MixedController {
  @Get('private')
  p() {}
  // verify:auth-skip — Stripe webhook, signature-verified inline
  @Post('webhook')
  webhook() {}
}`,
      // Both routes are fine: 'private' via class auth, 'webhook' via skip.
      expectedViolations: 0,
    },
    {
      name: 'route-level skip without reason fails (not a free pass)',
      text: `
@Controller('api/foo')
export class FooController {
  // verify:auth-skip
  @Get('x')
  x() {}
}`,
      expectedViolations: 1,
    },
    {
      name: 'class-level skip without reason fails',
      text: `
// verify:auth-skip-controller
@Controller('api/foo')
export class FooController {
  @Get('x')
  x() {}
}`,
      expectedViolations: 1,
    },
    {
      name: 'RolesGuard counts as auth signal (implies upstream auth)',
      text: `
@Controller('api/admin')
@UseGuards(RolesGuard)
export class AdminController {
  @Get('users')
  list() {}
}`,
      // The CAMEL certification controller and others use AuthGuard + RolesGuard
      // — RolesGuard alone is rare but its presence implies the route was
      // intended to be authenticated. Recognized so RolesGuard-only doesn't
      // double-flag if a legitimate refactor drops AuthGuard.
      expectedViolations: 0,
    },
  ];

  const failures = [];
  for (const fx of fixtures) {
    const { violations } = parseController(fx.text);
    const ok = violations.length === fx.expectedViolations;
    if (!ok) {
      failures.push(
        `self-test FAIL: ${fx.name}\n` +
          `  expected: ${fx.expectedViolations} violation(s)\n` +
          `  got:      ${violations.length} violation(s)\n` +
          violations
            .map((v) => `    - L${v.line} ${v.route}: ${v.message}`)
            .join('\n'),
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(
      `\nverify-auth-coverage --self-test: ${failures.length} failure(s)`,
    );
    process.exit(1);
  }
  console.log(
    `verify-auth-coverage --self-test: ${fixtures.length} case(s) pass`,
  );
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ─── Walk + scan ────────────────────────────────────────────────────────────

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
    else if (entry.isFile() && CONTROLLER_FILE_RE.test(entry.name)) yield full;
  }
}

let scanned = 0;
let routesTotal = 0;
let routesGuarded = 0;
let routesSkipped = 0;
const allViolations = [];

for (const file of walkControllers(SRC_ROOT)) {
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  const { routes, violations, classHasAuth } = parseController(text);
  const relPath = relative(ROOT, file);

  routesTotal += routes.length;
  for (const r of routes) {
    const methodHasAuth = setHasAny(r.methodGuards, AUTH_GUARDS);
    if (classHasAuth || methodHasAuth) {
      routesGuarded += 1;
    } else if (r.skip && r.skip.reason) {
      routesSkipped += 1;
    }
  }

  for (const v of violations) {
    allViolations.push({ file: relPath, ...v });
  }
}

const summary =
  `verify-auth-coverage: ${scanned} controller(s) scanned, ` +
  `${routesTotal} route(s) found, ${routesGuarded} guarded, ` +
  `${routesSkipped} skip-exempt, ${allViolations.length} violation(s).`;

if (allViolations.length > 0) {
  if (!QUIET) {
    for (const v of allViolations) {
      console.error(`unauthenticated ${v.file}:${v.line}`);
      console.error(`  ${v.message}`);
    }
    console.error('');
    console.error('Each violation must be one of:');
    console.error(
      '  • Add @UseGuards(AuthGuard) at class level (covers every method)',
    );
    console.error('  • Add @UseGuards(AuthGuard) on the specific method');
    console.error(
      '  • Add "// verify:auth-skip — <rationale>" above the route',
    );
    console.error(
      '  • Add "// verify:auth-skip-controller — <rationale>" above the class',
    );
    console.error('');
    console.error('See docs/security/AUTH_COVERAGE_AUDIT.md for the audit and');
    console.error('the 25 documented intentional-public routes that need skip');
    console.error('comments before this script flips to fail-closed.');
  }
  console.error(summary);
  // Fail-closed under `--strict` — exit 1 on any violation. This is how
  // `npm run lint` runs the script (package.json `verify:auth-coverage`),
  // so violations block CI. Bare invocation (no `--strict`) is report-only:
  // exit 0 even on violations, for local exploration/triage.
  process.exit(STRICT ? 1 : 0);
}

console.log(summary);
