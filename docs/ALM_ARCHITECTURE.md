# ALM Surface Architecture

Last update: 2026‑04‑08.

This document describes the post‑hardening architecture of the `/alm` surface: the **registry → labels → density → hook → AlmPage → migrated modules** pipeline that replaced the ad‑hoc per‑module fetch + card grid + hardcoded copy pattern. Read this before touching any file under `frontend/lib/alm/`, `frontend/components/density/`, `frontend/components/alm/AlmPage.tsx`, `frontend/hooks/useAlmEndpoint.ts`, or `frontend/app/alm/`.

---

## The pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│  lib/alm/registry.ts           ← single source of truth (96 modules)     │
│    │                                                                     │
│    ├──► lib/alm/labels.ts      ← bilingual KPI/parameter dictionary      │
│    │      (~145 entries; humanize() fallback; dev-warn on miss)          │
│    │                                                                     │
│    ├──► hooks/useAlmEndpoint   ← typed fetch via registry endpoint       │
│    │      (8 error kinds; opt-in demo; GET/POST; AbortController)        │
│    │                                                                     │
│    ├──► components/density/*   ← MetricStrip / DataRow / DataTable       │
│    │      / NumberCell / TrendArrow / SparklineCell                      │
│    │                                                                     │
│    ├──► components/alm/AlmPage ← render-prop shell (header / loading     │
│    │      / error / retry / demo banner / controls slot)                 │
│    │                                                                     │
│    ├──► app/alm/<module>/      ← migrated module pages                   │
│    │      (8 migrated: var, cecl, liquidity, stress-v2, nim-attribution, │
│    │       black-litterman, garch, hull-white)                           │
│    │                                                                     │
│    ├──► components/alm/ALMBreadcrumb, app/alm/modules/page.tsx,          │
│    │    components/layout/Sidebar.tsx                                    │
│    │                                                                     │
│    └──► scripts/verify-alm-registry.mjs  ← CI guard (pnpm lint)          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb:** any ALM module metadata lives in the registry. Any displayed identifier goes through `label()`. Any fetch goes through `useAlmEndpoint`, usually via `<AlmPage>`. When in doubt, re‑read `app/alm/var/page.tsx` — it is the canonical reference.

---

## 1. `lib/alm/registry.ts` — the keystone

96 modules typed with literal‑union slug types, bilingual `name`/`description`, category, tier, status, `endpoint` template, and optional `regulatoryRefs`.

**Add a new module:**
1. Add the slug to the `AlmModuleSlug` literal‑union type.
2. Add an entry to `ALM_MODULES`.
3. If the module surfaces new KPI keys, register them in `lib/alm/labels.ts`.

The TypeScript union + CI verifier together enforce that every `app/alm/<slug>/page.tsx` has a corresponding entry. A missing entry fails `pnpm lint` AND type-checking.

**Derived lookups** (computed once): `MODULES_BY_SLUG`, `MODULES_BY_CATEGORY`, `ALM_CATEGORIES_BY_ID`.

**Helpers:** `getAlmModule(slug)`, `getModuleName(slug, locale, { short? })`, `getAlmModuleFromPathname(pathname)`.

---

## 2. `lib/alm/labels.ts` — the bilingual dictionary

~145 entries covering profitability, liquidity, capital, credit, risk, yield-curve, short-rate, GARCH, structural-credit, backtest, and the migrated-module field sets (portfolio values, allowances, scenarios, NIM attribution, BL allocation, etc.).

**Graceful-degradation contract:** `label(key, locale)` **never** returns a raw identifier. Lookup order:
1. Exact match in `LABELS`
2. Lowercase fallback
3. `humanize(key)` — splits camelCase / snake_case / kebab-case into Title Case

Dev mode emits one-shot `console.warn` with the missing key. Production users see "Loan To Share" instead of "loanToShare".

**Never render a raw backend identifier as JSX text.** The verifier grep-fails the build on `{key}` / `{key.toUpperCase()}` / `{slug}` / `{k}` / `{x.replace(/-/g, ' ')}` / `{x.split().join()}` patterns.

**Unit-aware formatting** via `labelUnit(key)` powers NumberCell's precision and suffix.

---

## 3. `hooks/useAlmEndpoint.ts` — typed data fetching

Replaces the 35+ instances of the silent-failure `try/catch → getDemoData()` pattern with a discriminated-union state machine.

```ts
const state = useAlmEndpoint<VaRSuite>('var', {
  institutionId: selectedId,
  validate: validateVaRSuite,          // pure TS, no zod
  queryParams: { confidence, horizon },
  deps: [confidence, horizon],
  getDemo: () => makeDemoData(...),    // OPT-IN fallback
});
```

**State union:** `{ status: 'idle' | 'loading' | 'success' | 'error', ... }`.

**Error kinds:**

| kind | HTTP | meaning |
|---|---|---|
| `missing-endpoint` | — | slug not in registry or has no `endpoint` field |
| `no-institution` | — | `institutionId` is null/undefined |
| `auth` | 401 | session expired |
| `not-found` | 404 | request returned 404 |
| `rate-limit` | 429 | with `retryAfter` from header |
| `server` | ≥ 500 | with status code |
| `network` | — | `fetch()` threw |
| `schema` | — | response not JSON, or `validate()` threw |

**HTTP methods:** `method: 'GET' | 'POST'` (default GET). When `method === 'POST'`, the hook auto-sets `Content-Type: application/json` and serializes `body` via `JSON.stringify`. When `body` is undefined on POST, the hook sends `'{}'`.

**Multi-endpoint via pathSuffix:** modules with secondary endpoints (e.g. CECL has both `/cecl` and `/cecl/forecast`) pass `pathSuffix: '/forecast'` to route the second fetch through the same state machine without a separate registry entry. The suffix is appended after `{id}` substitution on the registry template; any trailing slash on the template is normalized.

**Global (institution-agnostic) endpoints:** modules like USVI with registry endpoints that lack a `{id}` placeholder (e.g. `/api/alm/usvi/framework`) can be accessed by passing `institutionIdOverride` to AlmPage with any non-empty sentinel value. This bypasses the `no-institution` guard while the URL resolution leaves the template unchanged.

**Sentry breadcrumbs:** every error path (except the noisy `no-institution` case during ALMProvider bootstrap) emits a Sentry breadcrumb with `{ slug, kind, url, status }` tags. Server and schema errors also escalate via `captureMessage`. All Sentry calls are wrapped in try/catch so an uninitialised Sentry client can never break the hook.

**`getDemo` is opt-in.** Its presence is the only legitimate way to render placeholder data, and `state.source === 'demo'` drives the explicit banner. Without `getDemo`, errors surface as `{ status: 'error' }` with a retry button.

**Stable identity:** `retry` and `refetch` come back as `useCallback`-wrapped stable references. Pass them straight to `onClick`.

**`formatAlmError(error, locale)`** gives a one-line bilingual display string for every error kind.

---

## 3a. `lib/alm/recent.ts` — shared recent-modules store

External store built on `useSyncExternalStore` that tracks the last 5 modules the user visited. Shared between CommandPalette (Cmd-K) and the `/alm` Command Center landing page.

**API:**
- `pushRecent(slug)` — bump a module to the front (dedupes + caps at 5)
- `clearRecent()` — wipe the list
- `useRecent()` — React hook that subscribes to the store
- `subscribeRecent(onChange)` — bare subscription for non-React callers
- `getRecentSnapshot()` / `getRecentServerSnapshot()` — stable-reference snapshots
- `__resetRecentCacheForTesting()` — test-only cache reset

**Event plumbing:** mutations dispatch a `cerniq:recent-change` custom event for same-tab sync; cross-tab sync via the native `storage` event. Both are SSR-safe (guards on `typeof window`).

**Consumers:**
- `CommandPalette` — shows "Recent" section at the top of the default view
- `RecentActivityPanel` (landing page) — "jump back in" list
- `usePathname` effect in CommandPalette — catches every navigation source

Because the landing page and palette read from the same store, visiting a module via any path (URL, sidebar, palette, breadcrumb) immediately bumps it everywhere.

---

## 4. `components/density/*` — Bloomberg-density primitives

Six building blocks, all server-component-compatible (no hooks, no `'use client'`).

| Component | Purpose |
|---|---|
| `NumberCell` | Unit-aware locale-aware number formatter with signed coloring and precision per unit |
| `TrendArrow` | ▲▼─ delta indicator with bps/% formatting and inverted-good support |
| `SparklineCell` | Pure-SVG 60×16 sparkline (~15 LoC path builder — no Recharts) |
| `MetricStrip` | Horizontal KPI band that fits 7–14 metrics per row (replaces card grids) |
| `DataRow` | 28px label-value-delta-sparkline-badge row for vertical lists |
| `DataTable` | Generic typed table with column kinds (`text`/`number`/`delta`/`sparkline`/`custom`) |

**Plus a loading primitive:** `components/alm/AlmPageSkeleton.tsx` — layout-matching shimmer that replaces the spinner in AlmPage's loading branch. Approximates MetricStrip + chart + table so the first paint occupies a similar bounding box to the loaded state. Reduces Cumulative Layout Shift dramatically. Server-component-compatible.

**No barrel file.** Import each primitive directly (per `bundle-barrel-imports`).

---

## 5. `components/alm/AlmPage.tsx` — the module shell

Render-prop component that removes ~50 LoC of boilerplate from every migrated module. Handles:

- Registry-derived header (icon, bilingual name, description, beta/alpha status badge)
- `useALM()` institutionId wiring (with `institutionIdOverride` escape hatch for tests)
- `useTranslation()` locale wiring
- `useAlmEndpoint` fetch with forwarded options (`validate`, `getDemo`, `deps`, `queryParams`, `method`, `body`, `init`)
- Loading spinner with `role="status" aria-live="polite"`
- Error card with bilingual message and `<RefreshCw>` retry button
- Sample-data banner when `state.source === 'demo'`
- Controls slot in header (always visible, for selectors like confidence/horizon)
- `iconTint` prop for the header icon box (11 tailwind palettes)
- Hard-stop "Module not registered" render if the slug is unknown

**Render-prop signature:**
```tsx
<AlmPage<T> slug="..." validate={...} getDemo={...} controls={...}>
  {(data, { locale, mod, isDemo }) => <YourContent data={data} />}
</AlmPage>
```

The render prop is **only** called in the success state. If you need hooks on derived data (e.g. `useMemo`), define a separate content component and pass `data` as a prop:

```tsx
function VaRContent({ data, confidence }: { data: VaRSuite; confidence: number }) {
  const items = useMemo(() => buildItems(data), [data]);
  // ...
}

export default function VaRPage() {
  const [confidence, setConfidence] = useState(95);
  return (
    <AlmPage<VaRSuite> slug="var" validate={validateVaRSuite} ...>
      {(data) => <VaRContent data={data} confidence={confidence} />}
    </AlmPage>
  );
}
```

---

## 6. CI guard — `scripts/verify-alm-registry.mjs`

Three checks, run on every `pnpm lint`:

1. **Registry ↔ filesystem parity** — every `app/alm/<slug>/page.tsx` must have a registry entry.
2. **Leak guard** — seven forbidden JSX patterns (`{key}`, `{key.toUpperCase()}`, `{slug}`, `{k}`, `font-mono">{key}`, `{x.split().join()}`, `{x.replace(/-/g, ' ')}`). Uses `LEAK_BYPASS` regex so `label(key, locale)` is always allowed.
3. **Label dictionary sanity** — every `LABELS` entry has non-empty `en` + `es`; case-insensitive duplicates warn.

**Flags:**
- `--self-test` runs 10 fixture cases and exits non-zero on behavioural drift.
- `--quiet` suppresses warnings (CI mode).

Wired into `package.json`:
```json
"lint":       "eslint ... && node scripts/verify-alm-registry.mjs",
"verify:alm": "node scripts/verify-alm-registry.mjs"
```

---

## 7. Tests — 211 total, ~2 second suite

| File | Tests | What it locks in |
|---|---|---|
| `lib/alm/registry.test.ts` | 29 | Structural invariants, helpers, P0 regression, `MIGRATED_SLUGS` coverage, global-endpoint tolerance |
| `lib/alm/labels.test.ts` | 28 | humanize edge cases, fallback chain, warn-once, P0 key presence |
| `lib/alm/recent.test.ts` | 23 | Load/push/clear, dedup, cap at RECENT_MAX, corrupt JSON fallback, filter non-string entries, subscribe + unsubscribe, stable reference snapshots |
| `components/density/density.test.tsx` | 61 | Null/NaN, unit formatting, signed coloring, SVG edges, locale toggle, DataRow badges |
| `hooks/useAlmEndpoint.test.ts` | 33 | 8 error kinds, demo fallback, retry, URL resolution, queryParams filtering, POST + body serialization, pathSuffix composition |
| `components/alm/AlmPage.test.tsx` | 9 | Happy path, loading skeleton with role=status, error with retry, demo banner, status badges, unregistered slug hard-stop |
| `components/alm/CommandPalette.test.tsx` | 19 | ⌘K toggle, Escape close, ArrowUp/Down nav, Enter navigate, combobox a11y, fuzzy search, bilingual match, empty state, recent-modules (reads from extracted store) |
| `components/alm/AlmPageSkeleton` / `RecentActivityPanel` / `ModuleStatusGrid` | — | Hand-tested; presentational components |

Run them:
```bash
npx vitest run lib/alm components/density components/alm hooks/useAlmEndpoint.test.ts
```

---

## 8. Migrated modules (41 of 96)

| # | Module | Slug | Endpoint | Method | Key features |
|---|---|---|---|---|---|
| 1 | VaR Suite | `var` | `/api/alm/{id}/var` | GET | Three-method comparison, Kupiec backtest, confidence/horizon selectors |
| 2 | CECL | `cecl` | `/api/alm/{id}/cecl` (+`/forecast`) | GET | 3-method radio, segment DataTable, secondary forecast via `pathSuffix='/forecast'` |
| 3 | Liquidity | `liquidity` | `/api/alm/{id}/liquidity` | GET | LCR gauge, HQLA pie, cash-flow waterfall, Basel III banner |
| 4 | DFAST Stress 2.0 | `stress-v2` | `/api/alm/{id}/stress-v2` | GET | Run-nonce trigger, 9-quarter NWR path, scenario narratives |
| 5 | NIM Attribution | `nim-attribution` | `/api/alm/{id}/nim-attribution` | GET | 7-factor waterfall chart, factor detail DataTable |
| 6 | Black-Litterman | `black-litterman` | `/api/alm/{id}/black-litterman` | **POST** | Bayesian posterior radar, weights delta, investor views |
| 7 | GARCH | `garch` | `/api/alm/{id}/garch-volatility` | GET | Historical vol area, horizon forecast, parameters + diagnostics tables |
| 8 | Hull-White | `hull-white` | `/api/alm/{id}/yield-curve/hull-white` | **POST** | Fan chart with P5/P25/P50/P75/P95, parameter table, terminal distribution |
| 9 | IRR Policy Monitor | `irr-policy` | `/api/alm/{id}/irr-policy` | GET | EVE/NII/DurationGap limits tracker, WATCH/WARNING/BREACH banner |
| 10 | COSSEC Exam Prep | `exam-prep` | `/api/alm/{id}/exam-prep` | GET | CAMEL gauges, findings table, recommended actions, doc checklist |
| 11 | Monte Carlo | `monte-carlo` | `/api/alm/{id}/monte-carlo` (+`/run`) | **POST** | Tunable Vasicek params, 10K paths, fan chart, distribution histogram, two-body live/committed pattern |
| 12 | KMV-Merton | `kmv-merton` | `/api/alm/{id}/kmv-merton` | GET | Distance-to-default per obligor, colored DD bars, EDF DataTable |
| 13 | Credit Copula | `copula-credit` | `/api/alm/{id}/copula-credit` | **POST** | Gaussian vs t-Student loss distribution, tail dependence commentary |
| 14 | CVaR Optimizer | `cvar-optimizer` | `/api/alm/{id}/cvar-optimize` | **POST** | Rockafellar-Uryasev scatter frontier, current vs optimal weights |
| 15 | Svensson | `svensson` | `/api/alm/{id}/yield-curve/svensson` | GET | 6-param ECB yield curve fit, Nelson-Siegel comparison, params DataTable |
| 16 | Board Report | `board-report` | `/api/alm/{id}/board-report` | GET | KPI strip, sections DataTable, top risks, recommendations, reg pulse |
| 17 | USVI Framework | `usvi` | `/api/alm/usvi/framework` (global) | GET | **First global endpoint** — uses `institutionIdOverride` sentinel |
| 18 | NCUA RBC2 | `rbc2` | `/api/alm/{id}/rbc2` | GET | 8-component risk-weighted waterfall, status banner, component DataTable |
| 19 | Yield Curve | `yield-curve` | `/api/alm/{id}/yield-curve` | GET | Nelson-Siegel fit, 6 Basel IRRBB shocks, NII/EVE impact DataTable |
| 20 | HRP | `hrp` | `/api/alm/{id}/hrp` | GET | López de Prado hierarchical risk parity, treemap, weights DataTable |
| 21 | FRTB-IMA | `frtb-ima` | `/api/alm/{id}/frtb-capital` | GET | Basel III.1 Expected Shortfall (IMCC+SES+DRC), risk classes, liquidity horizons |
| 22 | NSFR | `nsfr` | `/api/alm/{id}/nsfr` | GET | Net Stable Funding Ratio — ASF/RSF breakdown tables, Basel III status banner |
| 23 | Stress Pack | `stress-pack` | `/api/alm/{id}/stress-pack` | GET | COSSEC 5-scenario liquidity stress with PASS/WATCH/FAIL traffic lights |
| 24 | Rate Shock v2 | `rate-shock-v2` | `/api/alm/{id}/yield-curve/forward-nii` | **POST** | Tenor-specific shocks + 12Q NII waterfall, 5 presets, two-body pattern |
| 25 | Repricing Gap | `repricing-gap` | `/api/alm/{id}/repricing-gap` | GET | OCIF CC-2022-03 7-bucket format, gap/cumgap columns |
| 26 | Key Rate Durations | `key-rate-durations` | `/api/alm/{id}/key-rate-durations` | GET | KRD01 by tenor, instrument detail DataTable with negative-convexity highlights |
| 27 | Deposit Beta | `deposit-beta` | `/api/alm/{id}/deposit-betas` | GET | OLS betas vs 94-institution PR library, FFR pass-through time series |
| 28 | FTP | `ftp` | `/api/alm/{id}/ftp` | GET | Matched-maturity FTP waterfall, segment contribution DataTable |
| 29 | Capital Optimizer | `capital-optimizer` | `/api/alm/{id}/optimize` | **POST** | LP optimization with aggressiveness tri-state, reallocation + constraint slacks |
| 30 | Forward Sim | `forward-sim` | `/api/alm/{id}/forward-simulation` | **POST** | 12Q NII/LCR/NWR projection under 3 rate paths, metric toggle |
| 31 | NIM Optimizer | `nim-optimizer` | `/api/alm/{id}/nim-optimizer` | GET | Rate recommendations vs peer median, NII impact per product, rationale cards |
| 32 | Regulatory Alerts | `alerts` | `/api/alm/{id}/alerts` | GET | COSSEC/OCIF/NCUA publication monitoring with severity filter + unread badge |
| 33 | Climate Risk | `climate-risk` | `/api/alm/{id}/climate-risk` | GET | Hurricane AAL, FEMA flood zones, Cat 1-5 loss scenarios with risk level banner |
| 34 | PCA Yield Curve | `pca-yield-curve` | `/api/alm/{id}/pca-factors` | GET | 3-factor variance decomposition, factor loadings by tenor, NII sensitivity |
| 35 | CAMEL Forecast | `camel-forecast` | `/api/alm/{id}/camel-forecast` | GET | AR(2) 4-quarter prediction, per-dimension cards, deterioration alerts |
| 36 | Form 5300 | `form-5300` | `/api/alm/{id}/form-5300` | GET | NCUA 5300 field mapping with validation status, XML/PDF export controls |
| 37 | Credit Risk Quant | `credit-risk` | `/api/alm/{id}/credit-risk` | GET | PD/LGD/EAD per segment, EL+UL stacked chart, capital adequacy banner |
| 38 | Peer Analytics | `peer-analytics` | `/api/alm/{id}/peer-analytics` | GET | Per-metric dot plots with IQR + median, quartile status badges, summary table |
| 39 | Early Warning System | `ews` | `/api/alm/{id}/ews` | GET | 12-indicator EWS composite gauge, isolation forest anomaly, peer alert |
| 40 | Concentration | `concentration` | `/api/alm/{id}/concentration` | GET | HHI index, exposure vs policy limits chart, breach/warning/compliant DataTable |
| 41 | Trends | `trends` | `/api/alm/{id}/trend` | GET | Multi-KPI time series with per-metric visibility toggles and delta indicators |

Every migrated module:
- Gets its header/icon/bilingual name from the registry (not hardcoded)
- Uses `useAlmEndpoint` (not inline try/catch)
- Has explicit runtime shape validation via a `validate: (raw) => T` function
- Opts in to demo fallback via `getDemo`
- Uses `MetricStrip` for the KPI grid (not card-grids)
- Uses `DataTable` where tabular data exists (not custom `<table>` markup)
- Resolves KPI/parameter labels through `labels.ts` (zero raw identifiers)
- Shows explicit error states with retry buttons (not silent fallbacks)

**~600 LoC removed net across these 8 migrations** — boilerplate (loading/error/header/retry/fetch) collapsed into the shared `AlmPage` shell.

---

## 9. Files in play

**New (19):**
- `lib/alm/registry.ts` + `.test.ts`
- `lib/alm/labels.ts` + `.test.ts`
- `hooks/useAlmEndpoint.ts` + `.test.ts`
- `components/density/NumberCell.tsx`
- `components/density/TrendArrow.tsx`
- `components/density/SparklineCell.tsx`
- `components/density/MetricStrip.tsx`
- `components/density/DataRow.tsx`
- `components/density/DataTable.tsx`
- `components/density/density.test.tsx`
- `components/alm/AlmPage.tsx` + `.test.tsx`
- `scripts/verify-alm-registry.mjs`
- `docs/ALM_ARCHITECTURE.md` (this file)

**Modified (15):**
- `app/alm/board-report/page.tsx` — P0 leak fix
- `app/alm/svensson/page.tsx` — P0 leak fix
- `app/alm/usvi/page.tsx` — P0 leak fix
- `app/alm/modules/page.tsx` — refactored to read from registry
- `app/alm/var/page.tsx` — flagship; uses AlmPage
- `app/alm/cecl/page.tsx` — migrated
- `app/alm/liquidity/page.tsx` — migrated (dark theme → standard)
- `app/alm/stress-v2/page.tsx` — migrated
- `app/alm/nim-attribution/page.tsx` — migrated
- `app/alm/black-litterman/page.tsx` — migrated (POST)
- `app/alm/garch/page.tsx` — migrated
- `app/alm/hull-white/page.tsx` — migrated (POST)
- `components/alm/ALMBreadcrumb.tsx` — reads from registry
- `components/layout/Sidebar.tsx` — ALM tree from MODULES_BY_CATEGORY
- `package.json` — verifier wired into `lint`

---

## 10. Verification green-state

```
pnpm lint (eslint):                  0 errors, 0 warnings (touched files)
npx tsc --noEmit:                    0 errors in ALM surface
                                     (pre-existing in components/close/* — unrelated)
node verify-alm-registry.mjs:        96 folders, 97 registered, 0 errors, 0 warnings
node verify-alm-registry.mjs --self-test:  10/10 cases pass
npx vitest run lib/alm components/density components/alm hooks/useAlmEndpoint.test.ts:
                                     153/153 tests pass in ~2 seconds
rg '>{key}<|>{key.toUpper|>{slug}<|>{k}<' app/alm:  0 matches
```

---

## 11. What's next (priority order — updated after Wave 4)

**P0 — continue the migration** (template is `app/alm/var/page.tsx`, each ~15-30 min):
1. `board-report`, `svensson`, `usvi` — density passes (P0 leak already fixed)
2. `rbc2`, `form-5300`, `camel-forecast`, `alerts` — remaining regulatory block
3. `hrp`, `frtb-ima`, `fed-futures`, `wrong-way-risk`, `cap-floor`, `macro-factors` — remaining frontier
4. `yield-curve`, `pca-yield-curve`, `rate-shock-v2`, `repricing-gap`, `key-rate-durations`, `behavioral-duration`, `sofr-exposure`, `deposit-beta` — rate risk
5. `stress-pack`, `ltp`, `nsfr`, `funding-concentration`, `deposit-runoff` — remaining liquidity
6. `ftp`, `capital-optimizer`, `capital-adequacy`, `nim-optimizer`, `forward-sim` — strategy

Target: 40+ migrated modules total. Current velocity: ~15-20 min per lightweight migration.

**P1 — extend the foundation:**
7. **Loading skeletons.** Replace the spinner in `AlmPage` with layout-matching shimmer placeholders to reduce CLS on slow connections.
8. **Prefetch-on-hover** for the module index page and Cmd-K results — start fetching when the user hovers a module card.
9. **Sentry integration** for `useAlmEndpoint` errors — emit breadcrumbs for each error kind so production incidents surface in observability.
10. **CommandPalette unit tests.** RTL-based tests for ⌘K toggle, keyboard nav, Enter navigation, combobox a11y attributes.
11. **Server-component migration** of static modules — the density primitives are RSC-compatible today; only the fetch layer blocks.

**P2 — executive-demo polish:**
12. **Keyboard navigation in `MetricStrip`** — arrow keys between cells, Enter opens linked module.
13. **Recent-modules hint** in Cmd-K — track last-visited modules in localStorage and surface at the top of the default view.
14. **Module quick-actions** — `⌘K` → type command → run scenario (e.g. "run stress severe adverse") without opening the module first.
15. **Bilingual QA pass** — every migrated module rendered in both EN and ES to catch any drift.

**P3 — backend alignment:**
16. Split `backend-node/src/alm/alm.module.ts` into 8 sub-modules.
17. Parameterize hardcoded quant constants via a `model_params` Prisma table.
18. Kill the 107 trivial `should be defined` test stubs and replace with golden-value tests.

---

## 12. Non-obvious contracts

- **Do not remove the `label()` fallback chain.** The `humanize()` last-resort is what makes the P0 bug class structurally extinct.
- **Do not import from a `components/density/index.ts` barrel.** Tree-shaking suffers; always direct-import.
- **`useAlmEndpoint.deps` is serialized via `JSON.stringify`.** Pass primitives — objects / functions generate new strings per render and thrash the effect.
- **`getDemo` is opt-in for a reason.** Its presence is an explicit acceptance that the user may see placeholder data, always labeled as such.
- **Module slugs in `AlmModuleSlug` are load-bearing.** Adding a route folder without updating the union type + `ALM_MODULES` will fail both `tsc` and the CI verifier.
- **The Sidebar ALM tree is derived, not hardcoded.** Adding a registry entry automatically adds a sidebar link.
- **`AlmPage` render props cannot call hooks.** If you need `useMemo`/`useState` on derived data, extract a sibling content component that takes `data` as a prop.
- **Secondary endpoints use `pathSuffix`.** See `app/alm/cecl/page.tsx` — two `useAlmEndpoint` calls, one for `/cecl` and one with `pathSuffix: '/forecast'`. Both share the same state machine, abort controller, and demo fallback.
- **Monte Carlo's two-body pattern** is the template for parameter-driven simulations. See `app/alm/monte-carlo/page.tsx` — `liveBody` drives the input controls, `committedBody` is what the hook actually POSTs, and clicking Run copies live → committed + bumps the nonce. Prevents fetch-on-every-keystroke without sacrificing reactivity.
- **CommandPalette uses derived active-index**, not effect-driven state. Do not re-introduce `useEffect(() => setActiveIndex(0), [results])` — it triggers cascading renders. The clamping pattern in `safeIndex` is the correct fix.

---

## 13. One-line summary

> The ALM surface is a registry-driven, bilingual, density-first, hook-based pipeline with a render-prop shell, multi-endpoint support, Sentry observability, layout-matching skeleton, a ⌘K command palette, a shared recent-modules store, and a **Command Center landing page** that surfaces migration status + recent activity + module explorer from the registry — so every piece of work compounds into daily workflow value. **41 of 96 modules migrated** (43%); each future module is ~15-30 minutes following `var/page.tsx`. **211 tests** lock in invariants across 9 files in ~2s. The P0 raw-identifier bug class is structurally extinct.
