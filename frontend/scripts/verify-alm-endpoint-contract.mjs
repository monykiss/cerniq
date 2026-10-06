#!/usr/bin/env node
/**
 * Gate: every ALM registry `endpoint` must resolve to a real backend route
 * that the panel can actually reach.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-14 a production sweep found 12 ALM panels returning data-layer
 * 404s. Each page rendered HTTP 200 — they are client-rendered — so every
 * existing check passed while the panels were dead on screen. The causes were
 * a contract mismatch between two files nothing compared:
 *
 *   * PATH DRIFT — the registry asked for `/api/alm/{id}/sensitivity` while
 *     the controller served `nii-sensitivity`; likewise `yield-curve` vs
 *     `yield-curve-analysis`. Both are tier:"core" analytics.
 *   * METHOD DRIFT — `<AlmPage>` issues a GET and has no `method` prop at
 *     all, so a POST-only analytic is unreachable from its own panel.
 *   * MISSING BACKEND — three panels (GARCH, Hull-White, Svensson) have no
 *     server implementation of any kind.
 *
 * `verify-alm-registry.mjs` checks that every panel folder is registered. It
 * has no idea whether the endpoint it registers exists. This closes that gap.
 *
 * WHAT IT CHECKS
 * --------------
 * For every registry entry carrying an `endpoint`, assert the backend declares
 * a route at that exact path REACHABLE BY GET — because GET is the only method
 * AlmPage can issue. A route that exists only as @Post is reported, since the
 * panel cannot reach it.
 *
 * Baselined entries are analytics with no backend at all. They are listed
 * explicitly with a reason so the count can only go DOWN (D24 ratchet).
 *
 * Usage:
 *   node scripts/verify-alm-endpoint-contract.mjs
 *   node scripts/verify-alm-endpoint-contract.mjs --self-test
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const REPO = resolve(FRONTEND, "..");
const BACKEND_SRC = join(REPO, "backend-node", "src");
const REGISTRY = join(FRONTEND, "lib", "alm", "registry.ts");

/**
 * Analytics whose panel is registered but which have NO backend implementation
 * of any kind. Each must carry a reason. This list may only shrink — adding to
 * it means shipping another dead panel, which is the thing this gate exists to
 * stop.
 */
const BASELINE_NO_BACKEND = {
  "/api/alm/{id}/garch":
    "GARCH(1,1) volatility engine is not implemented server-side.",
  "/api/alm/{id}/hull-white":
    "Hull-White short-rate model is not implemented server-side.",
  "/api/alm/{id}/yield-curve/svensson":
    "Svensson 6-parameter curve fit is not implemented server-side (Nelson-Siegel is, via yield-curve-analysis).",
};

/** Recursively collect .ts files under a directory. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extracts every declared route from the backend as `{ method, path }`, with
 * the controller's base path prepended. Paths are normalized to the registry's
 * `{id}` placeholder so the two vocabularies can be compared:
 *   `:institutionId` / `:id` -> `{id}`
 */
export function extractBackendRoutes(files, readFile = readFileSync) {
  const routes = [];
  for (const file of files) {
    let src;
    try {
      src = readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!src.includes("@Controller(")) continue;

    const baseMatch = src.match(/@Controller\(\s*'([^']*)'\s*\)/);
    const base = baseMatch ? baseMatch[1] : "";

    const routeRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
    let m;
    while ((m = routeRe.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      const sub = m[2] ?? "";
      const joined = [base, sub].filter(Boolean).join("/");
      routes.push({ method, path: normalize(joined) });
    }
  }
  return routes;
}

/** `api/alm/:institutionId/x` -> `/api/alm/{id}/x` */
export function normalize(path) {
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (token) =>
    /institutionid|:id$/i.test(token.slice(1)) || token === ":id"
      ? "{id}"
      : token,
  );
  // Any remaining param becomes {id} too — the registry only has one slot.
  p = p.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "{id}");
  return p.replace(/\/+/g, "/").replace(/\/$/, "");
}

/** Pulls `endpoint: '...'` values out of the registry source. */
export function extractRegistryEndpoints(src) {
  const out = [];
  const re = /endpoint:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return [...new Set(out)];
}

/**
 * Pulls `{ href, endpoint }` pairs so each endpoint can be traced back to the
 * page that consumes it. Needed to answer the question this gate actually
 * cares about: will a GET ever be issued at this path?
 */
export function extractRegistryEntries(src) {
  const out = [];
  // Split on entry boundaries rather than regexing across them: registry
  // entries contain nested objects (`name: { en, es }`), so any `[^}]*`
  // bridge between href and endpoint stops at the first inner brace and
  // silently drops the entry. That miss is what let the CFO Copilot keep
  // being reported as a violation after it had been correctly identified as
  // a bespoke-UI panel.
  for (const chunk of src.split(/\{\s*slug:/).slice(1)) {
    const href = chunk.match(/href:\s*'([^']+)'/);
    const endpoint = chunk.match(/endpoint:\s*'([^']+)'/);
    if (href && endpoint) out.push({ href: href[1], endpoint: endpoint[1] });
  }
  return out;
}

/**
 * True when the panel at `href` renders through <AlmPage> / useAlmEndpoint,
 * which is what makes its registry endpoint a GET target.
 *
 * Panels with bespoke data access — the CFO Copilot posts a chat turn through
 * lib/agents-api, for example — never GET their registry endpoint, so holding
 * them to GET-reachability reports a failure that does not exist. Detected
 * from the source rather than kept as a hand-maintained exemption list, so it
 * cannot drift as panels are rewritten.
 */
export function panelIssuesGet(href, appDir, readFile = readFileSync) {
  const page = join(appDir, href.replace(/^\//, ""), "page.tsx");
  let src;
  try {
    src = readFile(page, "utf8");
  } catch {
    // No page for this href — verify-alm-registry.mjs owns that failure.
    return true;
  }
  return /\bAlmPage\b|\buseAlmEndpoint\b/.test(src);
}

export function audit(
  endpoints,
  routes,
  baseline = BASELINE_NO_BACKEND,
  issuesGet = () => true,
) {
  const getPaths = new Set(
    routes.filter((r) => r.method === "GET").map((r) => r.path),
  );
  const anyPaths = new Map();
  for (const r of routes) {
    if (!anyPaths.has(r.path)) anyPaths.set(r.path, new Set());
    anyPaths.get(r.path).add(r.method);
  }

  const violations = [];
  const baselined = [];
  const bespoke = [];
  let ok = 0;

  for (const ep of endpoints) {
    const norm = normalize(ep);
    if (getPaths.has(norm)) {
      ok += 1;
      continue;
    }
    if (!issuesGet(ep)) {
      bespoke.push(ep);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(baseline, ep)) {
      baselined.push({ endpoint: ep, reason: baseline[ep] });
      continue;
    }
    const methods = anyPaths.get(norm);
    violations.push({
      endpoint: ep,
      normalized: norm,
      kind: methods ? "not-reachable-by-GET" : "no-backend-route",
      methods: methods ? [...methods].sort().join(",") : null,
    });
  }
  return { ok, violations, baselined, bespoke };
}

function selfTest() {
  const checks = [];
  const t = (name, cond) => checks.push({ name, ok: Boolean(cond) });

  t(
    "normalize maps :institutionId to {id}",
    normalize("api/alm/:institutionId/liquidity") === "/api/alm/{id}/liquidity",
  );
  t(
    "normalize is idempotent on an already-normalized path",
    normalize("/api/alm/{id}/liquidity") === "/api/alm/{id}/liquidity",
  );

  const routes = [
    { method: "GET", path: "/api/alm/{id}/liquidity" },
    { method: "POST", path: "/api/alm/{id}/optimize" },
  ];

  const good = audit(["/api/alm/{id}/liquidity"], routes, {});
  t(
    "a GET-backed endpoint passes",
    good.violations.length === 0 && good.ok === 1,
  );

  const postOnly = audit(["/api/alm/{id}/optimize"], routes, {});
  t(
    "a POST-only endpoint is a violation (AlmPage cannot reach it)",
    postOnly.violations.length === 1 &&
      postOnly.violations[0].kind === "not-reachable-by-GET",
  );

  const missing = audit(["/api/alm/{id}/nope"], routes, {});
  t(
    "an endpoint with no backend route is a violation",
    missing.violations.length === 1 &&
      missing.violations[0].kind === "no-backend-route",
  );

  const based = audit(["/api/alm/{id}/nope"], routes, {
    "/api/alm/{id}/nope": "why",
  });
  t(
    "a baselined endpoint is reported, not failed",
    based.violations.length === 0 && based.baselined.length === 1,
  );

  t(
    "registry extraction finds endpoints",
    extractRegistryEndpoints(
      "x, endpoint: '/api/alm/{id}/a' }, endpoint: '/b' }",
    ).length === 2,
  );

  t(
    "backend extraction reads controller base + sub path",
    (() => {
      const fake =
        "@Controller('api/alm')\nclass C { @Get(':institutionId/x') m() {} }";
      const got = extractBackendRoutes(["f.ts"], () => fake);
      return (
        got.length === 1 &&
        got[0].path === "/api/alm/{id}/x" &&
        got[0].method === "GET"
      );
    })(),
  );

  t(
    "backend extraction handles a bare @Post() on a controller path",
    (() => {
      const fake =
        "@Controller('api/v1/agents/:institutionId/copilot')\nclass C { @Post() m() {} }";
      const got = extractBackendRoutes(["f.ts"], () => fake);
      return got.length === 1 && got[0].path === "/api/v1/agents/{id}/copilot";
    })(),
  );

  t(
    "a POST-only endpoint whose panel is bespoke is NOT a violation",
    (() => {
      const r = audit(["/api/alm/{id}/optimize"], routes, {}, () => false);
      return r.violations.length === 0 && r.bespoke.length === 1;
    })(),
  );

  t(
    "panelIssuesGet detects an AlmPage panel",
    panelIssuesGet("/alm/x", "/app", () => 'render(<AlmPage slug="x" />)') ===
      true,
  );
  t(
    "panelIssuesGet detects a bespoke panel",
    panelIssuesGet(
      "/alm/y",
      "/app",
      () => "const r = await copilotQuery();",
    ) === false,
  );
  t(
    "panelIssuesGet defaults to strict when the page is missing",
    panelIssuesGet("/alm/z", "/app", () => {
      throw new Error("ENOENT");
    }) === true,
  );

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}\n`);
  }
  process.stdout.write(
    `\nverify-alm-endpoint-contract self-test: ${checks.length - failed.length} passed, ${failed.length} failed\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  const registrySrc = readFileSync(REGISTRY, "utf8");
  const endpoints = extractRegistryEndpoints(registrySrc);
  const entries = extractRegistryEntries(registrySrc);
  const routes = extractBackendRoutes(walk(BACKEND_SRC));
  const appDir = join(FRONTEND, "app");

  const hrefFor = new Map();
  for (const e of entries)
    if (!hrefFor.has(e.endpoint)) hrefFor.set(e.endpoint, e.href);
  const issuesGet = (ep) => {
    const href = hrefFor.get(ep);
    return href === undefined ? true : panelIssuesGet(href, appDir);
  };

  const { ok, violations, baselined, bespoke } = audit(
    endpoints,
    routes,
    BASELINE_NO_BACKEND,
    issuesGet,
  );

  process.stdout.write(
    `verify-alm-endpoint-contract: ${endpoints.length} registry endpoint(s), ` +
      `${routes.length} backend route(s)\n` +
      `  ${ok} reachable by GET · ${bespoke.length} bespoke-UI (never GET) · ` +
      `${baselined.length} baselined (no backend) · ` +
      `${violations.length} violation(s)\n`,
  );

  for (const b of bespoke) {
    process.stdout.write(
      `  bespoke-UI: ${b} — panel does not render through <AlmPage>, so it never GETs this path\n`,
    );
  }

  for (const b of baselined) {
    process.stdout.write(`  baselined: ${b.endpoint} — ${b.reason}\n`);
  }

  if (violations.length) {
    process.stdout.write("\n❌ Registry endpoints the panel cannot reach:\n");
    for (const v of violations) {
      const detail =
        v.kind === "not-reachable-by-GET"
          ? `exists only as ${v.methods} — <AlmPage> issues GET and has no method prop`
          : "no backend route declares this path";
      process.stdout.write(`  - ${v.endpoint}\n      ${detail}\n`);
    }
    process.stdout.write(
      "\n  Fix: point the registry at the real path, add a GET alias on the\n" +
        "  controller (see the black-litterman alias), or implement the analytic.\n" +
        "  Do NOT baseline a path that has a backend — baseline is only for\n" +
        "  analytics with no server implementation at all.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    "\n✓ ALM endpoint contract: every registered panel endpoint is reachable.\n",
  );
}

main();
