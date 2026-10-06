import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// Gaussian + Student-t Copula Credit Correlation Model
// Li (2000) — the model that changed credit risk forever
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): copula correlation
// is computed from the institution's real loan segments via Monte Carlo. An
// institution with no loan-segment data returns an HONEST data_unavailable shell
// with a CRITICAL gap — NEVER a fabricated demo VaR. (Formerly returned a
// hardcoded $22.5M VaR demo.)

export interface CopulaResult {
  method: 'gaussian' | 't-copula';
  // Nullable per D1: with no loan segments there is nothing to simulate, so the
  // engine returns `null` + a gap rather than a fabricated demo VaR. `null` is
  // structurally distinct from a real `0` an examiner could act on.
  var99: number | null;
  var999: number | null;
  es99: number | null;
  tailDependence: number | null;
  tCopulaPremium: number | null; // extra risk from fat tails
  jointDefaultProbability: number | null;
  correlationMatrix: number[][];
  segments: string[];
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class CopulaCreditService {
  private readonly logger = new Logger(CopulaCreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async simulateWithCopula(
    institutionId: string,
    copulaType: 'gaussian' | 't-copula' = 'gaussian',
    nuDof: number = 5,
    paths: number = 10000,
  ): Promise<CopulaResult> {
    try {
      const segments = await this.prisma.loanSegment.findMany({
        where: { institutionId },
      });
      // D1 (never silent zeros): no loan segments means there is nothing to
      // simulate. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded $22.5M getDemoResult() fabrication.
      if (segments.length === 0) return this.dataUnavailableResult(copulaType);

      const n = segments.length;
      const pds = segments.map((s: any) =>
        Math.min(0.3, s.historicalLossRate * 2),
      );
      const lgds = segments.map((s: any) => s.lgd);
      const eads = segments.map((s: any) => s.balance);

      // Build correlation matrix (simplified: uniform rho)
      const rho = 0.15;
      const corrMatrix = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 1.0 : rho)),
      );

      // Cholesky decomposition
      const L = this.cholesky(corrMatrix);
      const rng = this.seededRNG(42);
      const losses: number[] = [];

      for (let p = 0; p < paths; p++) {
        // Draw independent normals
        const z = Array.from({ length: n }, () => this.normalRandom(rng));

        // Apply Cholesky correlation
        const x: number[] = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j <= i; j++) x[i] += L[i][j] * z[j];
        }

        // Transform to uniforms
        let u: number[];
        if (copulaType === 't-copula') {
          // t-copula: divide by chi-squared
          const chi2 = this.chiSquaredSample(rng, nuDof);
          const tVars = x.map((xi) => xi / Math.sqrt(chi2 / nuDof));
          u = tVars.map((ti) => this.tCDF(ti, nuDof));
        } else {
          u = x.map((xi) => this.normCDF(xi));
        }

        // Default if u_i < PD_i
        let loss = 0;
        for (let i = 0; i < n; i++) {
          if (u[i] < pds[i]) loss += eads[i] * lgds[i];
        }
        losses.push(loss);
      }

      losses.sort((a, b) => a - b);
      const var99 = losses[Math.floor(paths * 0.99)];
      const var999 = losses[Math.floor(paths * 0.999)];
      const es99 =
        losses.slice(Math.floor(paths * 0.99)).reduce((s, v) => s + v, 0) /
        (paths * 0.01);

      // Tail dependence (t-copula)
      const tailDep =
        copulaType === 't-copula'
          ? 2 *
            this.tCDF(
              -Math.sqrt(((nuDof + 1) * (1 - rho)) / (1 + rho)),
              nuDof + 1,
            )
          : 0;

      // Joint default probability
      const jointDefault =
        losses.filter(
          (l) => l > eads.reduce((s: number, e: number) => s + e, 0) * 0.5,
        ).length / paths;

      // t-copula premium: how much more risk than Gaussian
      let tPremium = 0;
      if (copulaType === 't-copula') {
        // Run Gaussian for comparison. Same institutionId with segments present
        // (we are past the empty guard), so the recursive result is always the
        // 'ok' path — var99 is non-null here.
        const gaussResult = await this.simulateWithCopula(
          institutionId,
          'gaussian',
          5,
          Math.min(paths, 5000),
        );
        tPremium = var99 - gaussResult.var99!;
      }

      return {
        method: copulaType,
        var99: +var99.toFixed(2),
        var999: +var999.toFixed(2),
        es99: +es99.toFixed(2),
        tailDependence: +tailDep.toFixed(4),
        tCopulaPremium: +tPremium.toFixed(2),
        jointDefaultProbability: +jointDefault.toFixed(6),
        correlationMatrix: corrMatrix,
        segments: segments.map((s: any) => s.segmentName),
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

  private cholesky(R: number[][]): number[][] {
    const n = R.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = R[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        L[i][j] = j === i ? Math.sqrt(Math.max(0, sum)) : sum / (L[j][j] || 1);
      }
    }
    return L;
  }

  private chiSquaredSample(rng: () => number, df: number): number {
    let sum = 0;
    for (let i = 0; i < df; i++) {
      const z = this.normalRandom(rng);
      sum += z * z;
    }
    return sum;
  }

  private tCDF(x: number, nu: number): number {
    // Approximation for student-t CDF
    const t = x / Math.sqrt(nu);
    return (
      0.5 +
      0.5 *
        Math.sign(t) *
        (1 - Math.exp(-0.5 * t * t * (1 + (0.25 * t * t) / nu)))
    );
  }

  private normCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327;
    const p =
      d *
      Math.exp((-x * x) / 2) *
      t *
      (0.3193815 +
        t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }

  private seededRNG(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }
  private normalRandom(rng: () => number): number {
    const u1 = rng() || 1e-10,
      u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication ($22.5M VaR / $35.8M 99.9% VaR with two demo segments) that read
  // as a real copula credit-correlation position on every empty institution.
  private dataUnavailableResult(method: 'gaussian' | 't-copula'): CopulaResult {
    return {
      method,
      var99: null,
      var999: null,
      es99: null,
      tailDependence: null,
      tCopulaPremium: null,
      jointDefaultProbability: null,
      correlationMatrix: [],
      segments: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('copulaCredit.loanSegments', 'NO_LOAN_SEGMENTS', {
          severity: 'CRITICAL',
          action:
            'Cargue los segmentos de préstamos (con tasa de pérdida histórica, LGD y saldo) para simular la correlación de crédito por cópula. / Load loan segments (with historical loss rate, LGD and balance) to simulate copula credit correlation.',
          context: { service: 'copula-credit' },
        }),
      ],
    };
  }
}
