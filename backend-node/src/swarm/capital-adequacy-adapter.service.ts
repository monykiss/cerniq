import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CapitalAdequacyRatioService } from '../alm/capital-adequacy-ratio.service';

// CapitalAdequacyAdapterService wraps the raw CapitalAdequacyRatioService
// (which takes pre-computed capital params) into an institution-scoped
// call that the QuantSwarm can invoke with just an institutionId.
//
// The raw service is a pure calculator — it knows nothing about the DB.
// This adapter resolves the balance sheet, extracts capital tier amounts,
// and feeds them into the calculator. The swarm's Promise.allSettled
// catches any failure (missing data, zero assets) as a graceful degradation.

@Injectable()
export class CapitalAdequacyAdapterService {
  private readonly logger = new Logger(CapitalAdequacyAdapterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: CapitalAdequacyRatioService,
  ) {}

  async calculate(institutionId: string) {
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
    });

    if (items.length === 0) {
      return {
        cet1Ratio: 0,
        tier1Ratio: 0,
        totalCapitalRatio: 0,
        leverageRatio: 0,
        note: 'No balance sheet data — cannot compute capital adequacy',
      };
    }

    const sum = (category: string, subcategories: string[]) =>
      items
        .filter(
          (i: any) =>
            i.category === category &&
            subcategories.some((s) => i.subcategory?.toLowerCase().includes(s)),
        )
        .reduce((s: number, i: any) => s + Number(i.balance || 0), 0);

    const totalAssets = items
      .filter((i: any) => i.category === 'asset')
      .reduce((s: number, i: any) => s + Number(i.balance || 0), 0);

    const totalLiabilities = items
      .filter((i: any) => i.category === 'liability')
      .reduce((s: number, i: any) => s + Number(i.balance || 0), 0);

    const equity = totalAssets - totalLiabilities;

    // Cooperative credit unions in PR use simpler capital classifications:
    // CET1 ≈ undivided earnings + regular reserves
    // Additional Tier 1 ≈ secondary capital (subordinated debt)
    // Tier 2 ≈ allowance for loan losses (up to 1.25% of RWA)
    const cet1Capital =
      sum('equity', [
        'undivided',
        'retained',
        'reserve',
        'surplus',
        'earnings',
      ]) || equity * 0.85;

    const additionalTier1 = sum('liability', [
      'subordinated',
      'secondary capital',
    ]);

    const allowance = sum('asset', ['allowance', 'reserve for loan']);
    const riskWeightedAssets = totalAssets * 0.72; // simplified RWA estimate
    const tier2Capital = Math.min(allowance, riskWeightedAssets * 0.0125);

    return this.calculator.calculate({
      cet1Capital,
      additionalTier1,
      tier2Capital,
      riskWeightedAssets: riskWeightedAssets || 1,
      totalAssets: totalAssets || 1,
    });
  }
}
