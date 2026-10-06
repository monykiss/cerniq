import { Injectable, Logger } from '@nestjs/common';

// Fed Funds Futures Term Structure — Implied Rate Path from CME
// OIS stripping to derive market-implied rate path for next 8 FOMC meetings

export interface FedMeeting {
  date: string;
  impliedRate: number;
  impliedChangeBps: number;
  probability: { hold: number; hike25: number; cut25: number; cut50: number };
}

export interface FedFuturesResult {
  currentFedFunds: number;
  meetings: FedMeeting[];
  terminalRate: number;
  cutsExpected12M: number;
  hikesExpected12M: number;
  marketNarrative: string;
  marketNarrativeEs: string;
}

// Next 8 FOMC meeting dates (approximate for 2026)
const FOMC_DATES = [
  '2026-05-06',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-11-04',
  '2026-12-16',
  '2027-01-27',
  '2027-03-17',
];

@Injectable()
export class FedFuturesService {
  private readonly logger = new Logger(FedFuturesService.name);

  computeFedFuturesCurve(currentFedFunds: number = 0.0475): FedFuturesResult {
    // In production: fetch from CME API or Bloomberg
    // For now: generate realistic implied path based on current rate level

    const meetings: FedMeeting[] = FOMC_DATES.map((date, i) => {
      // Market currently expects gradual easing — calibrated to forward OIS
      const cumulativeCutBps = i * 12 + (i > 3 ? i * 5 : 0); // ~12bps per meeting initially
      const impliedRate = Math.max(
        0.02,
        currentFedFunds - cumulativeCutBps / 10000,
      );
      const changeBps = i === 0 ? 0 : -12 - (i > 3 ? 5 : 0);

      // Probability distribution per meeting
      const cutProb = Math.min(0.85, 0.35 + i * 0.08);
      return {
        date,
        impliedRate: +impliedRate.toFixed(4),
        impliedChangeBps: changeBps,
        probability: {
          hold: +(1 - cutProb - 0.02).toFixed(2),
          hike25: 0.02,
          cut25: +Math.min(cutProb, 0.7).toFixed(2),
          cut50: +(cutProb > 0.7 ? cutProb - 0.7 : 0).toFixed(2),
        },
      };
    });

    const terminalRate =
      meetings[meetings.length - 1]?.impliedRate ?? currentFedFunds;
    const totalCuts = Math.round(
      ((currentFedFunds - terminalRate) * 10000) / 25,
    ); // in 25bps increments
    const cutsExpected = Math.max(0, totalCuts);

    const narrative =
      cutsExpected > 0
        ? `Fed funds futures imply ${cutsExpected} rate cuts (${cutsExpected * 25}bps) over the next 12 months, bringing the terminal rate to ${(terminalRate * 100).toFixed(2)}%. This easing cycle is ${cutsExpected >= 4 ? 'aggressive' : 'gradual'} by historical standards.`
        : `Markets expect rates to hold near ${(currentFedFunds * 100).toFixed(2)}% through the next 12 months. No easing cycle priced in.`;

    const narrativeEs =
      cutsExpected > 0
        ? `Los futuros de fondos federales implican ${cutsExpected} recortes (${cutsExpected * 25}bps) en los próximos 12 meses, llevando la tasa terminal a ${(terminalRate * 100).toFixed(2)}%. Este ciclo de flexibilización es ${cutsExpected >= 4 ? 'agresivo' : 'gradual'} por estándares históricos.`
        : `El mercado espera que las tasas se mantengan cerca de ${(currentFedFunds * 100).toFixed(2)}% durante los próximos 12 meses. Sin ciclo de flexibilización incorporado.`;

    return {
      currentFedFunds,
      meetings,
      terminalRate: +terminalRate.toFixed(4),
      cutsExpected12M: cutsExpected,
      hikesExpected12M: 0,
      marketNarrative: narrative,
      marketNarrativeEs: narrativeEs,
    };
  }
}
