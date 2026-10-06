# System Map

## Confirmed Runtime Boundaries

### Frontend

- Path: `frontend/`
- Stack: Next.js 16, React 19, TypeScript
- Role: landing page, ALM dashboard, portal, admin, SpendCheck, quant/risk UI
- Classification: partial build

### Primary ALM Backend

- Path: `backend-node/`
- Stack: NestJS 11, Prisma, PostgreSQL, Redis
- Role: auth, ALM analytics, billing, portal, email, report jobs, admin ops
- Classification: production-leaning

### Secondary / Parallel Backend

- Path: `backend/`
- Stack: Rust, Axum, SQLx, Redis
- Role: market data, risk routes, reports, SpendCheck, uploads, waitlist
- Classification: partial build

### Compute Library

- Path: `crates/compute-core/`
- Stack: Rust, WASM
- Role: risk, options, Monte Carlo primitives
- Classification: partial build

### Experimental API

- Path: `apps/api/`
- Stack: Bun
- Role: older CapexCycle prototype APIs
- Classification: scaffold only

## Confirmed Data Layer

- PostgreSQL via Prisma for NestJS
- PostgreSQL via SQLx for Rust
- Redis for cache and job-adjacent state
- S3/R2-compatible object storage for generated reports

## Confirmed ALM Execution Path

1. Frontend or portal calls NestJS ALM endpoints.
2. NestJS reads `Institution` and `BalanceSheetItem` data from Prisma/Postgres.
3. `AlmEnterpriseService` transforms persisted items into analysis DTOs.
4. `AlmService` and `StressTestingService` run calculations.
5. `ReportsService` or `PipelineWorker` generates PDFs.
6. Reports are stored in object storage and exposed through the portal.

## Inferred Architectural Truths

- NestJS is the canonical CERNIQ ALM application boundary today.
- Rust is a parallel service boundary that still reflects legacy and adjacent product lines.
- The current architecture is multi-runtime, but not yet cleanly decomposed by business capability.

## Architecture Drift To Track

- `docs/ARCHITECTURE.md` still describes CapexCycle and outdated frontend versions.
- The long-term plan says Rust should become the quant compute core, but ALM execution is still TypeScript-first.
- The repo currently exposes multiple public product surfaces instead of a gated enterprise build.

## Recommended Boundary Decision

For the next enterprise phase, use this rule:

- NestJS owns CERNIQ ALM product logic, data contracts, and report workflow.
- Rust only absorbs ALM compute workloads once model parity, metadata capture, and validation strategy are explicit.
- Bun prototype surfaces should not influence enterprise architecture decisions unless they are revived intentionally.
