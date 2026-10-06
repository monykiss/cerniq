import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface CAMELForecast {
  dimension: string;
  currentScore: number;
  q2Forecast: number;
  q4Forecast: number;
  q2CI: [number, number];
  q4CI: [number, number];
  trend: 'improving' | 'stable' | 'deteriorating';
  ar2Params: { phi1: number; phi2: number; intercept: number; r2: number };
}

@Injectable()
export class CamelForecasterService {
  private readonly logger = new Logger(CamelForecasterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async forecastForInstitution(
    institutionId: string,
  ): Promise<CAMELForecast[]> {
    // Load CAMEL history (from board reports or computed snapshots)
    const reports = await this.prisma.boardReport.findMany({
      where: { institutionId },
      orderBy: { generatedAt: 'asc' },
      take: 8,
      select: {
        camelComposite: true,
        nimSnapshot: true,
        lcrSnapshot: true,
        generatedAt: true,
      },
    });

    // If insufficient history, generate synthetic from current state
    const dimensions = [
      'capital',
      'assetQuality',
      'management',
      'earnings',
      'liquidity',
    ] as const;
    const forecasts: CAMELForecast[] = [];

    for (const dim of dimensions) {
      const series = this.getDimensionSeries(reports, dim);
      const params = this.fitAR2(series);
      const last2: [number, number] = [
        series[series.length - 2] ?? series[0] ?? 2.5,
        series[series.length - 1] ?? 2.5,
      ];
      const q2 = this.forecastN(params, last2, 2);
      const q4 = this.forecastN(params, last2, 4);
      const resStd = this.residualStd(series, params);
      const current = series[series.length - 1] ?? 2.5;

      forecasts.push({
        dimension: dim,
        currentScore: current,
        q2Forecast: this.clamp(q2),
        q4Forecast: this.clamp(q4),
        q2CI: [this.clamp(q2 - 1.28 * resStd), this.clamp(q2 + 1.28 * resStd)],
        q4CI: [this.clamp(q4 - 1.28 * resStd), this.clamp(q4 + 1.28 * resStd)],
        trend:
          q4 < current - 0.25
            ? 'improving'
            : q4 > current + 0.25
              ? 'deteriorating'
              : 'stable',
        ar2Params: params,
      });
    }

    return forecasts;
  }

  private getDimensionSeries(reports: any[], _dim: string): number[] {
    if (reports.length >= 4) {
      // Derive from composite (simplified — production would store per-dimension)
      return reports.map((r) => r.camelComposite ?? 2.5);
    }
    // Insufficient data: return synthetic stable series
    return [2.5, 2.5, 2.3, 2.4, 2.5, 2.3];
  }

  private fitAR2(series: number[]): {
    phi1: number;
    phi2: number;
    intercept: number;
    r2: number;
  } {
    if (series.length < 4)
      return {
        phi1: 0,
        phi2: 0,
        intercept: series[series.length - 1] ?? 2.5,
        r2: 0,
      };

    const X: number[][] = [];
    const y: number[] = [];
    for (let t = 2; t < series.length; t++) {
      X.push([1, series[t - 1], series[t - 2]]);
      y.push(series[t]);
    }

    const Xt = X[0].map((_, i) => X.map((row) => row[i]));
    const XtX = Xt.map((row) =>
      X[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * X[k][j], 0)),
    );
    const XtY = Xt.map((row) => row.reduce((s, v, i) => s + v * y[i], 0));
    const beta = this.solve3x3(XtX, XtY);

    const [intercept, phi1, phi2] = beta;
    const yHat = X.map((row) => intercept + phi1 * row[1] + phi2 * row[2]);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
    const ssRes = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);

    return {
      phi1,
      phi2,
      intercept,
      r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0,
    };
  }

  private forecastN(
    params: { phi1: number; phi2: number; intercept: number },
    last2: [number, number],
    h: number,
  ): number {
    let [prev2, prev1] = last2;
    for (let i = 0; i < h; i++) {
      const next = params.intercept + params.phi1 * prev1 + params.phi2 * prev2;
      [prev2, prev1] = [prev1, next];
    }
    return prev1;
  }

  private clamp(v: number): number {
    return Math.min(5, Math.max(1, Math.round(v * 2) / 2));
  }

  private residualStd(
    series: number[],
    params: { phi1: number; phi2: number; intercept: number },
  ): number {
    const residuals: number[] = [];
    for (let t = 2; t < series.length; t++) {
      residuals.push(
        series[t] -
          (params.intercept +
            params.phi1 * series[t - 1] +
            params.phi2 * series[t - 2]),
      );
    }
    if (residuals.length === 0) return 0.5;
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    return Math.sqrt(
      residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / residuals.length,
    );
  }

  private solve3x3(A: number[][], b: number[]): number[] {
    const det = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-10) return [b[0], 0, 0];
    const replace = (col: number) =>
      A.map((row, i) => [...row.slice(0, col), b[i], ...row.slice(col + 1)]);
    return [0, 1, 2].map((col) => det(replace(col)) / D);
  }
}
