# ALM Workflow

## Confirmed Workflow From Code

1. Institution is created through `POST /api/alm/institutions`.
2. Balance-sheet data is loaded either by manual entry or CSV import.
3. CSV parser validates bilingual headers, categories, rates, and durations.
4. Validation and import outcomes are persisted as ingestion logs with schema version and row-level audit metadata.
5. Imported records are stored as `BalanceSheetItem` rows in Prisma/Postgres.
6. ALM summary is generated from DB-backed items through `AlmEnterpriseService`.
7. Stress testing runs Monte Carlo and regulatory scenarios.
8. Analysis runs can now be persisted with parameter snapshots, result summaries, and balance-sheet snapshots.
9. PDF reports are generated in English and Spanish.
10. Paid customers retrieve reports through the portal and report-job pipeline.

## Confirmed Supporting Endpoints

- `POST /api/alm/institutions`
- `GET /api/alm/institutions`
- `POST /api/alm/institutions/:institutionId/balance-sheet-items`
- `POST /api/alm/institutions/:institutionId/upload-csv`
- `POST /api/alm/analysis/run`
- `GET /api/alm/analysis-runs/:runId`
- `GET /api/alm/institutions/:institutionId/analysis-runs`
- `GET /api/alm/institutions/:institutionId/ingestion-logs`
- `GET /api/alm/:institutionId/summary`
- `GET /api/alm/:institutionId/duration-gap`
- `GET /api/alm/:institutionId/nii-sensitivity`
- `GET /api/alm/:institutionId/liquidity`
- `POST /api/alm/:institutionId/stress-test`
- `GET /api/alm/:institutionId/report`
- `POST /api/portal/jobs/:jobId/submit`
- `GET /api/portal/jobs/:jobId/ingestion-logs`

## Inferred User Modes

### Internal Analyst Mode

- seed a demo institution
- import balance-sheet items
- inspect metrics in dashboard
- export PDF directly

### Client Portal Mode

- pay or subscribe
- receive a report job
- upload CSV for that job
- wait for queued processing
- retrieve bilingual report

## Missing From The Current Workflow

- CLI execution path
- first-class institution API contracts separate from the dashboard
- richer report artifact linkage on top of run metadata
- scenario-set selection and saved assumptions per run

## Recommended Next Iteration

The next enterprise workflow should keep the same core steps but add:

- explicit analysis run creation
- stored run metadata
- exportable assumptions
- validation report artifacts
- repeatable institution-level history

The first three are now partially implemented through the `analysis_runs` and `ingestion_logs` layers.
