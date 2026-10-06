# Model Card — HJM Two-Factor Yield Curve Engine

## Model Identity

| Field | Value |
|-------|-------|
| **Name** | Heath-Jarrow-Morton (HJM) Two-Factor Forward Curve Model |
| **Version** | 1.0.0 |
| **Implementation** | `backend-node/src/alm/quant/hjm/` |
| **Last Calibration** | April 2026 (2-year FRED H.15 lookback) |
| **Regulatory Reference** | Basel III Pillar 2 — IRRBB (Interest Rate Risk in the Banking Book); COSSEC Circular 2024-01 §IV.B — Sensitivity Analysis Requirements |

---

## Purpose

Model the full forward rate curve evolution — not just parallel shifts — to produce Monte Carlo–derived NII-at-Risk and EVE-at-Risk distributions for Puerto Rico cooperativas under COSSEC supervision.

**Why HJM over Hull-White/Vasicek?**
- Hull-White and Vasicek model a single short rate. HJM models the **entire forward curve** simultaneously.
- Two-factor HJM captures both level shifts (all rates move together) and slope changes (short rates move differently from long rates).
- When COSSEC examiners ask "how does your model account for non-parallel curve shifts?", the answer is HJM two-factor PCA decomposition.

---

## Input Features

| Feature | Type | Source | Description |
|---------|------|--------|-------------|
| Historical rates | `RateTimeSeries` | FRED H.15 (US Treasury CMT) | Daily spot rates across 11 tenors: 1M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, 30Y. Minimum 60 trading days. |
| Spot rates (current) | `Record<TenorLabel, number>` | FRED H.15 or market data feed | Today's yield curve — the starting point for forward curve evolution. |
| Balance sheet items | `BalanceSheetItem[]` | Prisma (institution's data) | Assets and liabilities with duration, rate, and balance for repricing bucket construction. |
| PR municipal spread | `number` (bps) | Default: 85 bps | Spread over UST reflecting PR PROMESA legacy and municipal credit premium. |

---

## Output Variables

| Variable | Type | Description |
|----------|------|-------------|
| `expectedNII` | `number` | Mean net interest income across all Monte Carlo paths |
| `stdNII` | `number` | Standard deviation of NII distribution |
| `niiAtRisk95` | `number` | 5th percentile NII — worst 5% of outcomes |
| `niiAtRisk99` | `number` | 1st percentile NII — worst 1% of outcomes |
| `expectedEVE` | `number` | Mean economic value of equity change |
| `eveAtRisk95` | `number` | 5th percentile EVE change |
| `eveAtRisk99` | `number` | 1st percentile EVE change |
| `niiDistribution` | `number[]` | Full sorted distribution of per-path NII outcomes |
| `fanChart` | `FanChartPoint[]` | Weekly percentile bands (p5/p25/p50/p75/p95) for visualization |
| `convergenceMet` | `boolean` | Whether standard error < 1% of expected NII |

---

## Calibration

### Dataset
- **Source**: FRED H.15 — US Treasury Constant Maturity Rates (daily)
- **Period**: 504 trading days (~2 years, 2024–2026)
- **Tenors**: 11 standard CMT tenors (1M through 30Y)

### Method
1. **Forward rate changes**: Δf(t,T) = f(t+1,T) − f(t,T) for each tenor T
2. **Covariance matrix**: Sample covariance of forward rate changes across all tenors
3. **PCA via power iteration**: Extract top 2 eigenvalue/eigenvector pairs
   - Eigenvector 1 → level factor (parallel shifts)
   - Eigenvector 2 → slope factor (twist)
4. **Annualization**: σₖ = √(eigenvalueₖ × 252)
5. **Factor correlation**: ρ = inner product of eigenvectors (≈0 by PCA construction, computed for numerical honesty)

### Default Parameters (2024–2026 calibration)
- σ₁ = 0.012 (1.2% annualized level volatility)
- σ₂ = 0.006 (0.6% annualized slope volatility)
- ρ = −0.35 (negative: rising rates tend to flatten the curve)
- Variance explained: 94%

---

## Simulation Method

### Forward Curve Evolution (per time step dt = 1/252)

```
f(t+dt, T) = f(t,T) + μ(t,T)·dt + σ₁·dW₁ + σ₂·(T−t)·dW₂
```

Where:
- **Drift correction** (HJM no-arbitrage condition):
  μ(t,T) = σ₁²·(T−t) + σ₂·σ₁·ρ·(T−t)²/2
- **Correlated Brownian increments** via Cholesky:
  dW₁ = L₁₁·Z₁·√dt, dW₂ = (L₂₁·Z₁ + L₂₂·Z₂)·√dt
  where Z₁, Z₂ ~ N(0,1) via Box-Muller transform

### Variance Reduction
- **Antithetic variates**: Each path generates a mirror path (negated Brownian increments), halving estimator variance for the same compute budget.

### NII Computation
- Each repricing bucket is repriced at the evolved forward rate for its tenor
- Asset income = assetBalance × currentRate × dt
- Liability expense = liabilityBalance × liabilityRate × dt
- Path NII = cumulative (income − expense) over 252 steps

### PRNG
- **Seeded xorshift32** — deterministic, no external dependency
- Same seed produces identical paths (verified in test suite)

---

## Validation Approach

### Test Suite (`hjm.spec.ts` — 24 tests)

| Category | Tests | Validates |
|----------|-------|-----------|
| ForwardCurve | 8 | Bootstrap, shock, twist, PR spread, interpolation, boundary extrapolation |
| Calibration | 5 | PCA extraction, data requirements, determinism, realistic ranges |
| Drift Correction | 2 | Zero for past tenors, non-zero structure for future tenors |
| Monte Carlo | 9 | Result structure, reproducibility (same seed), divergence (different seeds), risk ordering, distribution sorting, path limits, fan chart, empty buckets |

### Acceptance Criteria
- `calibrateHJM` with 500 days of treasury data returns σ₁ ∈ [0.001, 0.1]
- `runHJMMonteCarlo` with 500 paths completes in < 60 seconds on a standard container instance
- Same seed = identical `niiDistribution` (verified to 8 decimal places)
- `niiAtRisk95 < expectedNII` for positive-NII institutions

---

## Limitations

1. **Two-factor approximation**: Real yield curves have higher-order modes (curvature, butterfly). Two factors capture ~94% of variance; remaining 6% is unmodeled.
2. **No negative rate modeling**: Forward rates are floored at 0. PR cooperativas do not face negative rate environments, but this limits applicability outside PR.
3. **In-process computation**: Monte Carlo runs on the main Node.js thread. For > 5,000 paths, consider worker_threads offloading (not yet implemented).
4. **Static repricing**: Balance sheet composition is held constant across paths. Real institutions rebalance (prepayments, new originations).
5. **PR spread assumption**: Default 85 bps PR municipal spread is static. Actual spread varies with sovereign credit conditions and PROMESA proceedings.
6. **Calibration lag**: Historical calibration uses a lookback window. Regime changes (sudden Fed pivot, PR fiscal events) may not be captured until the lookback includes post-event data.

---

## Regulatory References

- **Basel III IRRBB** (BCBS d368, 2016): Standards for interest rate risk in the banking book — requires measurement of NII sensitivity and EVE sensitivity under multiple scenarios including non-parallel shifts.
- **COSSEC Circular 2024-01 §IV.B**: Puerto Rico cooperativa ALM requirements — mandates sensitivity analysis under at least 3 rate scenarios.
- **OCC Bulletin 2010-1**: Interest rate risk — recommends Monte Carlo simulation for institutions with complex repricing profiles.
- **FFIEC Interagency Advisory on Interest Rate Risk Management** (2010): Recommends quantifying earnings and economic value impact of rate changes.
