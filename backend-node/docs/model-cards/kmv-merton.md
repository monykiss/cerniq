# Model Card — KMV-Merton PR Credit Risk Engine

## Model Identity

| Field | Value |
|-------|-------|
| **Name** | Vasicek Single-Factor Portfolio Credit Risk Model with PR-Specific LGD Calibration |
| **Version** | 1.1.0 (April 2026 — phantom fallback eliminated, DataGap convention applied) |
| **Implementation** | `backend-node/src/alm/quant/credit/` |
| **LGD Calibration** | FDIC Loss Share (2009–2024), CRIM assessments (2018–2025), FEMA IA (2017–2019) |
| **Regulatory Reference** | Basel III Pillar 1 — IRB Credit Risk (BCBS d424); COSSEC Circular 2024-01 §III — Credit Risk Assessment |

---

## Purpose

Estimate Expected Loss (EL), Unexpected Loss (UL), and Economic Capital for Puerto Rico cooperativa loan portfolios. The model incorporates PR-specific empirical data that mainland vendors (Abrigo, Ncontracts) do not calibrate:

1. **CRIM property valuation gap**: PR's Centro de Recaudacion de Ingresos Municipales assesses property at 60–80% of market value, systematically reducing collateral recovery.
2. **Hurricane Maria (2017) haircuts**: Permanent 10–15% collateral value reduction for coastal/flood-zone properties.
3. **Island economy concentration**: Higher intra-portfolio asset correlation due to single-island geographic exposure and single-regulator (COSSEC) dependency.

---

## Input Features

| Feature | Type | Source | Description |
|---------|------|--------|-------------|
| Loan categories | `LoanType[]` | Institution data | RESIDENTIAL_MORTGAGE, COMMERCIAL_REAL_ESTATE, CONSUMER_UNSECURED, AUTO_LOAN, COMMERCIAL_BUSINESS |
| Outstanding balance | `number` ($) | Balance sheet | Exposure at Default (EAD) per loan category |
| DSCR | `number` (ratio) | Financial statements | Debt Service Coverage Ratio — measures cash flow adequacy |
| LTV | `number` (0–1) | Appraisal / CRIM | Loan-to-Value ratio — collateral coverage |
| Delinquency rate | `number` (0–1) | Portfolio data | 30+ day delinquency rate per category |
| Loan loss reserve | `number` ($) | Balance sheet | Current allowance for loan losses |

---

## Output Variables

| Variable | Type | Description |
|----------|------|-------------|
| `byCategory` | `CategoryRisk[]` | Per-loan-type breakdown: PD, LGD, EAD, EL, UL, asset correlation |
| `totalEL` | `number` | Portfolio expected loss = Σ(PD × LGD × EAD) |
| `totalUL` | `number` | Portfolio unexpected loss = Σ(Vasicek UL) |
| `economicCapital` | `number` | Capital required above EL for 99.9% stress survival |
| `coverageRatio` | `number \| null` | Loan loss reserve / total EL — measures reserve adequacy |
| `capitalAdequacy` | `string` | 'adequate' (≥1.2×), 'marginal' (0.8–1.2×), 'insufficient' (<0.8×) |
| `interpretation` | `string` | EN narrative summarizing highest-risk category and coverage |
| `interpretationEs` | `string` | ES narrative (COSSEC examiner–facing) |

---

## Model Components

### 1. Probability of Default (PD) — Logistic Regression

```
logit(PD) = β₀ + β₁·DSCR + β₂·LTV + β₃·DelinquencyRate
PD = 1 / (1 + exp(−logit))
```

**Coefficients by loan type:**

| Loan Type | β₀ | β₁ (DSCR) | β₂ (LTV) | β₃ (Delinq.) |
|-----------|-----|-----------|----------|--------------|
| Residential Mortgage | −4.2 | −1.8 | 2.1 | 3.5 |
| Commercial RE | −3.8 | −1.5 | 2.4 | 3.0 |
| Consumer Unsecured | −3.0 | −1.2 | 0.0* | 4.0 |
| Auto Loan | −3.5 | −1.4 | 1.8 | 3.8 |
| Commercial Business | −3.6 | −2.0 | 1.9 | 3.2 |

*Consumer unsecured: LTV coefficient is 0 (no collateral).

**Calibration source**: FDIC Quarterly Banking Profile, Table III-A (Loan Performance, Noncurrent Rate by Asset Size), filtered for institutions <$10B in assets to match PR cooperativa profile.

**Clamped**: PD ∈ [0.001, 0.999] per Basel III requirement of non-zero PD.

### 2. Loss Given Default (LGD) — PR Empirical Table

| Loan Type | Base LGD | Hurricane Adj. | CRIM Discount | Effective LGD* |
|-----------|---------|---------------|--------------|---------------|
| Residential Mortgage | 25% | +10% | +20% | 45% / 55% |
| Commercial RE | 35% | +15% | +20% | 55% / 70% |
| Consumer Unsecured | 65% | — | — | 65% |
| Auto Loan | 40% | — | — | 40% |
| Commercial Business | 45% | +5% | +10% | 55% / 60% |

*Non-hurricane / hurricane zone. Effective = base + CRIM + hurricane (if applicable).

**Calibration sources**:
- FDIC Loss Share data (2009–2024): Base recovery rates by loan type
- CRIM assessments (2018–2025): Property valuation gap quantification
- FEMA Individual Assistance data (2017–2019): Hurricane Maria collateral impact
- COSSEC quarterly reports: PR cooperativa-specific loss experience

### 3. Asset Correlation — PR-Adjusted Basel III

| Loan Type | Basel III | PR Adjustment | CerniQ Value |
|-----------|---------|--------------|-------------|
| Residential Mortgage | 0.15 | +0.03 | 0.18 |
| Commercial RE | 0.20 | +0.02 | 0.22 |
| Consumer Unsecured | 0.08 | +0.04 | 0.12 |
| Auto Loan | 0.10 | +0.02 | 0.12 |
| Commercial Business | 0.18 | +0.02 | 0.20 |

**PR adjustment rationale**: Geographic concentration (single island), single-regulator dependency (COSSEC), common macro exposure (PROMESA, hurricane risk, population decline).

### 4. Unexpected Loss — Vasicek Single-Factor Model

```
UL = N(N⁻¹(PD)/√(1−ρ) + √(ρ/(1−ρ))·N⁻¹(0.999)) × LGD × EAD − EL
```

Where:
- N() = standard normal CDF — Abramowitz & Stegun 26.2.17 approximation (accurate to ~7.5e-8)
- N⁻¹() = standard normal inverse CDF — Beasley-Springer-Moro algorithm (accurate to 8 decimal places for p ∈ [0.0001, 0.9999])
- ρ = asset correlation from PR-adjusted table
- 0.999 = 99.9% confidence level (Basel III standard)

**Verification**: N(0) = 0.5, N(1.645) = 0.9500 ± 0.0001, N⁻¹(0.999) = 3.090 ± 0.001.

---

## Validation Approach

### Sanity Checks
- `computeCreditRisk` for a $100M consumer portfolio with 3% delinquency rate, 0.70 LTV should return EL in the range of $2M–$5M (consistent with FDIC industry benchmarks for similar-sized community institutions).
- `normalCDF(1.645)` returns 0.9500 ± 0.0001.
- `normalInverse(0.999)` returns 3.090 ± 0.001.
- Hurricane adjustment for residential mortgage increases LGD by exactly 10 percentage points.
- Empty portfolio input returns `data_unavailable` result (not zero, not error).

### Cross-Validation
- Compare output against Basel III standardized approach capital charges for the same portfolio composition.
- Verify that economic capital exceeds the sum of expected losses for all non-degenerate portfolios (economic capital should provide a buffer above EL).

---

## Limitations

1. **Single-factor simplification**: The Vasicek model assumes a single systematic risk factor drives all defaults. In reality, PR cooperativas face multiple correlated macro factors (interest rates, hurricane frequency, population migration, Act 60 effects).
2. **Static coefficients**: PD logistic regression coefficients are calibrated from historical FDIC data and are not re-estimated dynamically. Structural economic shifts in PR (e.g., post-PROMESA recovery) may cause coefficient drift.
3. **Point-in-time PD**: The model produces a point-in-time PD, not a through-the-cycle PD. Results are sensitive to current delinquency rates and may be procyclical.
4. **No granularity adjustment**: The Vasicek formula assumes infinite granularity (perfectly diversified portfolio). Small cooperativas with concentrated loan books may experience higher-than-modeled UL. A Herfindahl concentration adjustment is recommended for portfolios with fewer than 100 borrowers.
5. **Hurricane adjustment timing**: The 10–15% hurricane LGD adjustment is calibrated from Maria (2017) data. Future hurricane events may produce different collateral impacts depending on storm path, building code compliance, and insurance coverage evolution.
6. **CRIM assessment lag**: CRIM property assessments are updated infrequently. The 20% CRIM discount assumes assessments are 2–5 years stale. If CRIM modernizes its assessment process, this discount should be recalibrated.

---

## Regulatory References

- **Basel III IRB Framework** (BCBS d424, 2017): Internal Ratings-Based approach for credit risk capital requirements. Vasicek formula is the regulatory foundation for portfolio credit risk.
- **COSSEC Circular 2024-01 §III**: Credit risk assessment requirements for PR cooperativas — mandates identification, measurement, and monitoring of credit concentrations.
- **COSSEC Reglamento 9404**: Capital adequacy requirements for cooperativas de ahorro y credito.
- **Ley 255-2002**: Ley de las Sociedades Cooperativas de Ahorro y Credito — establishes the regulatory framework and capital requirements.
- **FDIC Risk Management Manual, §3.2**: Credit risk analysis methodologies for community institutions.
- **OCC Bulletin 2020-32**: Credit concentration risk — guidance on single-name and sector concentration measurement.
