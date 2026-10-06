# CERNIQ Database Schema

> Complete reference for the Prisma data model in `backend-node/prisma/schema.prisma`.

---

## Overview

- **ORM:** Prisma 7
- **Database:** PostgreSQL 15 (TimescaleDB image)
- **Schema file:** `backend-node/prisma/schema.prisma` (813 lines)
- **Models:** 30+
- **Enums:** 10
- **Seeds:** `prisma/seed.ts` (general), `prisma/seed-alm-demo.ts` (ALM demo data)

---

## Entity Relationship Overview

```
User ─────┬──── Organization (via OrganizationMember)
          ├──── Portfolio ──── Position ──── Ticker
          ├──── Workspace ──┬── Institution ──┬── BalanceSheetItem
          │                 │                 ├── InterestRateScenario
          │                 │                 ├── LiquidityPosition
          │                 │                 ├── AnalysisRun
          │                 │                 └── IngestionLog
          │                 ├── Upload ──── Invoice ──── Finding
          │                 └── Report
          ├──── Subscription
          ├──── ReportJob
          ├──── Expense
          ├──── RefreshToken
          ├──── ApiKey
          ├──── MagicLink
          ├──── PasswordResetToken
          └──── PartnerConfig
```

---

## Models

### Identity & Auth

| Model | Table | Purpose |
|-------|-------|---------|
| **User** | `users` | Core user account. Fields: email, name, avatarUrl, passwordHash, provider, role, emailVerified |
| **RefreshToken** | `refresh_tokens` | JWT refresh token storage. 7-day expiry, revocable |
| **PasswordResetToken** | `password_reset_tokens` | Time-limited password reset tokens |
| **ApiKey** | `api_keys` | Developer API keys. SHA-256 hashed, prefix-prefixed, expirable |
| **MagicLink** | `magic_links` | Passwordless login tokens (post-payment, email auth) |

### Multi-Tenancy

| Model | Table | Purpose |
|-------|-------|---------|
| **Organization** | `organizations` | Company/team container. Slug-based routing |
| **OrganizationMember** | `organization_members` | User↔Org junction. Roles: ADMIN, MEMBER, VIEWER |
| **Workspace** | `workspaces` | Data isolation boundary (uploads, institutions) |

### ALM Enterprise (Core Product)

| Model | Table | Purpose |
|-------|-------|---------|
| **Institution** | `institutions` | Financial institution profile. Type: bank, credit_union, cooperativa. Includes COSSEC reg number, ALCO config, examiner dates |
| **BalanceSheetItem** | `balance_sheet_items` | Individual assets & liabilities. Fields: category (asset/liability), subcategory, balance, rate, duration, rateType (fixed/variable/hybrid) |
| **InterestRateScenario** | `interest_rate_scenarios` | Rate shock results: shiftBps, niImpact, mveImpact, duration |
| **LiquidityPosition** | `liquidity_positions` | HQLA levels, cash flows, LCR, NSFR per date |
| **AnalysisRun** | `analysis_runs` | Execution record. Stores parameterSnapshot, balanceSheetSnapshot, resultSummary. Status: RUNNING → COMPLETED/FAILED |
| **IngestionLog** | `ingestion_logs` | CSV upload audit trail. Tracks rows: total, valid, error. Supports dry-run mode |

### Billing & Subscriptions

| Model | Table | Purpose |
|-------|-------|---------|
| **Subscription** | `subscriptions` | User subscription. Tiers: free, one_time, monthly, annual, partner. Links to Stripe IDs |
| **ReportJob** | `report_jobs` | Report generation lifecycle. Status: AWAITING_DATA → VALIDATING → QUEUED → PROCESSING → GENERATING_PDF → UPLOADING → COMPLETE. Stores encrypted raw CSV data (AES-256-GCM), purged at 90 days |

### Partner / White-Label

| Model | Table | Purpose |
|-------|-------|---------|
| **PartnerConfig** | `partner_configs` | CPA/consultant branding: firm name, logo, colors, cover footer |

### Market Data

| Model | Table | Purpose |
|-------|-------|---------|
| **Ticker** | `tickers` | Asset reference: stock, crypto, ETF, future. Metadata JSON |
| **MarketPrice** | `market_prices` | OHLCV price data. Unique on (ticker, date) |
| **PipelineRun** | `pipeline_runs` | Batch market data collection status |

### Portfolio

| Model | Table | Purpose |
|-------|-------|---------|
| **Portfolio** | `portfolios` | User portfolio container |
| **Position** | `positions` | Individual holding. Unique on (portfolioId, ticker) |

### SpendCheck (Legacy)

| Model | Table | Purpose |
|-------|-------|---------|
| **Expense** | `expenses` | Expense tracking with AI OCR extraction. Status: DRAFT → SUBMITTED → APPROVED → REIMBURSED |
| **Upload** | `uploads` | File upload records |
| **Invoice** | `invoices` | Parsed invoice data |
| **Finding** | `findings` | AI-detected anomalies (duplicates, price drift) |
| **Report** | `reports` | Generated spend reports |

### Compliance & Feedback

| Model | Table | Purpose |
|-------|-------|---------|
| **AuditLog** | `audit_logs` | OCIF-compliant audit trail. Actions: login, data_upload, report_download, etc. |
| **CooperativaBenchmark** | `cooperativa_benchmarks` | Sector benchmark data by period |
| **Feedback** | `feedback` | NPS scores and user comments |

---

## Enums

| Enum | Values | Used By |
|------|--------|---------|
| `InstitutionRole` | OWNER, ANALYST, VIEWER | User |
| `MemberRole` | ADMIN, MEMBER, VIEWER | OrganizationMember |
| `ExpenseStatus` | DRAFT, SUBMITTED, APPROVED, REJECTED, REIMBURSED | Expense |
| `PipelineStatus` | RUNNING, SUCCESS, FAILED | PipelineRun |
| `SubscriptionTier` | free, one_time, monthly, annual, partner | Subscription |
| `SubscriptionStatus` | active, past_due, cancelled, grace_period | Subscription |
| `AnalysisRunStatus` | RUNNING, COMPLETED, FAILED | AnalysisRun |
| `IngestionLogStatus` | VALIDATED, IMPORTED, FAILED, DRY_RUN | IngestionLog |
| `ReportJobStatus` | AWAITING_DATA, VALIDATING, VALIDATION_FAILED, QUEUED, PROCESSING, GENERATING_PDF, UPLOADING, COMPLETE, FAILED | ReportJob |

---

## Migrations

Located in `backend-node/prisma/migrations/`. Managed by Prisma Migrate.

```bash
npx prisma migrate dev --name description   # Create + apply
DATABASE_URL="postgresql://..." npm run prisma:status
DATABASE_URL="postgresql://..." ALLOW_SCHEMA_MIGRATIONS=true npm run prisma:deploy
```

---

## Seed Data

```bash
npx prisma db seed         # General seed (users, institutions, tickers)
```

**Seed files:**
- `prisma/seed.ts` — Base data (test users, market tickers, demo institutions)
- `prisma/seed-alm-demo.ts` — ALM-specific demo data (balance sheets, scenarios)
