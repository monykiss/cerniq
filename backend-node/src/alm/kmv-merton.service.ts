import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';

// KMV-Merton (1974) — Structural Default Model
// Equity as call option on firm assets → solve for asset value and vol → Distance-to-Default

export interface KMVResult {
  assetValue: number | null;
  assetVol: number | null;
  distanceToDefault: number | null;
  impliedDefaultProbability: number | null;
  leverage: number | null;
  impliedRating: string | null;
  equityValue: number | null;
  debtFaceValue: number | null;
  gaps?: DataGap[];
}

@Injectable()
export class KMVMertonService {
  private readonly logger = new Logger(KMVMertonService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeKMV(institutionId: string): Promise<KMVResult> {
    const inst = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    const assetItems = items.filter((i: any) => i.category === 'asset');
    const liabilityItems = items.filter((i: any) => i.category === 'liability');

    const totalAssets =
      assetItems.reduce((s: number, i: any) => s + Number(i.balance), 0) ||
      inst?.totalAssets ||
      0;

    // Refuse to compute on missing data — D1 convention
    if (totalAssets === 0) {
      this.logger.warn(
        `KMV-Merton: no balance sheet data for institution ${institutionId}. Returning data_unavailable.`,
      );
      return this.dataUnavailableResult();
    }

    const totalLiabilities = liabilityItems.reduce(
      (s: number, i: any) => s + Number(i.balance),
      0,
    );

    if (totalLiabilities === 0) {
      this.logger.warn(
        `KMV-Merton: no liability data for institution ${institutionId}. Returning data_unavailable.`,
      );
      return this.dataUnavailableResult();
    }

    const equity = totalAssets - totalLiabilities;

    if (equity <= 0) {
      this.logger.warn(
        `KMV-Merton: negative equity (${equity}) for institution ${institutionId}. Cannot solve.`,
      );
      return this.dataUnavailableResult();
    }

    // For cooperativas: use net worth as equity proxy, total deposits + borrowings as debt
    const E = equity;
    const D = totalLiabilities; // short-term + 0.5 x long-term (KMV convention)
    const sigmaE = 0.15; // equity volatility proxy (cooperativas are less volatile)
    const r = 0.0475; // risk-free rate
    const T = 1; // 1-year default horizon

    return this.solveAssetValue(E, sigmaE, D, r, T);
  }

  private dataUnavailableResult(): KMVResult {
    return {
      assetValue: null,
      assetVol: null,
      distanceToDefault: null,
      impliedDefaultProbability: null,
      leverage: null,
      impliedRating: null,
      equityValue: null,
      debtFaceValue: null,
      gaps: [
        dataGap('credit.kmv', 'KMV_INPUTS_INSUFFICIENT', {
          severity: 'CRITICAL',
          action: 'Upload balance sheet with both asset and liability items',
        }),
      ],
    };
  }

  solveAssetValue(
    E: number,
    sigmaE: number,
    D: number,
    r: number,
    T: number,
  ): KMVResult {
    // Newton-Raphson: solve system of 2 equations
    // Eq1: E = A*N(d1) - D*e^(-rT)*N(d2)
    // Eq2: sigmaE*E = N(d1)*sigmaA*A

    let A = E + D;
    let sigmaA = (sigmaE * E) / A;

    for (let iter = 0; iter < 200; iter++) {
      const d1 =
        (Math.log(A / D) + (r + sigmaA ** 2 / 2) * T) / (sigmaA * Math.sqrt(T));
      const d2 = d1 - sigmaA * Math.sqrt(T);

      const E_model = A * this.N(d1) - D * Math.exp(-r * T) * this.N(d2);
      const sigE_model = (this.N(d1) * sigmaA * A) / E;

      const err1 = E_model - E;
      const err2 = sigE_model - sigmaE;

      if (Math.abs(err1) < 0.001 * E && Math.abs(err2) < 0.0001) break;

      // Newton step (approximate Jacobian)
      const dE_dA = this.N(d1);
      const dE_dSig = A * this.phi(d1) * Math.sqrt(T);
      const dSig_dA = (this.N(d1) * sigmaA) / E / A;
      const dSig_dSig = (this.N(d1) * A) / E;
      const det = dE_dA * dSig_dSig - dE_dSig * dSig_dA;
      if (Math.abs(det) < 1e-12) break;

      A -= (err1 * dSig_dSig - err2 * dE_dSig) / det;
      sigmaA -= (err2 * dE_dA - err1 * dSig_dA) / det;
      A = Math.max(E, A);
      sigmaA = Math.max(0.01, sigmaA);
    }

    const mu = r + 0.02; // risk premium
    const DD =
      (Math.log(A / D) + (mu - sigmaA ** 2 / 2) * T) / (sigmaA * Math.sqrt(T));
    const EDF = this.N(-DD);

    return {
      assetValue: +A.toFixed(2),
      assetVol: +sigmaA.toFixed(4),
      distanceToDefault: +DD.toFixed(2),
      impliedDefaultProbability: +EDF.toFixed(6),
      leverage: +(D / A).toFixed(3),
      impliedRating: this.ddToRating(DD),
      equityValue: +E.toFixed(2),
      debtFaceValue: +D.toFixed(2),
    };
  }

  private ddToRating(DD: number): string {
    if (DD >= 4.5) return 'AAA';
    if (DD >= 3.5) return 'AA';
    if (DD >= 2.7) return 'A';
    if (DD >= 2.0) return 'BBB';
    if (DD >= 1.5) return 'BB';
    if (DD >= 1.0) return 'B';
    if (DD >= 0.5) return 'CCC';
    return 'D';
  }

  private N(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.SQRT2));
  }
  private phi(x: number): number {
    return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  }
  private erf(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
        t +
        0.254829592) *
        t *
        Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
}
