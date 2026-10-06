# Model Card — Capital-Ratio-Under-Stress Projection

## Model Identity

| Field                    | Value                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                 | Seeded Parametric Capital-Ratio Stress Band (lognormal severity + single-factor Gaussian copula)                                   |
| **Version**              | 1.0.0 (June 2026)                                                                                                                  |
| **Implementation**       | `backend-node/src/alm/demo/capital-ratio-projection.ts`                                                                            |
| **Consumed by**          | `SicDemoService` (`backend-node/src/alm/demo/sic-demo.service.ts`) — the offline SIC 2026 demo harness (`npm run demo:sic`)        |
| **Reproducibility**      | Deterministic given `seed` (xorshift32 + Box–Muller, FNV-1a-keyed). No `Math.random` / `crypto.randomBytes`. SR 11-7 §VI.          |
| **Regulatory Reference** | Basel III IRB single-factor model (BCBS d424); operational-risk LDA lognormal severity (BCBS AMA); SR 11-7 (model risk management) |

---

## Purpose

Express the **uncertainty band** around an _already-computed_ deterministic stressed capital ratio, so a stress result can be communicated as a distribution ("baseline X% → adverse-tail Y% at p5, Z bps vs the COSSEC floor") rather than a single point.

The model is deliberately **anchored, not generative**: the central (expected) estimate is the ALM engine's own deterministic stressed capital ratio. This projection only widens that point into a band — it never invents the centre. It is a **communication tool**, not a regulatory capital model.

---

## Input Features

| Feature                                      | Type              | Source                                        | Description                                                       |
| -------------------------------------------- | ----------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `baseEquity`                                 | `number` ($M)     | COSSEC summary (`equity`)                     | Net worth before stress                                           |
| `totalAssets`                                | `number` ($M)     | COSSEC summary                                | Capital-ratio denominator                                         |
| `deterministicLosses.creditLoss`             | `number` ($M ≥ 0) | `runCOSSECScenarios` (segment-targeted)       | Incremental credit loss under the scenario                        |
| `deterministicLosses.depositCost`            | `number` ($M ≥ 0) | `runCOSSECScenarios`                          | Funding cost from deposit runoff                                  |
| `deterministicLosses.niiShortfall`           | `number` ($M ≥ 0) | `max(0, −niiImpact)`                          | Lost net interest income (earnings that would have built capital) |
| `cossecMinimumPct`                           | `number` (%)      | Regulatory constant (default 7)               | COSSEC leverage capital floor                                     |
| `seed`                                       | `string`          | Caller (`scenarioId:seedKey`)                 | Deterministic RNG key                                             |
| `paths`                                      | `number`          | Caller (default 10000, clamped [200, 100000]) | Monte Carlo paths                                                 |
| `assumptions.{credit,deposit,nii}SeverityCv` | `number`          | Disclosed assumption (0.40 / 0.30 / 0.35)     | Severity coefficient of variation per channel                     |
| `assumptions.systemicCorrelation`            | `number` ∈ [0,1]  | Disclosed assumption (default 0.5)            | Correlation of each channel to the systemic factor                |

---

## Output Variables

| Variable                                | Type       | Description                                                     |
| --------------------------------------- | ---------- | --------------------------------------------------------------- |
| `baselineCapitalRatioPct`               | `number`   | `equity / totalAssets × 100`                                    |
| `deterministic.stressedCapitalRatioPct` | `number`   | `(equity − Σ losses) / totalAssets × 100` — the anchored centre |
| `distribution.{p5,p25,p50,p75,p95}`     | `number`   | Percentiles of the stressed capital ratio (`p5` = adverse tail) |
| `meanCapitalRatioPct`                   | `number`   | Sample mean — equals the deterministic centre by construction   |
| `breachProbabilityPct`                  | `number`   | Share of paths below `cossecMinimumPct`                         |
| `adverseCushionBps`                     | `number`   | `(p5 − cossecMinimumPct) × 100`                                 |
| `breachesFloorAtAdverseTail`            | `boolean`  | `p5 < cossecMinimumPct`                                         |
| `disclosures`                           | `string[]` | Plain-language statement of the model structure + assumptions   |

---

## Model Components

### 1. Deterministic centre (anchored to the engine)

```
totalLoss   = creditLoss + depositCost + niiShortfall
stressedCR  = (baseEquity − totalLoss) / totalAssets × 100
```

This equals the ALM engine output exactly; the projection adds no central bias.

### 2. Lognormal severity multiplier (mean-preserving)

Each deterministic loss is scaled by an independent **mean-1 lognormal** multiplier:

```
S = exp(σ·X − σ²/2),   σ = sqrt(ln(1 + CV²)),   X ~ N(0,1)
E[S] = 1   (exact)      S > 0   (always)
```

Lognormal is chosen over an additive `(1 + CV·Z)` shock because it (a) is always positive — a loss multiplier cannot be negative, no truncation artifact; (b) has an exact unit mean — the band stays centred on the engine output; and (c) is right-skewed — losses can be far worse than expected and only modestly better, matching observed loss severities.

### 3. Single-factor Gaussian copula (systemic correlation)

Each channel's driver shares a common systemic factor so the three losses worsen **together** in a macro scenario (no spurious diversification in the tail):

```
X_i = √ρ · Z_sys + √(1−ρ) · Z_i      Z_sys, Z_i ~ N(0,1) i.i.d.
```

ρ = 0 → independent; ρ = 1 → perfectly correlated. The default ρ = 0.5 reflects that credit, funding, and NII pressure under a single named macro scenario ("Global Restructuring") are materially co-driven. Correlation moves the _variance_ (tail width), not the _mean_.

### 4. Seeded PRNG

`FNV-1a(seed)` → uint32 → `xorshift32` uniform stream → `Box–Muller` standard normals. Integer + IEEE-754 operations only ⇒ cross-platform reproducible. Each path draws 4 normals (1 systemic + 3 idiosyncratic).

### 5. Aggregation

```
pathLoss_k  = Σ_i loss_i · S_i(path k)
ratio_k     = (baseEquity − pathLoss_k) / totalAssets × 100
```

Percentiles are taken on the sorted `ratio_k`; `breachProbability` counts `ratio_k < cossecMinimumPct`.

---

## Validation Approach

Locked in `capital-ratio-projection.spec.ts`:

- **Anchoring**: `meanCapitalRatioPct` equals `deterministic.stressedCapitalRatioPct` within MC error (mean-1 lognormal).
- **Positivity**: severities `> 0` ⇒ every path loss `> 0` ⇒ even the benign tail (`p95`) sits below baseline (stress only erodes capital).
- **Ordering**: `p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95`.
- **Correlation effect**: raising ρ lowers `p5` (fatter adverse tail) while leaving the mean unchanged.
- **Reproducibility (SR 11-7)**: same seed ⇒ deep-equal result; a different seed redraws the band but preserves the deterministic centre.
- **Monotonicity**: larger losses ⇒ lower stressed ratio and `≥` breach probability.
- **Breach detection**: losses that drive the centre below the floor flag `breachesFloorAtAdverseTail` and a `> 50%` breach probability.

---

## Backtest (ongoing monitoring)

`capital-ratio-backtest.ts` runs an SR 11-7 outcomes-analysis suite — runnable via `npm run demo:sic -- --backtest` and CI-locked in `capital-ratio-backtest.spec.ts`. The checks validate the sampler against **closed-form theory** and structural invariants (deliberately non-circular):

| Check                    | Method                                                                                                                            | Tolerance |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **breach-calibration**   | Single lognormal channel: empirical breach frequency vs the analytic tail `P(S > s*) = 1 − Φ((ln s* + σ²/2)/σ)` (Φ = A&S 26.2.17) | < 0.5pp   |
| **mean-unbiased**        | Sample mean of the stressed ratio vs the deterministic centre (validates `E[S] = 1`)                                              | < 0.05pp  |
| **convergence**          | Cross-seed std of the mean must shrink as paths grow (1/√N)                                                                       | std↓      |
| **percentile-ordering**  | `p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95` across all seeds                                                                                     | exact     |
| **copula-tail-widening** | `p95 − p5` must widen as ρ rises (systemic factor removes diversification)                                                        | width↑    |

Representative run (12 seeds × 20000 paths): empirical breach **10.59%** vs closed-form **10.65%** (0.07pp); mean **8.002%** vs centre **8.000%** (0.002pp); cross-seed std **0.0213 → 0.0069** as N goes 1k→20k. The breach-calibration check is the load-bearing one: it exercises the full pipeline (seeded RNG → Box–Muller → lognormal transform → breach counting) against math the implementation cannot influence.

---

## Limitations

1. **Assumption-driven band, not calibrated.** The severity CVs (0.40 / 0.30 / 0.35) and systemic correlation (0.5) are disclosed communication assumptions, not estimated from PR cooperativa loss history. They size the band, not the centre — but the tail (p5, breach probability) is sensitive to them. They are echoed in `disclosures[]` and `assumptions` on every result.
2. **Single systemic factor.** Like the Basel IRB foundation, this collapses all co-movement into one factor. Real scenarios have multiple correlated macro drivers (rates, hurricane frequency, migration).
3. **Severity-only.** The model takes the engine's deterministic losses as given and varies their _severity_; it does not re-model the rate→NII or PD→loss mechanics. Those live in the upstream ALM engine (and carry their own model cards).
4. **Single-period.** The band is a one-period capital snapshot under stress; it does not model multi-period capital accretion, dividend/patronage policy, or management action.
5. **Not a regulatory capital figure.** This is a demonstration/communication band. The statutory capital ratio (RWA-based, `capitalRatioRWA`) and COSSEC's formal stress methodology are separate and authoritative.
6. **Independence of idiosyncratic draws.** Beyond the shared systemic factor, the channel-specific shocks are independent; any residual channel-pair correlation is not modelled.

---

## Regulatory References

- **Basel III IRB Framework** (BCBS d424, 2017): single-factor Gaussian-copula portfolio model — the structural basis for the systemic-factor correlation.
- **BCBS Operational Risk — Loss Distribution Approach**: lognormal severity distributions for loss modelling.
- **SR 11-7 (Federal Reserve / OCC, 2011) — Guidance on Model Risk Management**: model documentation, assumption disclosure, and reproducibility (identical inputs → identical outputs) requirements.
- **COSSEC Reglamento 9404 / Ley 255-2002**: PR cooperativa capital-adequacy minimums against which the projected ratios are compared.
