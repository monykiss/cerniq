// ─── ForwardCurve — Spot/Forward Rate Bootstrapping + Shocks ────
//
// Bootstrap forward rates from spot rates:
//   f(T1, T2) = [r(T2)*T2 - r(T1)*T1] / (T2 - T1)
//
// This is the deterministic starting curve for HJM Monte Carlo.

import { HJM_TENORS, HJM_TENOR_LABELS, ForwardCurveSnapshot } from './types';

/** Default PR municipal spread over UST (basis points). */
const DEFAULT_PR_SPREAD_BPS = 85;

export class ForwardCurve {
  readonly tenors: number[];
  readonly spotRates: number[];
  readonly prSpreadBps: number;

  constructor(
    spotRates: Record<string, number>,
    prSpreadBps: number = DEFAULT_PR_SPREAD_BPS,
  ) {
    this.tenors = [];
    this.spotRates = [];
    this.prSpreadBps = prSpreadBps;

    // Map label → tenor → rate, preserving HJM_TENORS order
    for (let i = 0; i < HJM_TENOR_LABELS.length; i++) {
      const label = HJM_TENOR_LABELS[i];
      if (label in spotRates) {
        this.tenors.push(HJM_TENORS[i]);
        this.spotRates.push(spotRates[label]);
      }
    }

    if (this.tenors.length < 2) {
      throw new Error(
        `ForwardCurve requires at least 2 tenor points, got ${this.tenors.length}`,
      );
    }
  }

  /**
   * Bootstrap instantaneous forward rates from spot rates.
   * f(T1, T2) = [r(T2)*T2 - r(T1)*T1] / (T2 - T1)
   *
   * Returns one forward rate per adjacent tenor pair.
   * The first forward rate equals the first spot rate (f(0,T1) = r(T1)).
   */
  toForwardRates(): number[] {
    const forwards: number[] = [this.spotRates[0]];

    for (let i = 1; i < this.tenors.length; i++) {
      const r2 = this.spotRates[i];
      const T2 = this.tenors[i];
      const r1 = this.spotRates[i - 1];
      const T1 = this.tenors[i - 1];
      const dT = T2 - T1;

      if (dT <= 0) {
        throw new Error(
          `Tenors must be strictly increasing: T[${i - 1}]=${T1}, T[${i}]=${T2}`,
        );
      }

      forwards.push((r2 * T2 - r1 * T1) / dT);
    }

    return forwards;
  }

  /**
   * Apply a parallel shock (all tenors shift by the same amount).
   */
  shock(bps: number): ForwardCurve {
    const shift = bps / 10_000;
    const newRates: Record<string, number> = {};
    for (let i = 0; i < this.tenors.length; i++) {
      const label = this.tenorLabel(i);
      newRates[label] = Math.max(0, this.spotRates[i] + shift);
    }
    return new ForwardCurve(newRates, this.prSpreadBps);
  }

  /**
   * Apply a twist shock (different shifts for short and long end).
   * Linear interpolation between shortBps (at shortest tenor) and longBps (at longest).
   */
  twist(shortBps: number, longBps: number): ForwardCurve {
    const minT = this.tenors[0];
    const maxT = this.tenors[this.tenors.length - 1];
    const rangeT = maxT - minT;

    const newRates: Record<string, number> = {};
    for (let i = 0; i < this.tenors.length; i++) {
      const t = rangeT > 0 ? (this.tenors[i] - minT) / rangeT : 0;
      const shiftBps = shortBps + (longBps - shortBps) * t;
      const label = this.tenorLabel(i);
      newRates[label] = Math.max(0, this.spotRates[i] + shiftBps / 10_000);
    }
    return new ForwardCurve(newRates, this.prSpreadBps);
  }

  /**
   * Apply PR municipal spread to all rates.
   * PR cooperativas operate in a rate environment that sits above UST by
   * the PR municipal spread (typically 60-120 bps due to PROMESA legacy).
   */
  withPRSpread(): ForwardCurve {
    const spread = this.prSpreadBps / 10_000;
    const newRates: Record<string, number> = {};
    for (let i = 0; i < this.tenors.length; i++) {
      const label = this.tenorLabel(i);
      newRates[label] = this.spotRates[i] + spread;
    }
    return new ForwardCurve(newRates, this.prSpreadBps);
  }

  /**
   * Interpolate spot rate at an arbitrary tenor using linear interpolation.
   * Extrapolates flat beyond the curve boundaries.
   */
  interpolate(tenor: number): number {
    if (tenor <= this.tenors[0]) return this.spotRates[0];
    if (tenor >= this.tenors[this.tenors.length - 1]) {
      return this.spotRates[this.spotRates.length - 1];
    }

    for (let i = 1; i < this.tenors.length; i++) {
      if (tenor <= this.tenors[i]) {
        const t =
          (tenor - this.tenors[i - 1]) / (this.tenors[i] - this.tenors[i - 1]);
        return (
          this.spotRates[i - 1] +
          t * (this.spotRates[i] - this.spotRates[i - 1])
        );
      }
    }

    return this.spotRates[this.spotRates.length - 1];
  }

  /** Export as snapshot for serialization / Monte Carlo input. */
  toSnapshot(): ForwardCurveSnapshot {
    return {
      tenors: [...this.tenors],
      spotRates: [...this.spotRates],
      forwardRates: this.toForwardRates(),
      prSpread: this.prSpreadBps,
    };
  }

  private tenorLabel(index: number): string {
    // Find matching label from HJM_TENOR_LABELS by matching tenor value
    const tenor = this.tenors[index];
    for (let j = 0; j < HJM_TENORS.length; j++) {
      if (Math.abs(HJM_TENORS[j] - tenor) < 0.001) {
        return HJM_TENOR_LABELS[j];
      }
    }
    return `${tenor}Y`;
  }
}
