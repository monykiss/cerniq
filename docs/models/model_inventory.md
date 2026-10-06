# Model Inventory

## Functioning Core

### Duration Gap

- Status: functioning core
- Source: `backend-node/src/alm/alm.service.ts`
- Notes: weighted asset/liability duration with leverage-adjusted gap and interpretation output

### NII Sensitivity

- Status: functioning core
- Source: `backend-node/src/alm/alm.service.ts`
- Notes: parallel shock scenarios across default and custom basis-point shocks

### EVE

- Status: functioning core
- Source: `backend-node/src/alm/alm.service.ts`
- Notes: present-value based equity sensitivity under rate shocks

### LCR

- Status: functioning core
- Source: `backend-node/src/alm/alm.service.ts`
- Notes: Basel-style HQLA logic with level caps and compliance status

### BPV / DV01

- Status: functioning core
- Source: `backend-node/src/alm/alm.service.ts`
- Notes: per-instrument and net basis-point value output

## Partial Build

### Monte Carlo Stress Testing

- Status: partial build
- Source: `backend-node/src/alm/stress-testing/stress-testing.service.ts`
- Notes: Vasicek-style monthly short-rate simulation and NII distribution bands exist, but there is no persistent model-governance layer around assumptions or run history

### Regulatory Scenario Testing

- Status: partial build
- Source: `backend-node/src/alm/stress-testing/stress-testing.service.ts`
- Notes: regulatory scenarios exist, but scenario libraries are hard-coded rather than managed as institutional datasets

### COSSEC Compliance

- Status: partial build
- Source: `backend-node/src/alm/alm-enterprise.service.ts`
- Notes: useful cooperativa-specific checks exist, but formal regulatory mapping docs and test coverage are limited

## Adjacent, Not ALM Core

### Portfolio VaR / Risk Analytics

- Status: partial build
- Sources: `backend-node/src/risk/*`, `backend/src/routes/risk.rs`, `crates/compute-core/src/*`
- Notes: these models support broader quant products, not the main CERNIQ ALM workflow

### Options / Valuation / Execution Models

- Status: partial build
- Sources: NestJS options, valuation, and execution modules plus `crates/compute-core`
- Notes: active but outside the narrow enterprise ALM wedge

## Missing Or Unverifiable

- key rate duration
- convexity analytics for ALM
- deposit beta modeling with documented assumptions
- prepayment modeling
- stored yield-curve assumptions per analysis
- model registry with version, parameter, and scenario metadata
- benchmark validation against institutional external datasets
