# CERNIQ API (`backend-node`)

NestJS 11 + Prisma 7 API for the CERNIQ ALM platform: the quantitative ALM
engine, COSSEC/NCUA regulatory modules, client portal, report pipeline and
LLM agent runtime.

## Local setup

```bash
# from the repo root: start Postgres + Redis (see .env.example for required vars)
docker compose up -d postgres redis

cd backend-node
npm ci
npx prisma generate
npx prisma migrate dev
npm run start:dev          # http://localhost:3000
```

## Checks

```bash
npm run lint      # ESLint + repository verify gates + tsc --noEmit
npm run build     # nest build
npm test          # Jest unit tests
npm run test:e2e  # HTTP-level e2e specs (mocked Prisma client)
```

Model documentation lives in `docs/model-cards/`; the row-level-security
design is in `docs/security/rls-architecture.md`.
