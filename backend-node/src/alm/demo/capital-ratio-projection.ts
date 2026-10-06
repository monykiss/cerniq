/**
 * Capital-ratio-under-stress projection (seeded, reproducible).
 *
 * Given a deterministic stress result from the ALM engine (credit loss, deposit
 * funding cost, NII shortfall) this produces a DISTRIBUTION of stressed capital
 * ratios by drawing seeded severity multipliers around each deterministic loss.
 *
 * Design contract:
 *  - The DETERMINISTIC point (no severity) equals the engine's own stressed
 *    capital ratio exactly — the projection never invents the central estimate,
 *    it only widens it into a band.
 *  - Seeded (xorshift32 + Box–Muller, FNV-1a-keyed) ⇒ identical inputs produce
 *    identical output (SR 11-7). No `Math.random` / `crypto.randomBytes`.
 *  - The severity coefficients of variation are DISCLOSED model assumptions
 *    (not empirically calibrated); they are echoed in `disclosures[]` so a
 *    reviewer sees exactly what shaped the band.
 *
 * This is a parametric stress band for communication, anchored to real,
 * engine-computed losses — not a fabricated number.
 */

export interface CapitalRatioProjectionInput {
  /** Net worth / equity before stress, $M. */
  baseEquity: number;
  /** Total assets, $M (the capital-ratio denominator). */
  totalAssets: number;
  /** COSSEC statutory minimum capital ratio, percent (e.g. 7). */
  cossecMinimumPct: number;
  /** Deterministic stress losses from the engine, all $M, all ≥ 0. */
  deterministicLosses: {
    /** Incremental credit loss (segment-targeted). */
    creditLoss: number;
    /** Incremental funding cost from deposit runoff. */
    depositCost: number;
    /** Lost net interest income vs baseline (earnings that would have built capital). */
    niiShortfall: number;
  };
  /** Deterministic seed string ⇒ reproducible draws. */
  seed: string;
  /** Monte Carlo paths (clamped to [200, 100000]). Default 10000. */
  paths?: number;
  /**
   * Disclosed model assumptions. Severities are mean-1 LOGNORMAL multipliers
   * keyed off each coefficient of variation; `systemicCorrelation` ties the three
   * loss channels to a common factor (single-factor Gaussian copula) so they
   * worsen together in a macro scenario. Defaults are conservative communication
   * assumptions, not empirically calibrated.
   */
  assumptions?: {
    creditSeverityCv?: number;
    depositSeverityCv?: number;
    niiSeverityCv?: number;
    /** Correlation ρ∈[0,1] of each channel to the systemic factor. */
    systemicCorrelation?: number;
  };
}

export interface CapitalRatioPercentiles {
  /** Adverse tail — 5th percentile of the capital-ratio distribution. */
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  /** Benign tail — 95th percentile. */
  p95: number;
}

export interface CapitalRatioUnderStress {
  baselineCapitalRatioPct: number;
  deterministic: {
    creditLoss: number;
    depositCost: number;
    niiShortfall: number;
    totalLoss: number;
    stressedEquity: number;
    stressedCapitalRatioPct: number;
  };
  /** Percentiles of the stressed capital ratio (p5 = adverse). */
  distribution: CapitalRatioPercentiles;
  meanCapitalRatioPct: number;
  /** Share of paths whose stressed capital ratio falls below the COSSEC minimum. */
  breachProbabilityPct: number;
  /** Adverse-tail (p5) cushion above the COSSEC minimum, in basis points. */
  adverseCushionBps: number;
  /** True when the adverse-tail (p5) capital ratio is below the COSSEC minimum. */
  breachesFloorAtAdverseTail: boolean;
  paths: number;
  seed: string;
  assumptions: {
    creditSeverityCv: number;
    depositSeverityCv: number;
    niiSeverityCv: number;
    systemicCorrelation: number;
  };
  disclosures: string[];
}

const DEFAULT_ASSUMPTIONS = {
  creditSeverityCv: 0.4,
  depositSeverityCv: 0.3,
  niiSeverityCv: 0.35,
  systemicCorrelation: 0.5,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** FNV-1a 32-bit hash of a string → uint32 seed. */
function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xorshift32 PRNG returning a uniform in (0, 1). */
function makeUniform(seedUint32: number): () => number {
  let state = seedUint32 || 0x9e3779b9; // avoid the zero fixed-point
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // map to (0,1): keep both endpoints open for Box–Muller log()
    return (state + 0.5) / 0x100000000;
  };
}

/** Standard-normal draw via Box–Muller from a uniform stream. */
function makeNormal(uniform: () => number): () => number {
  return () => {
    const u1 = uniform();
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * sorted.length)),
  );
  return sorted[idx];
}

/**
 * Project the stressed capital-ratio distribution. Deterministic given
 * `input.seed`; the central estimate equals the engine's stressed ratio.
 */
export function projectCapitalRatioUnderStress(
  input: CapitalRatioProjectionInput,
): CapitalRatioUnderStress {
  const paths = Math.min(
    Math.max(Math.floor(input.paths ?? 10000), 200),
    100000,
  );
  const a = { ...DEFAULT_ASSUMPTIONS, ...(input.assumptions ?? {}) };
  const rho = Math.min(Math.max(a.systemicCorrelation, 0), 1);
  const { baseEquity, totalAssets, cossecMinimumPct } = input;
  const { creditLoss, depositCost, niiShortfall } = input.deterministicLosses;

  const baselineCapitalRatioPct =
    totalAssets > 0 ? (baseEquity / totalAssets) * 100 : 0;

  // Deterministic central estimate (no severity) — matches the engine.
  const totalLoss = creditLoss + depositCost + niiShortfall;
  const stressedEquity = baseEquity - totalLoss;
  const stressedCapitalRatioPct =
    totalAssets > 0 ? (stressedEquity / totalAssets) * 100 : 0;

  const normal = makeNormal(makeUniform(fnv1a(input.seed)));

  // Mean-1 LOGNORMAL severity multiplier: S = exp(σ·X − σ²/2) with
  // σ = sqrt(ln(1+CV²)). E[S] = 1 exactly (the band is centred on the engine's
  // deterministic loss), S > 0 always (no truncation), right-skewed (losses can
  // be far worse than expected, rarely much better).
  const sigmaOf = (cv: number) => Math.sqrt(Math.log(1 + cv * cv));
  const sigmaC = sigmaOf(a.creditSeverityCv);
  const sigmaD = sigmaOf(a.depositSeverityCv);
  const sigmaN = sigmaOf(a.niiSeverityCv);
  const sevFrom = (sigma: number, x: number) =>
    Math.exp(sigma * x - (sigma * sigma) / 2);

  // Single-factor Gaussian copula: each channel's driver X = √ρ·Z_sys +
  // √(1−ρ)·Z_i shares a systemic factor, so credit / funding / NII worsen
  // together in a macro scenario instead of diversifying (which would understate
  // the adverse tail). ρ = 0 → independent; ρ = 1 → perfectly correlated.
  const sqrtRho = Math.sqrt(rho);
  const sqrtComp = Math.sqrt(1 - rho);

  const ratios: number[] = [];
  let breaches = 0;
  for (let i = 0; i < paths; i++) {
    const zSys = normal();
    const xC = sqrtRho * zSys + sqrtComp * normal();
    const xD = sqrtRho * zSys + sqrtComp * normal();
    const xN = sqrtRho * zSys + sqrtComp * normal();
    const pathLoss =
      creditLoss * sevFrom(sigmaC, xC) +
      depositCost * sevFrom(sigmaD, xD) +
      niiShortfall * sevFrom(sigmaN, xN);
    const ratio =
      totalAssets > 0 ? ((baseEquity - pathLoss) / totalAssets) * 100 : 0;
    ratios.push(ratio);
    if (ratio < cossecMinimumPct) breaches++;
  }
  ratios.sort((x, y) => x - y);

  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const p5 = percentile(ratios, 0.05);

  const disclosures = [
    'Parametric stress band: each deterministic loss is scaled by a mean-1 lognormal severity multiplier S = exp(σ·X − σ²/2), σ = sqrt(ln(1+CV²)).',
    `Loss channels share a single systemic factor (Gaussian copula, ρ=${a.systemicCorrelation}) so credit/funding/NII worsen together — no spurious diversification in the tail.`,
    `Severity CVs are disclosed model assumptions (credit ${a.creditSeverityCv}, deposit ${a.depositSeverityCv}, NII ${a.niiSeverityCv}), not empirically calibrated.`,
    'The expected (mean) stressed capital ratio equals the ALM engine deterministic output; the band only expresses uncertainty around it.',
    `Seeded (seed="${input.seed}") — identical inputs reproduce this distribution exactly (SR 11-7).`,
  ];

  return {
    baselineCapitalRatioPct: round2(baselineCapitalRatioPct),
    deterministic: {
      creditLoss: round2(creditLoss),
      depositCost: round2(depositCost),
      niiShortfall: round2(niiShortfall),
      totalLoss: round2(totalLoss),
      stressedEquity: round2(stressedEquity),
      stressedCapitalRatioPct: round2(stressedCapitalRatioPct),
    },
    distribution: {
      p5: round2(p5),
      p25: round2(percentile(ratios, 0.25)),
      p50: round2(percentile(ratios, 0.5)),
      p75: round2(percentile(ratios, 0.75)),
      p95: round2(percentile(ratios, 0.95)),
    },
    meanCapitalRatioPct: round2(mean),
    breachProbabilityPct: round2((breaches / paths) * 100),
    adverseCushionBps: Math.round((p5 - cossecMinimumPct) * 100),
    breachesFloorAtAdverseTail: p5 < cossecMinimumPct,
    paths,
    seed: input.seed,
    assumptions: a,
    disclosures,
  };
}

// ─── Reverse stress test (distance-to-breach) ───────────────────────────────

export interface ReverseStressInput {
  /** Net worth / equity before stress, $M. */
  baseEquity: number;
  /** Total assets, $M. */
  totalAssets: number;
  /** COSSEC leverage capital floor, percent. */
  cossecMinimumPct: number;
  /** The scenario's deterministic total loss, $M (for the headroom multiple). */
  scenarioTotalLoss: number;
  /**
   * Balance of the segment the scenario's credit shock targets, $M (e.g. the
   * consumer book). Used to express the breach as a segment default-rate.
   */
  targetSegmentBalance?: number;
}

export interface ReverseStressResult {
  /** Maximum loss the institution can absorb before the ratio hits the floor, $M. */
  lossToFloor: number;
  /** The scenario loss this is measured against, $M. */
  scenarioTotalLoss: number;
  /** lossToFloor / scenarioTotalLoss — "how many SIC shocks until breach". */
  headroomMultiple: number | null;
  /** lossToFloor / targetSegmentBalance × 100 — the default-rate increase that alone would breach. */
  breakingPointSegmentDefaultPct: number | null;
  /** True when the institution already sits below the floor (no headroom). */
  alreadyBelowFloor: boolean;
}

/**
 * Reverse stress test: solve for the loss that drives the leverage capital
 * ratio down to the COSSEC floor (the EBA/PRA "distance to breach"). Pure +
 * deterministic — the exact inverse of the deterministic stressed ratio.
 */
export function reverseStressToFloor(
  input: ReverseStressInput,
): ReverseStressResult {
  const floorEquity = (input.cossecMinimumPct / 100) * input.totalAssets;
  const lossToFloor = round2(input.baseEquity - floorEquity);
  const absorb = Math.max(0, lossToFloor);
  return {
    lossToFloor,
    scenarioTotalLoss: round2(input.scenarioTotalLoss),
    headroomMultiple:
      input.scenarioTotalLoss > 0
        ? round2(absorb / input.scenarioTotalLoss)
        : null,
    breakingPointSegmentDefaultPct:
      input.targetSegmentBalance && input.targetSegmentBalance > 0
        ? round2((absorb / input.targetSegmentBalance) * 100)
        : null,
    alreadyBelowFloor: lossToFloor < 0,
  };
}
