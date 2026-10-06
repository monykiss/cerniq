#!/usr/bin/env node
/**
 * verify-body-trust.mjs — R3, the third side of the IDOR/auth triangle.
 *
 * Parallel to `verify-institution-scope-guard.mjs` (path-param tenancy IDOR)
 * and `verify-auth-coverage.mjs` (authentication coverage). This script
 * asks the body-trust question: "does every handler that parses a
 * tenancy-bearing field from request BODY or QUERY verify the caller
 * owns that tenant before reaching service logic?"
 *
 * The body-IDOR class bit CerniQ five times in the week of 2026-05-15:
 *   - `e88ae20c` ai-advisor body-IDOR closure (institutionId in body)
 *   - `6b73eb24` agents.controller dual-tenant body-IDOR closure
 *   - `2196bbe6` agent-trust body-IDOR closure
 *   - `ff1ce9e4` enterprise createBatch org-membership IDOR
 *   - `cf8c72ac` enterprise 4×batchId-route IDORs (assertBatchAccess)
 *
 * Each time the fix was structural: extract a kernel primitive
 * (verifyOwnership / verifyMembership / assertBatchAccess) and call it
 * BEFORE any service method invocation. R3 makes that discipline
 * verifier-detectable.
 *
 * Rule (R3):
 *   For every controller handler that calls
 *     `parseOrThrow(<Schema>, body | body??{} | query | query??{} | rawQuery | raw)`
 *   where `<Schema>` declares any of the canonical tenancy keys
 *     {institutionId, organizationId, orgId, clientInstitutionId, workspaceId}
 *   as a top-level field, the handler body MUST contain at least one of:
 *     (a) `verifyOwnership(`     — InstitutionScopeGuard kernel primitive
 *     (b) `verifyMembership(`    — OrgMembershipGuard kernel primitive
 *     (c) `assertBatchAccess(`   — EnterpriseController's helper
 *     (d) `assert<Tenancy>Access(` — heuristic for future kernel helpers
 *     (e) `// verify:body-tenancy — <reason>` skip comment with non-empty
 *         reason (escape hatch for documented exceptions)
 *
 * URL path params (`parseOrThrow(Schema, params)`) are NOT flagged —
 * that surface is covered by `verify-institution-scope-guard.mjs`.
 *
 * **CI behavior — FAIL-CLOSED.** `npm run lint` invokes this script with
 * `--strict` (see package.json `verify:body-trust`, wired between
 * `verify:auth-coverage` and the KLYTICS rule verifiers), so ANY
 * body-IDOR violation fails the build with `exit 1`. This gate blocks CI
 * today. (Currently reports 0 violations.)
 *
 * Bare invocation WITHOUT `--strict` is report-only — it scans and prints
 * but exits 0 even on violations, for local exploration/triage. The
 * phased rollout that this framing once described is complete: Phase A
 * landed report-only, Phase B added the skip-comment sweep across
 * documented exceptions, and Phase C wired `--strict` into `npm run lint`
 * (done — see above).
 *
 * Flags:
 *   (none)        scan + report; exits 0 even on violations (local triage)
 *   --quiet       suppress per-violation detail; final summary only
 *   --strict      exit 1 if any violations found — used by `npm run lint`
 *   --self-test   exercise the rule against in-memory fixture cases
 *
 * Skip the script entirely with VERIFY_BODY_TRUST_SKIP=1.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_ROOT = join(ROOT, 'src');

if (process.env.VERIFY_BODY_TRUST_SKIP === '1') {
  console.log('verify-body-trust: skipped (VERIFY_BODY_TRUST_SKIP=1)');
  process.exit(0);
}

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const STRICT = argv.includes('--strict');
const SELF_TEST = argv.includes('--self-test');

// ─── Patterns ──────────────────────────────────────────────────────────────

const TS_FILE_RE = /\.ts$/;
const SPEC_FILE_RE = /\.(spec|test)\.ts$/;
// Entry-point files scanned for handler-level analysis. Includes both HTTP
// controllers (`*.controller.ts`) AND WebSocket gateways (`*.gateway.ts`).
// Gateways accept `@MessageBody()` payloads via `@SubscribeMessage` /
// `@MessageMapping` handlers — the same body-IDOR class as HTTP body
// handlers, just via a different transport. The auth-gate alphabet
// (`verify*Ownership` / `verify*Membership` / `assert*Access`) is shared
// across both surfaces (peer commit `5d2f6637` closed realtime-alm's
// gateway body-trust IDOR using the same primitives that close controller
// body-IDORs).
const ENTRY_FILE_RE = /\.(controller|gateway)\.ts$/;

// Tenancy keys: any of these as a top-level field in a Zod schema marks
// that schema as "tenancy-bearing". Order doesn't matter; this is a set.
const TENANCY_KEYS = new Set([
  'institutionId',
  'organizationId',
  'orgId',
  'clientInstitutionId',
  'workspaceId',
]);

// Sources we DO check: body, query, raw-query aliases. We do NOT check
// `params` — path params are covered by verify-institution-scope-guard.
const FLAGGED_SOURCE_RE =
  /\b(?:body|rawQuery|raw|query|payload|rawBody|input)\b/;
const PARAMS_SOURCE_RE = /\b(?:params|req\.params|request\.params)\b/;

// Schema definition: `export const FooSchema = z.object({ ... })` OR
// `const FooSchema = z.object({ ... })`. We capture the schema name; the
// body of the schema is the lines between the opening `({` and the
// matching close. Heuristic: walk forward until the brace-depth returns
// to zero.
const SCHEMA_DEF_RE =
  /^\s*(?:export\s+)?const\s+(\w+(?:Schema|Dto|Payload|Body|Request|Query))\s*=\s*z\.(?:object|union|discriminatedUnion|intersection)\s*\(/;

// parseOrThrow call pattern (the canonical Zod-parse helper in this
// codebase): `parseOrThrow(SchemaName, body)`. Captures schema name and
// source argument (everything between the comma and closing paren).
const PARSE_ORTHROW_RE =
  /parseOrThrow\s*\(\s*(\w+(?:Schema|Dto|Payload|Body|Request|Query))\s*,\s*([^)]+)\)/;

// Auth-gate call patterns. Any of these in a handler body satisfies R3.
// `verify\w*Ownership` matches both the canonical `verifyOwnership` and the
// tenancy-rooted variants (`verifyWorkspaceOwnership`, future
// `verifyFirmOwnership`, etc.) that share the same kernel-primitive shape.
// Likewise `verify\w*Membership` for org-scoped variants. The bare-name
// patterns are retained for clarity.
const AUTH_GATE_RES = [
  /\bverify\w*Ownership\s*\(/,
  /\bverify\w*Membership\s*\(/,
  /\bassertBatchAccess\s*\(/,
  /\bassert\w*Access\s*\(/,
];

// Skip comment with non-empty reason.
const BODY_TRUST_SKIP_RE =
  /\/\/\s*verify:body-trust-skip(?:\s*[—\-:]\s*(.+?))?\s*$/;

// Controller class marker.
const EXPORT_CLASS_RE = /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/;

// Route decorator (starts a new handler block).
const ROUTE_DECORATOR_RE =
  /^\s*@(Get|Post|Put|Delete|Patch|Sse|All|Head|Options|SubscribeMessage|MessageMapping)\s*\(/;

// Method declaration following decorators.
const METHOD_DECL_RE =
  /^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/;

// ─── Pass 1: tenancy-bearing schema discovery ──────────────────────────────

/**
 * Scan a single .ts file's text for Zod schema definitions, and return
 * a Set of schema names whose body contains at least one tenancy key as
 * a top-level field.
 */
export function findTenancyBearingSchemas(text) {
  const lines = text.split('\n');
  const found = new Set();

  for (let i = 0; i < lines.length; i++) {
    const m = SCHEMA_DEF_RE.exec(lines[i]);
    if (!m) continue;
    const schemaName = m[1];
    const body = sliceSchemaBody(lines, i);
    if (containsTenancyKey(body)) {
      found.add(schemaName);
    }
  }
  return found;
}

function sliceSchemaBody(lines, startIdx) {
  // Walk forward from `z.object(...)` line, accumulating until brace-depth
  // returns to 0. Naive but adequate for well-formatted Zod schemas.
  let depth = 0;
  let started = false;
  const collected = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '(' || ch === '{') {
        depth++;
        started = true;
      } else if (ch === ')' || ch === '}') {
        depth--;
      }
    }
    collected.push(line);
    if (started && depth === 0) break;
  }
  return collected.join('\n');
}

function containsTenancyKey(schemaBody) {
  // Look for `<tenancyKey>: z.` patterns. Avoid matching identifiers
  // that happen to contain the key as a substring.
  for (const key of TENANCY_KEYS) {
    const re = new RegExp(`(^|\\s|\\{|,)${key}\\s*:\\s*z\\.`, 'm');
    if (re.test(schemaBody)) return true;
  }
  return false;
}

// ─── Pass 2: controller handler analysis ────────────────────────────────────

/**
 * Parse a controller's source text and return per-handler R3 verdicts.
 * Returns `{ controllerName, handlers, violations }`. A handler is a method
 * with one or more route decorators. Violations are handlers that parse a
 * tenancy-bearing schema from body/query without an auth gate or a skip.
 */
export function parseController(text, tenancyBearingSchemas) {
  const lines = text.split('\n');
  let controllerName = '';
  let inClass = false;
  let classDepth = 0;

  const handlers = [];
  const violations = [];

  // Pre-scan for skip comments. Skip comments sit ABOVE the route
  // decorator, not inside the method body, so we collect their line
  // numbers and reasons up front and bind each block to the nearest
  // preceding skip comment within `SKIP_LOOKBACK` lines.
  const SKIP_LOOKBACK = 6;
  const skipComments = []; // [{ line, reason }]
  for (let i = 0; i < lines.length; i++) {
    const m = BODY_TRUST_SKIP_RE.exec(lines[i]);
    if (m && m[1] && m[1].trim().length > 0) {
      skipComments.push({ line: i + 1, reason: m[1].trim() });
    }
  }
  function hasNearbySkip(blockStartLine) {
    for (const sc of skipComments) {
      if (
        sc.line < blockStartLine &&
        sc.line >= blockStartLine - SKIP_LOOKBACK
      ) {
        return true;
      }
    }
    return false;
  }

  // Block tracking: a "handler block" starts at the first decorator and
  // runs through the method body (collected via brace-depth).
  let currentBlock = null;

  function freshBlock(lineNo) {
    return {
      startLine: lineNo,
      methodLine: 0,
      methodName: '',
      decoratorLines: [],
      bodyText: '',
      hasRouteDecorator: false,
    };
  }

  function finalizeBlock(block) {
    if (!block || !block.hasRouteDecorator) return;
    handlers.push(block);

    const tenancyParse = findTenancyParseCall(
      block.bodyText,
      tenancyBearingSchemas,
    );
    if (!tenancyParse) return;

    if (
      hasAuthGate(block.bodyText) ||
      hasSkipComment(block.bodyText) ||
      hasNearbySkip(block.startLine)
    ) {
      return;
    }

    violations.push({
      line: block.methodLine || block.startLine,
      handler: block.methodName,
      schema: tenancyParse.schemaName,
      source: tenancyParse.source.trim(),
      message:
        `handler \`${block.methodName}\` parses tenancy-bearing schema ` +
        `\`${tenancyParse.schemaName}\` from \`${tenancyParse.source.trim()}\` ` +
        `without an auth gate (verifyOwnership / verifyMembership / ` +
        `assertBatchAccess / assert*Access) and without a ` +
        `\`// verify:body-trust-skip — <reason>\` comment.`,
    });
  }

  // Walk line by line.
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (!inClass) {
      const cm = EXPORT_CLASS_RE.exec(line);
      if (cm) {
        controllerName = cm[1];
        inClass = true;
        classDepth = 0;
        // Count braces on the class-declaration line itself — typical
        // shape is `export class Foo {` with a `{` we'd otherwise miss
        // when `continue`-ing.
        for (let c = 0; c < raw.length; c++) {
          if (raw[c] === '{') classDepth++;
          else if (raw[c] === '}') classDepth--;
        }
      }
      continue;
    }

    // Track class brace depth (rough).
    for (let c = 0; c < raw.length; c++) {
      if (raw[c] === '{') classDepth++;
      else if (raw[c] === '}') classDepth--;
    }
    if (classDepth <= 0 && inClass) {
      // Could be end-of-class; flush any pending block.
      if (currentBlock) {
        finalizeBlock(currentBlock);
        currentBlock = null;
      }
      // Don't break — there may be additional exported classes.
      inClass = classDepth > 0;
      continue;
    }

    // Start a new block on first decorator after the prior method ended.
    if (line.startsWith('@')) {
      if (!currentBlock) currentBlock = freshBlock(lineNo);
      currentBlock.decoratorLines.push({ line: lineNo, text: raw });
      if (ROUTE_DECORATOR_RE.test(raw)) {
        currentBlock.hasRouteDecorator = true;
      }
      continue;
    }

    // Method declaration after decorators.
    if (currentBlock && currentBlock.decoratorLines.length > 0) {
      const md = METHOD_DECL_RE.exec(raw);
      if (md) {
        currentBlock.methodLine = lineNo;
        currentBlock.methodName = md[1];
        // Collect body until the matching close brace.
        const body = collectMethodBody(lines, i);
        currentBlock.bodyText = body;
        finalizeBlock(currentBlock);
        currentBlock = null;
        continue;
      }
    }

    // Reset on non-decorator/non-method statement before reaching method
    // (e.g., constructor, property — skip; can't be a handler).
    if (
      currentBlock &&
      currentBlock.decoratorLines.length === 0 &&
      line &&
      !line.startsWith('//') &&
      !line.startsWith('*')
    ) {
      currentBlock = null;
    }
  }

  // Flush trailing block.
  if (currentBlock) finalizeBlock(currentBlock);

  return { controllerName, handlers, violations };
}

function collectMethodBody(lines, startIdx) {
  // Walk forward from method declaration line until brace-depth returns
  // to zero. Heuristic; handles typical NestJS handler shapes.
  let depth = 0;
  let started = false;
  const collected = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    collected.push(line);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (started && depth <= 0) break;
  }
  return collected.join('\n');
}

function findTenancyParseCall(bodyText, tenancyBearingSchemas) {
  // Find all Zod-parse calls and return the first one whose schema is
  // tenancy-bearing AND whose source argument is body/query/payload
  // (not params). Three idioms are recognized:
  //   (a) `parseOrThrow(SchemaName, source)`  — controller convention
  //   (b) `SchemaName.safeParse(source)`      — WS gateway convention
  //   (c) `SchemaName.parse(source)`          — direct Zod parse
  // All three resolve to the same authorization question: did we just
  // accept a tenancy-bearing payload from an untrusted entry point?
  const patterns = [
    /parseOrThrow\s*\(\s*(\w+(?:Schema|Dto|Payload|Body|Request|Query))\s*,\s*([^)]+)\)/g,
    /\b(\w+(?:Schema|Dto|Payload|Body|Request|Query))\.safeParse\s*\(\s*([^)]+)\)/g,
    /\b(\w+(?:Schema|Dto|Payload|Body|Request|Query))\.parse\s*\(\s*([^)]+)\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of bodyText.matchAll(pattern)) {
      const schemaName = m[1];
      const source = m[2];
      if (!tenancyBearingSchemas.has(schemaName)) continue;
      if (PARAMS_SOURCE_RE.test(source)) continue;
      if (FLAGGED_SOURCE_RE.test(source)) {
        return { schemaName, source };
      }
    }
  }
  return null;
}

function hasAuthGate(bodyText) {
  for (const re of AUTH_GATE_RES) {
    if (re.test(bodyText)) return true;
  }
  return false;
}

function hasSkipComment(bodyText) {
  for (const line of bodyText.split('\n')) {
    const m = BODY_TRUST_SKIP_RE.exec(line);
    if (m && m[1] && m[1].trim().length > 0) return true;
  }
  return false;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function runSelfTest() {
  const fixtures = [
    {
      name: 'tenancy schema + verifyOwnership before service — PASS',
      schemas: new Set(['RunBodySchema']),
      controller: `
@Controller('agents')
export class AgentsController {
  @Post('run')
  async run(@Body() raw: unknown) {
    const body = parseOrThrow(RunBodySchema, raw);
    await this.scope.verifyOwnership(body.institutionId, userId, false);
    return this.runner.run(body);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'tenancy schema + NO auth gate — VIOLATION',
      schemas: new Set(['RunBodySchema']),
      controller: `
@Controller('agents')
export class AgentsController {
  @Post('run')
  async run(@Body() raw: unknown) {
    const body = parseOrThrow(RunBodySchema, raw);
    return this.runner.run(body);
  }
}`,
      expectedViolations: 1,
    },
    {
      name: 'tenancy schema + skip comment with reason — PASS',
      schemas: new Set(['RunBodySchema']),
      controller: `
@Controller('agents')
export class AgentsController {
  // verify:body-trust-skip — internal cron-only handler; runner asserts ownership downstream
  @Post('run')
  async run(@Body() raw: unknown) {
    const body = parseOrThrow(RunBodySchema, raw);
    return this.runner.run(body);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'tenancy schema + EMPTY skip reason — VIOLATION',
      schemas: new Set(['RunBodySchema']),
      controller: `
@Controller('agents')
export class AgentsController {
  // verify:body-trust-skip
  @Post('run')
  async run(@Body() raw: unknown) {
    const body = parseOrThrow(RunBodySchema, raw);
    return this.runner.run(body);
  }
}`,
      expectedViolations: 1,
    },
    {
      name: 'non-tenancy schema + no auth gate — NOT flagged',
      schemas: new Set(),
      controller: `
@Controller('feedback')
export class FeedbackController {
  @Post('nps')
  async addNps(@Body() raw: unknown) {
    const body = parseOrThrow(NpsBodySchema, raw);
    return this.feedback.record(body);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'tenancy schema from PARAMS (URL path) — NOT flagged (covered elsewhere)',
      schemas: new Set(['InstitutionIdParamSchema']),
      controller: `
@Controller('exam-prep')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class ExamPrepController {
  @Get(':institutionId/summary')
  async summary(@Param() params: unknown) {
    const { institutionId } = parseOrThrow(InstitutionIdParamSchema, params);
    return this.service.summary(institutionId);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'tenancy schema + verifyMembership — PASS',
      schemas: new Set(['CreateBatchBodySchema']),
      controller: `
@Controller('enterprise')
export class EnterpriseController {
  @Post('batches')
  async createBatch(@Body() raw: unknown) {
    const dto = parseOrThrow(CreateBatchBodySchema, raw);
    await this.orgMembership.verifyMembership(dto.organizationId, req.apiUser.userId, false);
    return this.batchService.createBatch(dto);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'tenancy schema + assertBatchAccess — PASS',
      schemas: new Set(['BatchIdBodySchema']),
      controller: `
@Controller('enterprise')
export class EnterpriseController {
  @Post('batches/cancel')
  async cancel(@Body() raw: unknown) {
    const { organizationId, batchId } = parseOrThrow(BatchIdBodySchema, raw);
    await this.assertBatchAccess(batchId, req);
    return this.batchService.cancel(batchId);
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'two route decorators on one handler — counted once',
      schemas: new Set(['DualRouteSchema']),
      controller: `
@Controller('legacy')
export class LegacyController {
  @Post('foo')
  @Post('foo/v2')
  async handle(@Body() raw: unknown) {
    const body = parseOrThrow(DualRouteSchema, raw);
    return this.svc.do(body);
  }
}`,
      expectedViolations: 1,
    },
    // ─── WebSocket gateway fixtures (R3 v2 extension to *.gateway.ts) ────
    // Gateways use `Schema.safeParse(payload)` rather than the controller-
    // canonical `parseOrThrow(Schema, body)`. Same auth-gate alphabet.
    {
      name: 'WS @SubscribeMessage handler + safeParse + verifyOwnership — PASS',
      schemas: new Set(['SubscribePayloadSchema']),
      controller: `
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway {
  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: any, @MessageBody() payload: unknown) {
    const parsed = SubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) return { ok: false };
    await this.scope.verifyOwnership(parsed.data.institutionId, client.data.user.userId, false);
    client.join('inst:' + parsed.data.institutionId);
    return { ok: true };
  }
}`,
      expectedViolations: 0,
    },
    {
      name: 'WS handler with safeParse but NO auth gate — VIOLATION',
      schemas: new Set(['SubscribePayloadSchema']),
      controller: `
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway {
  @SubscribeMessage('subscribe')
  async subscribe(@MessageBody() payload: unknown) {
    const parsed = SubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) return { ok: false };
    client.join('inst:' + parsed.data.institutionId);
    return { ok: true };
  }
}`,
      expectedViolations: 1,
    },
    {
      name: 'WS handler with direct Schema.parse(payload) + verifyMembership — PASS',
      schemas: new Set(['AskPayloadSchema']),
      controller: `
@WebSocketGateway({ namespace: '/advisor' })
export class AiAdvisorGateway {
  @SubscribeMessage('ask')
  async ask(@MessageBody() payload: unknown) {
    const data = AskPayloadSchema.parse(payload);
    await this.orgMembership.verifyMembership(data.organizationId, this.currentUserId, false);
    return this.advisor.ask(data);
  }
}`,
      expectedViolations: 0,
    },
  ];

  const failures = [];
  for (const fx of fixtures) {
    const { violations } = parseController(fx.controller, fx.schemas);
    const ok = violations.length === fx.expectedViolations;
    if (!ok) {
      failures.push(
        `self-test FAIL: ${fx.name}\n` +
          `  expected: ${fx.expectedViolations} violation(s)\n` +
          `  got:      ${violations.length} violation(s)\n` +
          violations
            .map((v) => `    - L${v.line} ${v.handler}: ${v.message}`)
            .join('\n'),
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(
      `\nverify-body-trust --self-test: ${failures.length} failure(s)`,
    );
    process.exit(1);
  }
  console.log(`verify-body-trust --self-test: ${fixtures.length} case(s) pass`);
  process.exit(0);
}

if (SELF_TEST) runSelfTest();

// ─── Walk + scan ────────────────────────────────────────────────────────────

function* walkFiles(dir, predicate) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full, predicate);
    else if (entry.isFile() && predicate(entry.name)) yield full;
  }
}

// Pass 1: build the global set of tenancy-bearing schema names by
// walking all .ts files (NOT just .dto.ts — schemas can live inline in
// controllers too, e.g., agent-eval.controller.ts).
const tenancyBearingSchemas = new Set();
for (const file of walkFiles(
  SRC_ROOT,
  (n) => TS_FILE_RE.test(n) && !SPEC_FILE_RE.test(n),
)) {
  const text = readFileSync(file, 'utf8');
  for (const name of findTenancyBearingSchemas(text)) {
    tenancyBearingSchemas.add(name);
  }
}

// Pass 2: walk controllers, flag handlers.
let scanned = 0;
let handlersTotal = 0;
let handlersFlagged = 0;
const allViolations = [];

for (const file of walkFiles(
  SRC_ROOT,
  (n) => ENTRY_FILE_RE.test(n) && !SPEC_FILE_RE.test(n),
)) {
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  const { handlers, violations } = parseController(text, tenancyBearingSchemas);
  const relPath = relative(ROOT, file);

  handlersTotal += handlers.length;
  for (const v of violations) {
    handlersFlagged += 1;
    allViolations.push({ file: relPath, ...v });
  }
}

const summary =
  `verify-body-trust: ${scanned} controller(s) scanned, ` +
  `${handlersTotal} handler(s) found, ${tenancyBearingSchemas.size} tenancy-bearing schema(s), ` +
  `${allViolations.length} violation(s).`;

if (allViolations.length > 0) {
  if (!QUIET) {
    for (const v of allViolations) {
      console.error(`unverified-body-tenancy ${v.file}:${v.line}`);
      console.error(`  ${v.message}`);
    }
    console.error('');
    console.error('Each violation must be one of:');
    console.error(
      '  • Add `await this.scope.verifyOwnership(institutionId, userId, isPlatformAdmin)` before the service call',
    );
    console.error(
      '  • Add `await this.orgMembership.verifyMembership(orgId, userId, isPlatformAdmin)` before the service call',
    );
    console.error(
      '  • Add `await this.assertBatchAccess(batchId, req)` or equivalent assert*Access helper',
    );
    console.error(
      '  • Add `// verify:body-trust-skip — <rationale>` above the route if this handler is intentionally exempt',
    );
    console.error('');
    console.error(
      'See docs/security/AUTH_COVERAGE_AUDIT.md "Critical Findings" section for the',
    );
    console.error(
      'documented body-IDOR closures (e88ae20c / 6b73eb24 / 2196bbe6 / ff1ce9e4 / cf8c72ac).',
    );
  }
  console.error(summary);
  // Fail-closed under `--strict` — exit 1 on any violation. This is how
  // `npm run lint` runs the script (package.json `verify:body-trust`),
  // so violations block CI. Bare invocation (no `--strict`) is report-only:
  // exit 0 even on violations, for local exploration/triage.
  process.exit(STRICT ? 1 : 0);
}

console.log(summary);
