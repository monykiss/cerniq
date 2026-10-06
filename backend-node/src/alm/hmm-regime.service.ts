import { Injectable, Logger } from '@nestjs/common';
import { DataGap, dataGap } from './reports/data-gap';

// 4-state Hidden Markov Model for interest rate regime detection
// States: RISING_RATES, PLATEAU, EASING, CRISIS
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): regime detection
// needs at least 4 rate observations for the Viterbi/forward recursion to be
// statistically meaningful. With fewer it returns an HONEST data_unavailable
// shell with a WARNING gap — NEVER the former hardcoded PLATEAU demo regime.
// (NOTE: the macro-regime controller endpoint formerly fed a SYNTHETIC sine-wave
// rate series; that fabrication has been removed — until a real rate-history
// source is wired, the endpoint reports data_unavailable honestly.)

const STATE_NAMES = ['RISING_RATES', 'PLATEAU', 'EASING', 'CRISIS'] as const;
type RegimeState = (typeof STATE_NAMES)[number];

// Gaussian emission parameters (calibrated from Fed Funds 1990-2024)
// Observation vector: [weekly_rate_change_bps, rate_volatility, credit_spread_change]
const EMISSION_MEANS = [
  [8.5, 0.12, 0.05], // RISING: rates up, low vol, spreads stable
  [0.2, 0.06, 0.0], // PLATEAU: flat, very low vol
  [-6.0, 0.1, -0.03], // EASING: rates down, moderate vol
  [-2.0, 0.35, 0.25], // CRISIS: flat rates, HIGH vol, spreads widen
];
const EMISSION_STDS = [
  [4.0, 0.05, 0.03],
  [2.0, 0.03, 0.02],
  [4.5, 0.06, 0.04],
  [8.0, 0.15, 0.12],
];

const TRANSITION = [
  [0.85, 0.1, 0.03, 0.02], // From RISING
  [0.05, 0.8, 0.12, 0.03], // From PLATEAU
  [0.02, 0.15, 0.8, 0.03], // From EASING
  [0.01, 0.1, 0.09, 0.8], // From CRISIS
];
const INITIAL = [0.25, 0.4, 0.25, 0.1];

export interface RegimeResult {
  // Nullable per D1: with fewer than 4 observations there is nothing to detect,
  // so the engine returns `null`/`[]` + a gap rather than a fabricated regime.
  currentRegime: RegimeState | null;
  currentProbabilities: Array<{ regime: RegimeState; probability: number }>;
  regimePersistence: number | null;
  statePath: RegimeState[];
  almImplications: string | null;
  almImplicationsEs: string | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class HMMRegimeService {
  private readonly logger = new Logger(HMMRegimeService.name);
  private readonly K = 4;

  detectRegime(observations: number[][]): RegimeResult {
    // D1 (never silent zeros): regime inference is not statistically meaningful
    // below 4 observations. Return an honest data_unavailable shell with a
    // WARNING gap — NEVER the former hardcoded PLATEAU getDemoResult().
    if (observations.length < 4) return this.dataUnavailableResult();

    const T = observations.length;

    // Viterbi algorithm
    const delta: number[][] = Array.from({ length: T }, () =>
      new Array(this.K).fill(-Infinity),
    );
    const psi: number[][] = Array.from({ length: T }, () =>
      new Array(this.K).fill(0),
    );

    // Init
    for (let j = 0; j < this.K; j++) {
      delta[0][j] = Math.log(INITIAL[j]) + this.logEmit(j, observations[0]);
    }

    // Recurse
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.K; j++) {
        let best = -Infinity,
          bestI = 0;
        for (let i = 0; i < this.K; i++) {
          const v = delta[t - 1][i] + Math.log(TRANSITION[i][j]);
          if (v > best) {
            best = v;
            bestI = i;
          }
        }
        delta[t][j] = best + this.logEmit(j, observations[t]);
        psi[t][j] = bestI;
      }
    }

    // Backtrack
    const path = new Array(T);
    path[T - 1] = delta[T - 1].indexOf(Math.max(...delta[T - 1]));
    for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];

    // Forward probabilities for current state confidence
    const fwd = this.forward(observations);
    const lastFwd = fwd[T - 1];
    const sumFwd = lastFwd.reduce((s, p) => s + p, 0);
    const probs = lastFwd.map((p) => p / (sumFwd || 1));

    const currentState = path[T - 1];
    const currentRegime = STATE_NAMES[currentState];
    const persistence = TRANSITION[currentState][currentState];

    const implications: Record<RegimeState, { en: string; es: string }> = {
      RISING_RATES: {
        en: 'Rising rate regime detected. Asset-sensitive institutions benefit from NII expansion. Monitor deposit beta acceleration and repricing lag. Consider extending liability duration.',
        es: 'Régimen de tasas al alza detectado. Instituciones sensibles a activos se benefician de expansión NII. Monitoree aceleración de beta de depósitos y rezago de repreciación. Considere extender duración de pasivos.',
      },
      PLATEAU: {
        en: 'Rate plateau regime. NIM stable but under pressure from competitive deposit pricing. Focus on mix optimization and fee income diversification.',
        es: 'Régimen de meseta de tasas. NIM estable pero bajo presión por precios competitivos de depósitos. Enfóquese en optimización de mezcla y diversificación de ingresos por comisiones.',
      },
      EASING: {
        en: 'Easing regime detected. Lock in current asset yields before rates fall further. Extend asset duration. Reduce CD rates proactively.',
        es: 'Régimen de flexibilización detectado. Asegure rendimientos actuales de activos antes de que las tasas bajen más. Extienda duración de activos. Reduzca tasas de CD proactivamente.',
      },
      CRISIS: {
        en: 'Crisis regime detected. Elevated volatility and widening credit spreads. Priority: liquidity buffer, stress testing, HQLA adequacy. Defer new originations until spreads normalize.',
        es: 'Régimen de crisis detectado. Volatilidad elevada y ampliación de spreads crediticios. Prioridad: colchón de liquidez, pruebas de estrés, suficiencia HQLA. Difiera nuevas originaciones hasta normalización de spreads.',
      },
    };

    return {
      currentRegime,
      currentProbabilities: STATE_NAMES.map((r, i) => ({
        regime: r,
        probability: +probs[i].toFixed(4),
      })),
      regimePersistence: persistence,
      statePath: path.map((s: number) => STATE_NAMES[s]),
      almImplications: implications[currentRegime].en,
      almImplicationsEs: implications[currentRegime].es,
      status: 'ok',
    };
  }

  // Generate observations from current market data for regime detection
  generateObservationsFromRates(weeklyRates: number[]): number[][] {
    const obs: number[][] = [];
    for (let i = 1; i < weeklyRates.length; i++) {
      const change = (weeklyRates[i] - weeklyRates[i - 1]) * 10000; // bps
      const vol = Math.abs(change) / 100; // simplified volatility proxy
      const spread = change > 0 ? 0.02 : change < -5 ? -0.03 : 0; // simplified spread proxy
      obs.push([change, vol, spread]);
    }
    return obs;
  }

  private logEmit(state: number, obs: number[]): number {
    let logP = 0;
    for (let d = 0; d < Math.min(obs.length, 3); d++) {
      const mu = EMISSION_MEANS[state][d];
      const std = EMISSION_STDS[state][d];
      logP +=
        -0.5 * ((obs[d] - mu) / std) ** 2 -
        Math.log(std * Math.sqrt(2 * Math.PI));
    }
    return logP;
  }

  private forward(observations: number[][]): number[][] {
    const T = observations.length;
    const alpha: number[][] = Array.from({ length: T }, () =>
      new Array(this.K).fill(0),
    );
    for (let j = 0; j < this.K; j++) {
      alpha[0][j] = INITIAL[j] * Math.exp(this.logEmit(j, observations[0]));
    }
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.K; j++) {
        alpha[t][j] =
          alpha[t - 1].reduce((s, a, i) => s + a * TRANSITION[i][j], 0) *
          Math.exp(this.logEmit(j, observations[t]));
      }
      // Scale to prevent underflow
      const scale = alpha[t].reduce((s, a) => s + a, 0) || 1;
      for (let j = 0; j < this.K; j++) alpha[t][j] /= scale;
    }
    return alpha;
  }

  // D1: the honest insufficient-data shell. Replaces the former getDemoResult()
  // (a hardcoded PLATEAU regime / 0.55 probability / 5-step demo path) that read
  // as a real macro-regime call whenever fewer than 4 observations were supplied.
  private dataUnavailableResult(): RegimeResult {
    return {
      currentRegime: null,
      currentProbabilities: [],
      regimePersistence: null,
      statePath: [],
      almImplications: null,
      almImplicationsEs: null,
      status: 'data_unavailable',
      gaps: [
        dataGap('hmmRegime.observations', 'STRESS_INPUTS_INSUFFICIENT', {
          severity: 'WARNING',
          action:
            'La detección de régimen requiere al menos 4 observaciones de tasas (semanas). Cargue un historial de tasas más largo. / Regime detection requires at least 4 rate observations (weeks). Load a longer rate history.',
          context: { service: 'hmm-regime' },
        }),
      ],
    };
  }
}
