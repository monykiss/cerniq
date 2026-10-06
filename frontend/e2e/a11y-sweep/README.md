# A11y Sweep — CERNIQ

Automated WCAG 2.1 AA sweep over every public App Router page, powered by
`@axe-core/playwright`.

## Quick start

```bash
# 1. Regenerate the route list (auto-discovered from app/**)
npm run a11y:routes

# 2a. Public sweep only (141 routes, no auth needed)
npm run a11y:sweep:public

# 2b. Full sweep (public + 23 authed routes). Requires a seeded user.
# Use `export` rather than inline `VAR=value` so values never live in
# shell history or trip the pre-commit secret scanner.
export A11Y_SWEEP_EMAIL=<test-account-email>
export A11Y_SWEEP_PASSWORD=<test-account-password>
npm run a11y:sweep

# 3. Render a Markdown report of the latest run
npm run a11y:report
```

### Run against production (public routes only)

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=https://app.example.com \
PLAYWRIGHT_BACKEND_URL=https://api.example.com \
  npm run a11y:sweep:public
```

The authed sweep is deliberately **not** wired for prod CI — minting a
production access token from a CI runner is a wider blast radius than
the a11y value justifies. Run it from a workstation when you need it.

### Authentication flow (the authed sweep)

1. `e2e/a11y-sweep/global-setup.ts` runs once before the test suite
2. POSTs to `/auth/login` with `A11Y_SWEEP_EMAIL` / `A11Y_SWEEP_PASSWORD`
3. Captures the resulting httpOnly cookies into `.auth/authed-state.json`
4. Mirrors the access token into localStorage (matching real post-login state)
5. Each authed test uses `storageState: .auth/authed-state.json` — no per-test login cost

**CI secrets to add** (Settings → Secrets → Actions):

| Secret                 | Required for | Notes                                     |
|------------------------|--------------|-------------------------------------------|
| `A11Y_SWEEP_EMAIL`     | authed sweep | Use a dedicated seeded user, not an owner |
| `A11Y_SWEEP_PASSWORD`  | authed sweep | Rotate every 90 days                      |

If these secrets aren't set, the authed describe block skips cleanly —
the public sweep still runs.

### Lock the current state as the new baseline

After triaging and accepting the remaining violations as "known debt":

```bash
npm run a11y:baseline
git add e2e/a11y-sweep/baseline.json
git commit -m "a11y: refresh baseline"
```

From then on, CI fails the PR if **new** critical/serious violations
appear — but pre-existing ones don't block the green build.

## Files

| File                        | Purpose                                                |
|-----------------------------|--------------------------------------------------------|
| `discover-routes.mjs`       | Walks `app/**/page.tsx`, emits `routes.generated.json` |
| `routes.generated.json`     | Auto-generated, git-ignored (regenerated per run)      |
| `axe-config.ts`             | Shared axe rules/tags + severity policy                |
| `a11y-sweep.spec.ts`        | Parametrized Playwright spec (one test per route)      |
| `baseline.json`             | Route → known-failing-rule-ids (committed)             |
| `render-report.mjs`         | Turns `results/latest.json` into Markdown              |
| `results/`                  | Run artifacts, git-ignored                             |

## Severity policy

| Impact      | CI behavior                                                            |
|-------------|------------------------------------------------------------------------|
| critical    | **hard fail** on any new violation exceeding baseline                  |
| serious     | **hard fail** on any new violation exceeding baseline                  |
| moderate    | **ratchet** — aggregate count may never increase (`ratchet.json`)      |
| minor       | tracked in report only                                                 |

### Ratchet — what it buys you

Hard-gating every moderate violation blocks daily shipping over things
like "tooltip missing aria-label on a button whose text already describes
the action." Ignoring moderate entirely lets cruft accumulate.

The ratchet gives the right behavior: the total **node count** of
moderate violations across the whole sweep may never go up. Fix a few,
ship a few — but the number on the scoreboard only moves in one direction.

If you genuinely need to raise the ceiling (e.g. you're onboarding a
vendor widget with known moderate issues), run:

```bash
npm run a11y:baseline   # regenerates baseline.json AND ratchet.json
```

…and include the rationale in the PR description.

## Adding new routes

New pages are discovered automatically — just commit the `page.tsx`.

**Route overrides** (auth-gated, dynamic, skip) live in `discover-routes.mjs`
in the `ROUTE_OVERRIDES` map. If you add a `/foo/[bar]` page, either:

1. Add it with `status: 'dynamic'` + a real `concreteUrl`, or
2. Leave it — it defaults to `skip-dynamic` and is excluded safely.

## CI

`.github/workflows/a11y-sweep.yml` runs on every PR that touches `frontend/**`.
It posts a summary comment on the PR and uploads the full HTML report as an
artifact.
