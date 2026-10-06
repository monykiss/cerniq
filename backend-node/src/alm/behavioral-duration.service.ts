import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as Sentry from '@sentry/nestjs';

// Hutchison & Pennacchi (1996) Non-Maturity Deposit Model
// Cooperative deposits have behavioral duration much longer than overnight

export interface NMDDuration {
  subcategory: string;
  balance: number;
  contractualDuration: number; // overnight = 0
  behavioralDuration: number; // Hutchison model output
  beta: number;
  runoffRate: number;
  interpretation: string;
  interpretationEs: string;
}

export interface BehavioralDurationResult {
  deposits: NMDDuration[];
  portfolioContractualDuration: number;
  portfolioBehavioralDuration: number;
  durationCorrection: number; // behavioral - contractual (usually large positive)
  eveImpactCorrection: number; // $ change in EVE from using behavioral vs contractual
  narrativeEs: string;
  narrativeEn: string;
}

const NMD_PARAMS: Record<string, { beta: number; runoffRate: number }> = {
  demand_deposits: { beta: 0.1, runoffRate: 0.08 },
  savings: { beta: 0.18, runoffRate: 0.1 },
  share_drafts: { beta: 0.13, runoffRate: 0.09 },
  money_market: { beta: 0.41, runoffRate: 0.15 },
};

@Injectable()
export class BehavioralDurationService {
  private readonly logger = new Logger(BehavioralDurationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeBehavioralDurations(
    institutionId: string,
  ): Promise<BehavioralDurationResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId, category: 'liability' },
      });

      // Vasicek parameters (from existing MonteCarloService calibration)
      const kappa = 0.15; // mean reversion speed
      const sigma = 0.012; // rate volatility

      const deposits: NMDDuration[] = [];
      let totalBalance = 0;
      let weightedContractual = 0;
      let weightedBehavioral = 0;

      for (const item of items) {
        const sub = item.subcategory.toLowerCase();
        const params = NMD_PARAMS[sub];
        if (!params) continue; // skip time deposits, borrowings (they have contractual maturity)

        const beta = item.depositBeta ?? params.beta;
        const phi = params.runoffRate;

        // Hutchison-Pennacchi: D_NMD = beta / (kappa + phi)
        // Convexity adjustment: D_adj = D * (1 - sigma²/(2*kappa²) * (1 - beta))
        const coreD = beta / (kappa + phi);
        const convAdj = sigma ** 2 / (2 * kappa ** 2);
        const behavioralD = Math.min(
          10,
          Math.max(0.25, coreD * (1 - convAdj * (1 - beta))),
        );

        const contractualD = 0; // NMDs are contractually overnight

        deposits.push({
          subcategory: sub,
          balance: item.balance,
          contractualDuration: contractualD,
          behavioralDuration: +behavioralD.toFixed(2),
          beta,
          runoffRate: phi,
          interpretation: `${sub.replace(/_/g, ' ')}: behavioral duration ${behavioralD.toFixed(1)}yr (beta=${(beta * 100).toFixed(0)}%, runoff=${(phi * 100).toFixed(0)}%/yr). Much longer than overnight contractual.`,
          interpretationEs: `${sub.replace(/_/g, ' ')}: duración conductual ${behavioralD.toFixed(1)} años (beta=${(beta * 100).toFixed(0)}%, fuga=${(phi * 100).toFixed(0)}%/año). Mucho más largo que el vencimiento contractual de un día.`,
        });

        totalBalance += Number(item.balance);
        weightedContractual += contractualD * item.balance;
        weightedBehavioral += behavioralD * item.balance;
      }

      const portContractual =
        totalBalance > 0 ? weightedContractual / totalBalance : 0;
      const portBehavioral =
        totalBalance > 0 ? weightedBehavioral / totalBalance : 0;
      const correction = portBehavioral - portContractual;

      // EVE impact: using behavioral durations reduces the EVE gap
      // ΔEVE ≈ -correction × totalBalance × 0.02 (200bps shock)
      const eveCorrection = correction * totalBalance * 0.02;

      return {
        deposits,
        portfolioContractualDuration: +portContractual.toFixed(2),
        portfolioBehavioralDuration: +portBehavioral.toFixed(2),
        durationCorrection: +correction.toFixed(2),
        eveImpactCorrection: +eveCorrection.toFixed(2),
        narrativeEs: `La duración conductual del portafolio de depósitos NMD es ${portBehavioral.toFixed(1)} años (vs. 0 contractual). Esto reduce la brecha de duración en ${correction.toFixed(1)} años y el impacto EVE a +200bps en $${eveCorrection.toFixed(1)}M. Usar duración contractual sobreestima significativamente el riesgo de tasa.`,
        narrativeEn: `NMD portfolio behavioral duration is ${portBehavioral.toFixed(1)} years (vs. 0 contractual). This reduces the duration gap by ${correction.toFixed(1)} years and EVE impact at +200bps by $${eveCorrection.toFixed(1)}M. Using contractual duration significantly overestimates rate risk.`,
      };
    } catch (error: any) {
      this.logger.error(`Computation failed: ${error.message}`, error.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }
}
