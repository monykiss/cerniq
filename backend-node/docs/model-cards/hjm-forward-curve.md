# Model Card: HJM Two-Factor Forward Curve Engine

| Field | Value |
|---|---|
| **Model Name** | HJM Two-Factor Forward Curve Engine |
| **Version** | 1.0.0 |
| **Module** | `src/alm/quant/hjm/` |
| **Purpose** | Full forward-curve evolution for NII-at-Risk and EVE sensitivity |
| **Regulatory Reference** | Basel III IRRBB (SRP31), COSSEC Circular 2024-03 (Interest Rate Risk) |
| **Last Calibration** | April 2026 (2-year rolling FRED H.15 data) |

## What This Model Does

The HJM (Heath-Jarrow-Morton, 1992) engine models how the **entire yield curve** evolves over time, not just a single interest rate. It captures two fundamental movements:

1. **Level factor (sigma1)**: All rates move together (parallel shifts)
2. **Slope factor (sigma2)**: Short rates and long rates move differently (twist/steepening)

These two factors typically explain >90% of yield curve variance in US Treasury data (Litterman & Scheinkman, 1991).

## Input Features

| Input | Source | Type |
|---|---|---|
| Spot rate curve | FRED H.15 / manual override | 11 tenors: 1M through 30Y |
| Historical daily rates | FRED H.15 (2-year lookback) | 500+ observations for calibration |
| Balance sheet repricing buckets | Institution's `BalanceSheetItem` records | Asset/liability balances by maturity |
| PR municipal spread | Calibrated (default: 85 bps) | Additive spread over UST |

## Output Variables

| Output | Description | Unit |
|---|---|---|
| Expected NII | Mean net interest income across all paths | $M |
| NII-at-Risk (95%) | 5th percentile NII (worst 5% of scenarios) | $M |
| NII-at-Risk (99%) | 1st percentile NII (worst 1% of scenarios) | $M |
| EVE change distribution | Economic value of equity change by path | $M |
| Fan chart | Percentile bands (p5/p25/p50/p75/p95) over time | Weekly |
| Standard error | Monte Carlo sampling error of mean estimate | $M |

## Calibration

- **Method**: Principal Component Analysis (PCA) on daily forward rate changes
- **Data source**: US Treasury constant maturity rates (FRED series DGS1MO through DGS30)
- **Lookback**: 2 years of daily observations (~504 trading days)
- **Output**: sigma1 (level vol), sigma2 (slope vol), rho (factor correlation)
- **Typical values**: sigma1 ~ 0.008–0.020, sigma2 ~ 0.003–0.010, rho ~ -0.5 to 0.0
- **Variance explained**: >90% for real treasury data

## Simulation Parameters

| Parameter | Default | Range | Rationale |
|---|---|---|---|
| Paths | 500 | 100–50,000 | 500 balances speed vs accuracy for cooperativa ALM |
| Steps | 252 | 63–1,260 | 252 = 1 year of trading days |
| Seed | 42 | any integer | Fixed for reproducibility (regulatory requirement) |
| Antithetic variates | Yes | — | Halves variance at zero cost |

## Validation Approach

1. **Reproducibility**: Same seed produces identical paths. Verified in `hjm.spec.ts`.
2. **Sanity**: NII-at-Risk < Expected NII for positive-NII institutions.
3. **Fan chart monotonicity**: p5 <= p25 <= p50 <= p75 <= p95 at every time step.
4. **Convergence**: Standard error < 1% of expected NII (with 500 paths).
5. **Boundary**: Empty repricing buckets produce zero NII (not NaN/error).

## Limitations

1. **No negative rates**: Forward rates are floored at 0. Not applicable for PR cooperativas but would need adjustment for EUR/JPY environments.
2. **Two factors only**: Curvature (butterfly) movements are not captured. For PR cooperativa ALM, level+slope explains sufficient variance.
3. **Static balance sheet**: The simulation does not model balance sheet growth, prepayments, or new origination. Forward simulation of balance sheet dynamics is handled by `forward-simulation.service.ts`.
4. **Daily time step**: Intra-day rate movements are not modeled.
5. **Default calibration**: When historical data is unavailable, default parameters are used (calibrated Q4 2025). Live FRED calibration should be enabled for production.
6. **No jump diffusion**: Extreme rate movements (Fed emergency cuts) are modeled as Brownian tails, not jumps.

## Regulatory Context

- **Basel III IRRBB (SRP31)**: Requires banks to measure NII sensitivity under prescribed rate shock scenarios. HJM provides a stochastic complement to the deterministic shocks.
- **COSSEC Circular 2024-03**: Requires cooperativas to demonstrate interest rate risk measurement. HJM is the most rigorous methodology available for this purpose.
- **Model validation**: COSSEC examiners should verify (1) calibration data source and recency, (2) path reproducibility with fixed seed, (3) that the fan chart width is consistent with historical rate volatility.
