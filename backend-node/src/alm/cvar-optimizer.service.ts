import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// CVaR Portfolio Optimizer — Rockafellar-Uryasev (2000)
// Minimizes Expected Shortfall via LP reformulation
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): the optimization is
// computed from the institution's real asset subcategories. An institution with
// no asset data returns an HONEST data_unavailable shell with a CRITICAL gap —
// NEVER a fabricated demo allocation. (Formerly returned a hardcoded 6-asset
// demo portfolio with cvar 0.032.)

export interface CVaROptResult {
  weights: number[];
  assetNames: string[];
  // Nullable per D1: with no assets there is nothing to optimize, so the engine
  // returns `null` + a gap rather than a fabricated demo. `null` is structurally
  // distinct from a real `0` an examiner could act on.
  cvar: number | null; // portfolio CVaR (ES) at alpha
  var: number | null; // portfolio VaR at alpha
  expectedReturn: number | null;
  alpha: number;
  scenarioCount: number;
  efficientFrontier: Array<{
    targetReturn: number;
    cvar: number;
    weights: number[];
  }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

// ─── Reproducible randomness (SR 11-7 model governance) ──────
// The CVaR optimizer's output is a regulator-facing "optimal" allocation, so it
// MUST be deterministic: the same institution + alpha must reproduce a
// byte-identical portfolio every run. We seed an xorshift32 + Box-Muller stream
// keyed by an FNV-1a hash of the institution id (the same pattern as
// portfolio-var.service.ts). Bare `Math.random()` is both non-reproducible and a
// model-validation red flag — and is forbidden in src/alm by
// verify:no-unseeded-random.

/** xorshift32 PRNG. Same seed → same [0, 1) sequence. */
function createSeededRNG(seed: number): () => number {
  // Avoid the xorshift32 stuck-at-zero fixed point.
  let state = seed | 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** FNV-1a hash of a string → uint32 seed. Stable across runs, distinct per id. */
function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Box-Muller (polar) standard-normal generator over a seeded uniform RNG. The
 * spare draw lives in a closure (not module state) so each generator instance is
 * independent and reproducible.
 */
function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const cached = spare;
      spare = null;
      return cached;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * rng() - 1;
      v = 2 * rng() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    const z = u * mul;
    return Number.isFinite(z) ? z : 0;
  };
}

/** Normalized random weight vector drawn from a seeded uniform stream. */
function randomWeights(n: number, rng: () => number): number[] {
  const raw = Array.from({ length: n }, () => rng());
  const total = raw.reduce((s, w) => s + w, 0);
  return total > 0 ? raw.map((w) => w / total) : raw.map(() => 1 / n);
}

@Injectable()
export class CVaROptimizerService {
  private readonly logger = new Logger(CVaROptimizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async optimize(
    institutionId: string,
    alpha: number = 0.05,
  ): Promise<CVaROptResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId, category: 'asset' },
      });

      // Build asset returns from balance sheet.
      // `balance`/`rate` are Prisma Decimals — coerce with Number() BEFORE the
      // `+=`. A raw `e.balance += item.balance` does STRING concatenation
      // (Decimal.valueOf() returns a string), silently corrupting the
      // subcategory totals and every downstream return/scenario. Corrupt
      // (non-finite) balances are skipped, never coerced to 0 — D1: never
      // fabricate a missing input.
      const bySub = new Map<string, { balance: number; rate: number }>();
      for (const item of items) {
        const bal = Number(item.balance);
        if (!Number.isFinite(bal)) continue;
        const rate = Number(item.rate);
        if (!bySub.has(item.subcategory))
          bySub.set(item.subcategory, { balance: 0, rate: 0 });
        const e = bySub.get(item.subcategory)!;
        e.balance += bal;
        e.rate += (Number.isFinite(rate) ? rate : 0) * bal;
      }

      const assetNames = Array.from(bySub.keys());
      const n = assetNames.length;
      // D1 (never silent zeros): no asset subcategories means there is nothing to
      // optimize. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded 6-asset getDemoResult() fabrication.
      if (n === 0) return this.dataUnavailableResult(alpha);

      const expectedReturns = assetNames.map((name) => {
        const e = bySub.get(name)!;
        return e.balance > 0 ? e.rate / e.balance : 0;
      });

      // Seeded, per-institution PRNG streams (SR 11-7 reproducibility). Distinct
      // streams for the scenario draws and the weight search so neither shifts
      // when the other's logic changes; both stable across runs for a given id.
      const gaussian = makeGaussian(
        createSeededRNG(seedFromString(`${institutionId}:cvar:scenarios`)),
      );
      const weightRng = createSeededRNG(
        seedFromString(`${institutionId}:cvar:weights`),
      );

      // Generate 500 scenario returns (Monte Carlo)
      const S = 500;
      const scenarios: number[][] = [];
      const vols = expectedReturns.map((r) => Math.max(0.01, r * 0.3)); // vol = 30% of expected return

      for (let s = 0; s < S; s++) {
        const row: number[] = [];
        for (let j = 0; j < n; j++) {
          const z = gaussian();
          row.push(expectedReturns[j] + vols[j] * z);
        }
        scenarios.push(row);
      }

      // CVaR minimization via iterative LP approximation
      // min nu + (1/(alpha*S)) * sum_s z_s
      // s.t. z_s >= -r_s^T w - nu, z_s >= 0, sum w = 1, w >= 0

      // Simplified: grid search over weights + compute CVaR for each
      const bestResult = this.gridOptimize(
        assetNames,
        expectedReturns,
        scenarios,
        alpha,
        weightRng,
      );

      // Compute efficient frontier (5 points)
      const frontier: CVaROptResult['efficientFrontier'] = [];
      const minRet = Math.min(...expectedReturns) * 0.5;
      const maxRet = Math.max(...expectedReturns) * 0.9;
      for (let i = 0; i < 5; i++) {
        const target = minRet + ((maxRet - minRet) * i) / 4;
        const result = this.gridOptimize(
          assetNames,
          expectedReturns,
          scenarios,
          alpha,
          weightRng,
          target,
        );
        frontier.push({
          targetReturn: +target.toFixed(4),
          cvar: result.cvar,
          weights: result.weights,
        });
      }

      return {
        ...bestResult,
        assetNames,
        alpha,
        scenarioCount: S,
        efficientFrontier: frontier,
        status: 'ok',
      };
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  private gridOptimize(
    assetNames: string[],
    expectedReturns: number[],
    scenarios: number[][],
    alpha: number,
    rng: () => number,
    targetReturn?: number,
  ): { weights: number[]; cvar: number; var: number; expectedReturn: number } {
    const n = assetNames.length;
    const S = scenarios.length;

    let bestWeights = new Array(n).fill(1 / n);
    let bestCVaR = Infinity;

    // Generate 200 candidate weight vectors from the seeded stream.
    for (let trial = 0; trial < 200; trial++) {
      const w = randomWeights(n, rng);
      const portRet = w.reduce((s, wi, i) => s + wi * expectedReturns[i], 0);

      if (targetReturn !== undefined && portRet < targetReturn * 0.95) continue;

      // Compute portfolio returns under each scenario
      const portReturns = scenarios.map((row) =>
        w.reduce((s, wi, i) => s + wi * row[i], 0),
      );
      portReturns.sort((a, b) => a - b);

      // VaR = -percentile(alpha)
      const varIdx = Math.floor(S * alpha);
      const varVal = -portReturns[varIdx];

      // CVaR = average of worst alpha% returns
      const tailReturns = portReturns.slice(0, varIdx);
      const cvar =
        tailReturns.length > 0
          ? -tailReturns.reduce((s, r) => s + r, 0) / tailReturns.length
          : varVal;

      if (cvar < bestCVaR) {
        bestCVaR = cvar;
        bestWeights = w;
      }
    }

    const portRet = bestWeights.reduce(
      (s, wi, i) => s + wi * expectedReturns[i],
      0,
    );
    const portReturns = scenarios
      .map((row) => bestWeights.reduce((s, wi, i) => s + wi * row[i], 0))
      .sort((a, b) => a - b);
    const varVal = -portReturns[Math.floor(S * alpha)];

    return {
      weights: bestWeights.map((w) => +w.toFixed(4)),
      cvar: +bestCVaR.toFixed(6),
      var: +varVal.toFixed(6),
      expectedReturn: +portRet.toFixed(6),
    };
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication (6-asset cooperativa allocation with cvar 0.032 / var 0.025 and a
  // 5-point efficient frontier) that read as a real optimized portfolio on every
  // empty institution.
  private dataUnavailableResult(alpha: number): CVaROptResult {
    return {
      weights: [],
      assetNames: [],
      cvar: null,
      var: null,
      expectedReturn: null,
      alpha,
      scenarioCount: 0,
      efficientFrontier: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('cvarOptimizer.assets', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue los activos del balance (por subcategoría) para optimizar la cartera por CVaR (expected shortfall). / Load balance-sheet assets (by subcategory) to optimize the portfolio by CVaR (expected shortfall).',
          context: { service: 'cvar-optimizer' },
        }),
      ],
    };
  }
}
