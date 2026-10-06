# Row-Level Security (RLS) — Tenant Isolation Architecture

**Status:** Implemented (pending migration application)
**Reference:** internal engineering standards (not included)

## Overview

CERNIQ is a multi-tenant SaaS platform serving Puerto Rico cooperativas. Prior to this
implementation, tenant isolation was purely application-level (middleware checking
`institutionId` on every request). This RLS layer adds **database-level** enforcement
so that even a SQL injection vulnerability cannot read another tenant's data.

## Threat Model

| Threat | Pre-RLS Mitigation | Post-RLS Mitigation |
|--------|-------------------|---------------------|
| SQL injection reads cross-tenant data | App middleware only | PostgreSQL RLS blocks at row level |
| Forgotten WHERE clause in new query | Code review | RLS silently filters rows |
| Admin endpoint accidentally leaks data | Manual testing | Admin bypass requires explicit `app.admin_mode = 'true'` |
| Audit log tampering | None | RESTRICTIVE policies block UPDATE/DELETE |

## Architecture

```
  Request
    │
    ▼
  JWT Verification (Guard)
    │
    ▼
  TenantContextMiddleware
    │  ┌─ Authenticated: SET LOCAL app.current_institution_id = $1
    │  ├─ Admin (x-admin-key): SET LOCAL app.admin_mode = 'true'
    │  └─ Unauthenticated: no GUC set → RLS blocks all rows
    │
    ▼
  Route Handler
    │
    ▼
  Prisma Client → PostgreSQL
    │
    ▼
  RLS Policies evaluate GUC variables per-row
```

## Protected Tables (24 total)

### Non-nullable institution_id (20 tables)

| # | Table | Policy Prefix |
|---|-------|---------------|
| 1 | `balance_sheet_items` | `tenant_isolation_balance_sheet_items` |
| 2 | `interest_rate_scenarios` | `tenant_isolation_interest_rate_scenarios` |
| 3 | `liquidity_positions` | `tenant_isolation_liquidity_positions` |
| 4 | `saved_scenarios` | `tenant_isolation_saved_scenarios` |
| 5 | `yield_curves` | `tenant_isolation_yield_curves` |
| 6 | `loan_segments` | `tenant_isolation_loan_segments` |
| 7 | `deposit_tiers` | `tenant_isolation_deposit_tiers` |
| 8 | `concentration_limits` | `tenant_isolation_concentration_limits` |
| 9 | `loan_cohorts` | `tenant_isolation_loan_cohorts` |
| 10 | `cecl_vintage_allowances` | `tenant_isolation_cecl_vintage_allowances` |
| 11 | `irr_policy_limits` | `tenant_isolation_irr_policy_limits` |
| 12 | `policy_breach_logs` | `tenant_isolation_policy_breach_logs` |
| 13 | `column_mapping_memories` | `tenant_isolation_column_mapping_memories` |
| 14 | `board_reports` | `tenant_isolation_board_reports` |
| 15 | `analysis_runs` | `tenant_isolation_analysis_runs` |
| 16 | `webhook_subscriptions` | `tenant_isolation_webhook_subscriptions` |
| 17 | `sso_configurations` | `tenant_isolation_sso_configurations` |
| 18 | `usage_meter_events` | `tenant_isolation_usage_meter_events` |
| 19 | `data_deletion_requests` | `tenant_isolation_data_deletion_requests` |
| 20 | `institution_alerts` | `tenant_isolation_institution_alerts` |

### Nullable institution_id (4 tables)

These tables use a stricter USING clause: `institution_id IS NOT NULL AND institution_id = ...`.
Rows with NULL `institution_id` are only visible via admin bypass.

| # | Table | Notes |
|---|-------|-------|
| 21 | `ingestion_logs` | System-level ingestion may not have an institution |
| 22 | `report_jobs` | Jobs created before institution assignment |
| 23 | `audit_logs` | System actions may not be institution-scoped |
| 24 | `feedback` | Anonymous feedback may lack institution |

### Append-Only (audit_logs)

Two additional RESTRICTIVE policies on `audit_logs` prevent any UPDATE or DELETE,
even by admins:

- `audit_append_only` — `FOR UPDATE USING (FALSE)`
- `audit_no_delete` — `FOR DELETE USING (FALSE)`

This ensures compliance-grade immutability for the audit trail.

## GUC Variables

| Variable | Type | Set By | Lifetime |
|----------|------|--------|----------|
| `app.current_institution_id` | text | TenantContextMiddleware (from JWT) | Transaction-scoped (SET LOCAL) |
| `app.admin_mode` | text | TenantContextMiddleware (from x-admin-key header) | Transaction-scoped (SET LOCAL) |

`current_setting('variable', TRUE)` returns NULL when the variable is not set (the
`TRUE` argument makes it return NULL instead of throwing an error). This means
unauthenticated requests — where neither variable is set — see zero rows from
RLS-protected tables.

## Middleware Implementation

**File:** `backend-node/src/common/middleware/tenant-context.middleware.ts`

Key design decisions:

1. **Parameterized queries only** — Uses Prisma's tagged template `$executeRaw` to
   prevent SQL injection in the SET statement itself.

2. **SET LOCAL scope** — Variables are automatically cleared at transaction boundary,
   preventing tenant context leakage between requests sharing a connection pool slot.

3. **Admin priority** — When `x-admin-key` is present, admin mode is set and tenant
   context is skipped. This supports cross-tenant admin operations.

4. **Fail-open for next()** — If the SET command fails (e.g., DB connection issue),
   `next()` is still called. The request proceeds but RLS policies will block access
   since no GUC variable is set. This is fail-secure from a data perspective.

## Migration

**File:** `backend-node/prisma/migrations/20260417020000_rls_tenant_isolation/migration.sql`

Apply with:

```bash
npx prisma migrate deploy
```

Prior to 2026-04-17 this migration lived in a folder named `rls_tenant_isolation`
(no timestamp prefix) and was silently skipped by `prisma migrate deploy`. The
rename to `20260417020000_*` activates Prisma's migration engine. The migration
is idempotent — every `CREATE POLICY` is preceded by `DROP POLICY IF EXISTS`
so re-running against any prior state is safe.

## Testing

**File:** `backend-node/src/common/middleware/tenant-context.middleware.spec.ts`

Covers:
- Authenticated requests set tenant context
- Admin requests set admin mode
- Unauthenticated requests set nothing
- Missing institutionId sets nothing
- Database errors do not block the request
- Admin mode takes priority over tenant context

## Important Notes

1. **Prisma migrations user** — The database role used by Prisma to run migrations
   must be the table owner (typically `postgres`). RLS policies do not apply to
   table owners by default, which is correct for migration operations.

2. **Application database role** — If the application connects as the table owner,
   RLS will be bypassed by default. To enforce RLS even for the owner, run:
   `ALTER TABLE [table] FORCE ROW LEVEL SECURITY;`
   This is not included in the initial migration to avoid breaking existing queries
   during the rollout period.

3. **Superuser connections** — psql connections as `postgres` superuser bypass RLS.
   This is expected and useful for debugging/admin operations.

4. **Current enforcement posture is defense-in-depth only.** The policies exist
   on all 24 tables, but enforcement is bypassed for the application's DB role
   because that role owns the tables. Observed today: RLS does not functionally
   block any queries — it is ready to enforce the moment `FORCE ROW LEVEL
   SECURITY` is applied. Security benefit right now is (a) a `pg_dump` inspector
   sees the tenancy contract explicitly, and (b) a misconfigured non-owner role
   (e.g. an analytics read replica) is immediately subject to RLS without
   further migrations.

5. **Known middleware architecture concern.** `TenantContextMiddleware` uses
   `prisma.$executeRaw\`SET LOCAL ...\`` outside any explicit `$transaction`.
   PostgreSQL silently ignores `SET LOCAL` outside a transaction (it emits a
   NOTICE and discards the setting). When `FORCE ROW LEVEL SECURITY` is later
   applied, the middleware will need to be restructured to run each request
   inside a single Prisma interactive transaction (or adopt a custom Prisma
   extension that wraps every query with `SET LOCAL … RESET`). Without that
   restructure, RLS will block all queries once `FORCE` is enabled.

6. **Future work — the enforcement flip:**
   (a) Restructure middleware to hold a per-request interactive transaction.
   (b) Add `ALTER TABLE … FORCE ROW LEVEL SECURITY` migrations.
   (c) Expand `SERVICE_BYPASS_PATH_PREFIXES` in the middleware to cover cron
       entrypoints, public feedback endpoints, and seed scripts (or give
       those paths their own interactive-transaction wrapper that sets
       `app.admin_mode = 'true'`).

7. **Safe operator checklist for turning on real RLS enforcement:**
   - Confirm the production `DATABASE_URL` user and whether it has `BYPASSRLS`.
   - Inventory every `@Cron`, public controller, and background worker that
     writes to any of the 24 tables.
   - Land the middleware transaction restructure.
   - Add `FORCE` in a follow-up migration with full staging burn-in.
