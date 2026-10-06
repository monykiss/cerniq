import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as prBetaBenchmarks from './data/pr-beta-benchmarks.json';

// ─── Types ───────────────────────────────────────────────────

export interface BetaBenchmark {
  subcategory: string;
  institutionBeta: number;
  peerMedian: number;
  peerP25: number;
  peerP75: number;
  nationalMedian: number;
  gap: number; // institution - peer median
  recommendation: string;
  recommendationEs: string;
}

export interface BetaLibraryResult {
  institutionId: string;
  sizeTier: string;
  benchmarks: BetaBenchmark[];
  insight: string;
  insightEs: string;
}

@Injectable()
export class DepositBetaLibraryService {
  private readonly logger = new Logger(DepositBetaLibraryService.name);
  private readonly library = prBetaBenchmarks;

  constructor(private readonly prisma: PrismaService) {}

  async getBenchmark(institutionId: string): Promise<BetaLibraryResult> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });

    const totalAssets = institution?.totalAssets ?? 200;
    const sizeTier =
      totalAssets < 50 ? 'small' : totalAssets < 300 ? 'medium' : 'large';

    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId, category: 'liability' },
    });

    // Compute institution's actual betas by subcategory
    const institutionBetas = new Map<string, number>();
    for (const item of items) {
      const sub = this.normalizeSubcategory(item.subcategory);
      if (!institutionBetas.has(sub)) {
        institutionBetas.set(sub, item.depositBeta ?? this.getDefaultBeta(sub));
      }
    }

    const benchmarks: BetaBenchmark[] = Object.keys(this.library.betas).map(
      (subcategory) => {
        const peerData = (this.library.betas as any)[subcategory];
        const instBeta =
          institutionBetas.get(subcategory) ?? peerData[sizeTier];
        const peerMedian = peerData.p50;
        const gap = instBeta - peerMedian;

        let recommendation = '';
        let recommendationEs = '';
        if (gap > 0.1) {
          recommendation = `Your ${subcategory.replace(/_/g, ' ')} beta is elevated vs. peers — consider recalibrating. Overestimating deposit cost sensitivity may lead to unnecessary hedging.`;
          recommendationEs = `Su beta de ${subcategory.replace(/_/g, ' ')} está elevado vs. pares — considere recalibrar. Sobreestimar la sensibilidad del costo de depósitos puede llevar a coberturas innecesarias.`;
        } else if (gap < -0.1) {
          recommendation = `Your ${subcategory.replace(/_/g, ' ')} beta may underestimate deposit cost sensitivity — review recent repricing behavior.`;
          recommendationEs = `Su beta de ${subcategory.replace(/_/g, ' ')} puede subestimar la sensibilidad — revise el comportamiento reciente de precios.`;
        } else {
          recommendation = `Your ${subcategory.replace(/_/g, ' ')} beta is aligned with PR cooperative peers.`;
          recommendationEs = `Su beta de ${subcategory.replace(/_/g, ' ')} está alineado con pares cooperativistas de PR.`;
        }

        return {
          subcategory,
          institutionBeta: Math.round(instBeta * 1000) / 1000,
          peerMedian,
          peerP25: peerData.p25,
          peerP75: peerData.p75,
          nationalMedian:
            (this.library.nationalComparison as any)[subcategory] ?? 0.5,
          gap: Math.round(gap * 1000) / 1000,
          recommendation,
          recommendationEs,
        };
      },
    );

    return {
      institutionId,
      sizeTier,
      benchmarks,
      insight: this.library.insight,
      insightEs:
        'Los betas de depósito de cooperativas PR son sistemáticamente 25-40% más bajos que los promedios nacionales de bancos asegurados FDIC, impulsados por la lealtad del socio, alternativas limitadas y la psicología de propiedad cooperativa.',
    };
  }

  getRawLibrary() {
    return this.library;
  }

  private normalizeSubcategory(sub: string): string {
    const s = sub.toLowerCase().replace(/[-\s]+/g, '_');
    if (s.includes('demand') || s.includes('checking'))
      return 'demand_deposits';
    if (s.includes('saving') || s.includes('ahorro')) return 'savings_deposits';
    if (s.includes('share_draft') || s.includes('draft')) return 'share_drafts';
    if (s.includes('money_market') || s.includes('mm')) return 'money_market';
    if (s.includes('ira')) return 'iras';
    if (
      s.includes('time') ||
      s.includes('cd') ||
      s.includes('plazo') ||
      s.includes('certificate')
    )
      return 'time_deposits';
    return s;
  }

  private getDefaultBeta(sub: string): number {
    const defaults: Record<string, number> = {
      demand_deposits: 0.1,
      savings_deposits: 0.18,
      share_drafts: 0.13,
      money_market: 0.41,
      iras: 0.58,
      time_deposits: 0.79,
    };
    return defaults[sub] ?? 0.4;
  }
}
