<p align="center">
  <strong>CERNIQ</strong><br/>
  <em>Bilingual Asset-Liability Management and COSSEC compliance for Puerto Rico cooperativas and credit unions</em><br/>
  <a href="https://cerniq.io">cerniq.io</a>
</p>

---

## About this repository

This repository is published **for review**. It is a sanitized, single-commit
snapshot of the CERNIQ production codebase:

- Git history is not included.
- Operational material is excluded: deployment configuration, infrastructure
  identifiers, internal runbooks and strategy documents, and all customer,
  prospect and other personal data. Sales/outreach tooling was removed.
- Third-party institution names appear only as public regulatory reference
  data (the COSSEC institution registry) or are replaced with fictional names.
- Secrets are never committed; tests generate credentials at runtime.

The code is provided under a **review-only license** (see [LICENSE](LICENSE)).
For a walkthrough, contact the repository owner through their GitHub profile.

---

## What CERNIQ does

CERNIQ automates the Asset-Liability Management (ALM) analysis that
cooperativas, credit unions and community banks in Puerto Rico prepare for
their ALCO committees, boards and regulators (COSSEC, NCUA).

An institution uploads a balance sheet (CSV); CERNIQ validates it, runs the
ALM engine and produces bilingual (Spanish/English) board-ready reports:
duration gap, NII sensitivity, economic value of equity, liquidity coverage,
Monte Carlo rate scenarios, credit-loss (CECL) estimates and a COSSEC
compliance assessment.

## Feature overview

| Domain | Examples of modules |
|--------|---------------------|
| Interest-rate risk | Duration gap, NII / EaR sensitivity, EVE/NEV, key-rate durations, repricing gap, rate shocks, behavioral (non-maturity deposit) duration, SOFR exposure |
| Yield curves & rates | Nelson-Siegel / Svensson, PCA yield-curve factors, Hull-White, HJM, Vasicek / CIR Monte Carlo, GARCH |
| Liquidity | LCR, NSFR, liquidity gap, deposit runoff, funding concentration |
| Credit risk | CECL (WARM, vintage, PD/LGD), KMV-Merton, CreditMetrics, copula credit, concentration and wrong-way risk |
| Capital & portfolio | Capital adequacy / glide-path planning, Black-Litterman, HRP, CVaR optimization, economic capital |
| Stress testing | Scenario builder and comparison, regulatory scenario packs, hurricane / PR macro overlays |
| Regulatory | COSSEC ratios and compliance, CAMEL forecasting, NCUA Form 5300 and RBC2, exam-prep evidence packages, regulatory calendar |
| AI | LLM agents with typed tool calls into the ALM engine, PII redaction, prompt-injection screening, golden-case evaluation harness |
| Platform | Client portal, report pipeline with real-time progress, bilingual PDF reports, API v1 with OpenAPI docs and API keys, Stripe billing |

Quantitative models are documented in `backend-node/docs/model-cards/` and
`docs/models/model_inventory.md`.

---

## Architecture

```
Browser ──▶ Next.js 16 (frontend/) ──/api/*──▶ NestJS 11 API (backend-node/)
                                                 │
                         PostgreSQL (Prisma 7) ◀─┼─▶ Redis
                                                 │
            Optional services via env: Stripe, Resend, S3-compatible storage,
            Anthropic/OpenAI, Supabase auth, Sentry / OpenTelemetry

services/cossec-parser (FastAPI) ──▶ COSSEC exam PDF → structured findings
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (components, request flow,
authentication and authorization) and
[docs/ALM_ARCHITECTURE.md](docs/ALM_ARCHITECTURE.md) (frontend ALM page
architecture).

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Recharts, Zustand, TanStack Query |
| Backend | NestJS 11, TypeScript (strict), Prisma 7, Socket.IO, PDFKit |
| Data | PostgreSQL 15 (row-level security), Redis 7 |
| Auth | JWT with rotating refresh tokens, optional Supabase, Google/GitHub OAuth, API keys, magic links |
| Parser service | Python 3.11+, FastAPI, PyMuPDF |
| Testing | Jest, Vitest + Testing Library, Playwright, pytest |
| CI | GitHub Actions: lint, typecheck, unit tests, secret scanning, dependency audit |

## Repository layout

```
backend-node/            NestJS API
  prisma/                  schema, SQL migrations, seed scripts
  src/alm/                 ALM engine and endpoints
  src/agents, agent-*/     LLM agent runtime, trust layer, evals
  src/auth/                authentication, platform access, guards
  src/cossec, ncua/        regulatory modules
  test/                    e2e specs and agent golden cases
  docs/                    model cards, RLS design
frontend/                Next.js app
  app/alm/                 ALM analysis pages
  app/portal/              client portal
  lib/, components/        API client, i18n, shared UI
services/cossec-parser/  COSSEC examination PDF parser
docs/                    architecture, API and data-model reference
```

## Running locally

Prerequisites: Node.js 20+, Docker, Python 3.11+ (parser only).

```bash
cp .env.example .env        # fill in DATABASE_PASSWORD and JWT_SECRET at minimum
docker compose up -d postgres redis

cd backend-node && npm ci && npx prisma generate && npx prisma migrate dev && npm run start:dev
cd frontend && npm ci && npm run dev          # http://localhost:3001
```

## Checks

```bash
cd backend-node && npm run lint && npm run build && npm test
cd frontend && npm run lint && npm run typecheck && npm test
cd services/cossec-parser && pip install -r requirements.txt && python -m pytest
```

The same checks, plus secret scanning and a blocking dependency audit, run in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## License

Proprietary, source available for review only — see [LICENSE](LICENSE).
Copyright © 2025-2026 KLYTICS LLC.
