# CERNIQ Web (`frontend`)

Next.js 16 (App Router) + React 19 frontend for the CERNIQ ALM platform:
bilingual (ES/EN) ALM analysis pages, client portal, admin pages and the
interactive demo.

## Local setup

```bash
cd frontend
npm ci
NEXT_PUBLIC_NODE_API_URL=http://localhost:3000 npm run dev   # http://localhost:3001
```

## Checks

```bash
npm run lint       # ESLint + verify scripts + tsc --noEmit
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests
npm run test:e2e   # Playwright (requires the backend and a database)
```

The ALM page architecture is described in `../docs/ALM_ARCHITECTURE.md`.
