import { Injectable, Logger } from '@nestjs/common';

// Interest Rate Cap/Floor Pricer — Black 1976 + Bachelier Extension

export interface CapFloorResult {
  type: 'cap' | 'floor';
  notional: number;
  strike: number;
  maturityYears: number;
  premium: number;
  premiumPct: number;
  capletPrices: Array<{
    period: number;
    forwardRate: number;
    capletPrice: number;
    intrinsicValue: number;
  }>;
  impliedVol: number;
  delta: number;
  gamma: number;
  vega: number;
}

@Injectable()
export class IRCapFloorService {
  private readonly logger = new Logger(IRCapFloorService.name);

  priceCapFloor(
    type: 'cap' | 'floor',
    notional: number,
    strike: number,
    forwardRates: number[],
    vol: number,
    discountFactors: number[],
    tau: number = 0.25,
  ): CapFloorResult {
    const n = forwardRates.length;
    let totalPremium = 0;
    const capletPrices: CapFloorResult['capletPrices'] = [];

    for (let i = 0; i < n; i++) {
      const F = forwardRates[i];
      const T = (i + 1) * tau;
      const df = discountFactors[i] ?? Math.exp(-strike * T);

      let capletPrice: number;

      if (F <= 0.005 || strike <= 0.005) {
        // Bachelier (normal) model for near-zero rates
        const d = (F - strike) / (vol * Math.sqrt(T));
        const nPdf = Math.exp((-d * d) / 2) / Math.sqrt(2 * Math.PI);
        const nCdf = 0.5 * (1 + this.erf(d / Math.SQRT2));
        capletPrice =
          type === 'cap'
            ? df *
              tau *
              notional *
              ((F - strike) * nCdf + vol * Math.sqrt(T) * nPdf)
            : df *
              tau *
              notional *
              ((strike - F) * (1 - nCdf) + vol * Math.sqrt(T) * nPdf);
      } else {
        // Black 1976 model
        const d1 =
          (Math.log(F / strike) + 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
        const d2 = d1 - vol * Math.sqrt(T);
        const N = (x: number) => 0.5 * (1 + this.erf(x / Math.SQRT2));

        capletPrice =
          type === 'cap'
            ? df * tau * notional * (F * N(d1) - strike * N(d2))
            : df * tau * notional * (strike * N(-d2) - F * N(-d1));
      }

      totalPremium += capletPrice;
      const intrinsic =
        type === 'cap' ? Math.max(0, F - strike) : Math.max(0, strike - F);
      capletPrices.push({
        period: i + 1,
        forwardRate: +F.toFixed(4),
        capletPrice: +capletPrice.toFixed(2),
        intrinsicValue: +(intrinsic * notional * tau * df).toFixed(2),
      });
    }

    // Greeks (finite difference)
    const bumpUp = this.sumCapletPrices(
      type,
      notional,
      strike,
      forwardRates.map((r) => r + 0.0001),
      vol,
      discountFactors,
      tau,
    );
    const bumpDown = this.sumCapletPrices(
      type,
      notional,
      strike,
      forwardRates.map((r) => r - 0.0001),
      vol,
      discountFactors,
      tau,
    );
    const delta = (bumpUp - bumpDown) / 0.0002;
    const gamma = (bumpUp + bumpDown - 2 * totalPremium) / (0.0001 * 0.0001);
    const volUp = this.sumCapletPrices(
      type,
      notional,
      strike,
      forwardRates,
      vol + 0.01,
      discountFactors,
      tau,
    );
    const vega = (volUp - totalPremium) / 0.01;

    return {
      type,
      notional,
      strike,
      maturityYears: n * tau,
      premium: +totalPremium.toFixed(2),
      premiumPct: +((totalPremium / notional) * 100).toFixed(4),
      capletPrices,
      impliedVol: vol,
      delta: +delta.toFixed(2),
      gamma: +gamma.toFixed(2),
      vega: +vega.toFixed(2),
    };
  }

  private sumCapletPrices(
    type: string,
    notional: number,
    strike: number,
    fwds: number[],
    vol: number,
    dfs: number[],
    tau: number,
  ): number {
    return fwds.reduce((sum, F, i) => {
      const T = (i + 1) * tau;
      const df = dfs[i] ?? Math.exp(-strike * T);
      const d1 =
        (Math.log(F / strike) + 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
      const d2 = d1 - vol * Math.sqrt(T);
      const N = (x: number) => 0.5 * (1 + this.erf(x / Math.SQRT2));
      return (
        sum +
        df *
          tau *
          notional *
          (type === 'cap'
            ? F * N(d1) - strike * N(d2)
            : strike * N(-d2) - F * N(-d1))
      );
    }, 0);
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
