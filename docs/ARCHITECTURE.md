# CERNIQ — System Architecture

CERNIQ is a three-tier web application (Next.js frontend, NestJS API,
PostgreSQL/Redis) plus a small Python service that parses COSSEC examination
reports.

```
            Browser
               │
     ┌─────────┴──────────┐
     │  Next.js 16 (web)  │   App Router, EN/ES i18n, /api/* rewrite to the API
     └─────────┬──────────┘
               │ HTTPS / WebSocket
     ┌─────────┴──────────┐
     │  NestJS 11 (API)   │   Auth guards → controllers → services
     └──┬──────┬──────┬───┘
        │      │      │
   PostgreSQL  Redis  External services (all optional, configured by env):
   (Prisma 7)         Stripe, Resend, S3-compatible storage, Anthropic/OpenAI,
                      Supabase auth, Sentry/OpenTelemetry

     ┌────────────────────────┐
     │ cossec-parser (Python) │   FastAPI: COSSEC exam PDF → structured findings,
     └────────────────────────┘   posted to the API's COSSEC ingest endpoint
```

## Components

### Frontend (`frontend/`)

| Aspect | Detail |
|--------|--------|
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS 4 |
| State / data | Zustand, TanStack Query |
| Charts | Recharts |
| i18n | Spanish-first EN/ES dictionaries (`lib/i18n`) with a parity check |
| ALM pages | Registry-driven `AlmPage` shell + `useAlmEndpoint` hook (see [ALM_ARCHITECTURE.md](ALM_ARCHITECTURE.md)) |
| Security headers | `lib/security-headers.ts`, applied in `next.config.ts` |
| Tests | Vitest + Testing Library; Playwright specs in `e2e/` (need a running stack) |

### Backend (`backend-node/`)

| Aspect | Detail |
|--------|--------|
| Framework | NestJS 11, TypeScript strict mode |
| ORM | Prisma 7 (PostgreSQL adapter), SQL migrations in `prisma/migrations` |
| Auth | Local JWT + optional Supabase JWT, OAuth (Google/GitHub), API keys, magic links |
| Real-time | Socket.IO gateways (report pipeline, ALM rate alerts, AI advisor) |
| Jobs | `@nestjs/schedule` cron jobs |
| Validation | class-validator with `whitelist` + `forbidNonWhitelisted` |
| PDF | PDFKit (bilingual board/ALCO packs) |
| Tests | Jest unit tests next to sources; e2e specs in `test/` run against a mocked Prisma client |

Main domain modules: `alm` (quant engine and ALM endpoints), `cossec`, `ncua`,
`exam-prep`, `compliance`, `compliance-registry`, `governance`,
`model-registry`, `agents` / `agent-api` / `agent-trust` / `agent-eval`
(LLM agent runtime with tool calls, PII redaction and eval harness),
`ai-advisor`, `portal`, `pipeline`, `billing`, `auth`, `audit`.

### COSSEC parser (`services/cossec-parser/`)

FastAPI service using PyMuPDF to extract examination findings (category,
severity, regulatory reference) from COSSEC PDFs. Tested with pytest.

## Request lifecycle

```
Browser → Next.js /api/* rewrite (or direct API origin for uploads)
  → AuthGuard (JWT / Supabase / API key) → tenant & role guards
  → controller → service → Prisma (RLS context set per institution) → PostgreSQL
```

### ALM report generation

1. A portal user uploads a balance-sheet CSV (validated, dry-run preview).
2. Confirmed rows are stored as `BalanceSheetItem` records.
3. A `ReportJob` moves through `AWAITING_DATA → PROCESSING → GENERATING_PDF → COMPLETE`.
4. The ALM engine computes duration gap, NII sensitivity, EVE, LCR/NSFR,
   Monte Carlo rate paths, COSSEC ratios and related analytics.
5. PDFKit renders the bilingual report; it is stored in S3-compatible storage
   and served with short-lived presigned URLs.

## Authentication and authorization

```
Email/password  → bcrypt hash → access JWT + rotating refresh token
OAuth           → provider callback → upsert user → JWT
Supabase        → verify Supabase JWT → match/create local user
API key         → X-API-Key → peppered hash lookup → read-only access
Magic link      → single-use token → JWT
```

Authorization layers:

- **Institution roles** — `OWNER`, `ANALYST`, `VIEWER` (`users.role`), enforced
  by role/RBAC guards.
- **Tenant scope** — institution/organization guards verify ownership or
  membership on every tenant-scoped route; PostgreSQL row-level security
  policies back this up (see `backend-node/docs/security/rls-architecture.md`).
- **Plan access** — `PlatformAccessService` evaluates subscription/demo state
  and returns a structured `PLATFORM_ACCESS_REQUIRED` payload when blocked.
- **Platform admin** — cross-tenant operator access is the boolean
  `users.platform_admin` column. It defaults to `false`, is never set by any
  sign-up/sign-in/provisioning code path, is never inferred from an email
  address, and is never granted to API keys. An operator grants it
  out-of-band:

  ```sql
  UPDATE users SET platform_admin = TRUE WHERE email = '<verified operator email>';
  ```

  If the flag lookup fails, access is denied.

## Configuration

All deployment-specific values (origins, callback URLs, sender domains,
storage, keys) come from environment variables — see `.env.example`.
Required secrets have no defaults: `JWT_SECRET` is always required, and
production boot also requires `DATA_ENCRYPTION_KEY` and `API_KEY_PEPPER`.
CORS allows only configured origins (`FRONTEND_URL`, `ALLOWED_ORIGINS`).

## Security summary

| Area | Implementation |
|------|----------------|
| Passwords | bcrypt |
| Sessions | Short-lived access JWT, rotating refresh tokens with per-token `jti` |
| API keys | Peppered hashes, read-only, expiry warnings |
| Data at rest | AES-256-GCM application-level encryption for sensitive fields |
| Transport headers | Helmet (nonce CSP, HSTS) on the API; CSP and security headers on the web app |
| Input | Global validation and sanitization pipes |
| Rate limiting | `@nestjs/throttler`, per-route limits on public endpoints |
| Audit | Append-only audit log interceptor |
| Observability | Sentry with PII scrubbing, OpenTelemetry spans |
