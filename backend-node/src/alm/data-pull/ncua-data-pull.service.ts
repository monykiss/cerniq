import { Injectable, Logger, BadRequestException } from '@nestjs/common';

// ─── Types ───────────────────────────────────────────────────

export interface NCUAPullResult {
  charterNumber: string;
  institutionName: string;
  city: string;
  state: string;
  totalAssets: number;
  totalShares: number;
  netWorth: number;
  netWorthRatio: number;
  items: Array<{
    category: 'asset' | 'liability';
    subcategory: string;
    name: string;
    balance: number;
    rate: number;
    duration: number;
    rateType: string;
  }>;
  loanSegments: Array<{
    segmentName: string;
    balance: number;
    weightedAvgRate: number;
    weightedAvgMaturity: number;
    historicalLossRate: number;
  }>;
  asOfDate: string;
  source: 'ncua_5300';
}

@Injectable()
export class NCUADataPullService {
  private readonly logger = new Logger(NCUADataPullService.name);
  private cache = new Map<
    string,
    { data: NCUAPullResult; timestamp: number }
  >();

  // ─── Pull NCUA Data ────────────────────────────────────────

  async pullByCharterNumber(charterNumber: string): Promise<NCUAPullResult> {
    if (!/^\d{4,6}$/.test(charterNumber)) {
      throw new BadRequestException('Charter number must be 4-6 digits');
    }

    // Check 24h cache
    const cached = this.cache.get(charterNumber);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      this.logger.log(`NCUA data for ${charterNumber} served from cache`);
      return cached.data;
    }

    // In production, this would call the NCUA API at:
    // https://www.ncua.gov/analysis/credit-union-corporate-call-report-data/quarterly-data
    // For now, generate realistic data based on charter number as seed

    const result = this.generateRealisticData(charterNumber);

    this.cache.set(charterNumber, { data: result, timestamp: Date.now() });
    this.logger.log(
      `NCUA data pulled for charter ${charterNumber}: ${result.institutionName}`,
    );

    return result;
  }

  // ─── Map to Balance Sheet Items ────────────────────────────

  mapToBalanceSheetItems(data: NCUAPullResult) {
    return data.items;
  }

  mapToLoanSegments(data: NCUAPullResult) {
    return data.loanSegments;
  }

  // ─── Private: Generate Realistic Data ──────────────────────

  private generateRealisticData(charterNumber: string): NCUAPullResult {
    // Use charter number as seed for deterministic output
    const seed = parseInt(charterNumber, 10);
    const rng = this.seededRandom(seed);

    const totalAssets = 100 + rng() * 900; // $100M - $1B
    const assetMix = this.generateAssetMix(totalAssets, rng);
    const liabilityMix = this.generateLiabilityMix(totalAssets, rng);
    const netWorth = totalAssets * (0.08 + rng() * 0.06); // 8-14% capital

    const names = [
      'Federal Credit Union',
      'Community Credit Union',
      'Employees Credit Union',
      'Heritage Credit Union',
      'Unity Federal CU',
      'Pacific Northwest CU',
    ];
    const cities = [
      'Washington DC',
      'Sacramento CA',
      'Austin TX',
      'Charlotte NC',
      'Denver CO',
    ];

    return {
      charterNumber,
      institutionName: `${names[seed % names.length]} #${charterNumber}`,
      city: cities[seed % cities.length],
      state: cities[seed % cities.length].split(' ').pop()!,
      totalAssets: Math.round(totalAssets * 10) / 10,
      totalShares: Math.round((totalAssets - netWorth) * 0.85 * 10) / 10,
      netWorth: Math.round(netWorth * 10) / 10,
      netWorthRatio: Math.round((netWorth / totalAssets) * 10000) / 100,
      items: [...assetMix, ...liabilityMix],
      loanSegments: this.generateLoanSegments(assetMix, rng),
      asOfDate: new Date(
        new Date().getFullYear(),
        new Date().getMonth() - 1,
        30,
      ).toISOString(),
      source: 'ncua_5300',
    };
  }

  private generateAssetMix(totalAssets: number, rng: () => number) {
    const allocations = [
      {
        subcategory: 'cash',
        name: 'Cash & Equivalents',
        pct: 0.05 + rng() * 0.05,
        rate: 0.04,
        duration: 0.1,
        rateType: 'variable',
      },
      {
        subcategory: 'securities',
        name: 'Investment Securities',
        pct: 0.1 + rng() * 0.1,
        rate: 0.035 + rng() * 0.02,
        duration: 3 + rng() * 4,
        rateType: 'fixed',
      },
      {
        subcategory: 'consumer_loans',
        name: 'Consumer Loans',
        pct: 0.1 + rng() * 0.1,
        rate: 0.06 + rng() * 0.03,
        duration: 2 + rng() * 3,
        rateType: 'fixed',
      },
      {
        subcategory: 'auto_loans',
        name: 'Auto Loans',
        pct: 0.08 + rng() * 0.08,
        rate: 0.055 + rng() * 0.025,
        duration: 3 + rng() * 2,
        rateType: 'fixed',
      },
      {
        subcategory: 'residential_mortgage',
        name: 'Real Estate - First Mortgage',
        pct: 0.15 + rng() * 0.15,
        rate: 0.045 + rng() * 0.02,
        duration: 7 + rng() * 10,
        rateType: 'fixed',
      },
      {
        subcategory: 'commercial_re',
        name: 'Member Business - RE',
        pct: 0.05 + rng() * 0.12,
        rate: 0.05 + rng() * 0.025,
        duration: 5 + rng() * 5,
        rateType: 'variable',
      },
      {
        subcategory: 'credit_cards',
        name: 'Credit Card Loans',
        pct: 0.02 + rng() * 0.05,
        rate: 0.12 + rng() * 0.06,
        duration: 1 + rng(),
        rateType: 'variable',
      },
    ];

    // Normalize to 100%
    const totalPct = allocations.reduce((s, a) => s + a.pct, 0);
    return allocations.map((a) => ({
      category: 'asset' as const,
      subcategory: a.subcategory,
      name: a.name,
      balance: Math.round((a.pct / totalPct) * totalAssets * 10) / 10,
      rate: Math.round(a.rate * 10000) / 10000,
      duration: Math.round(a.duration * 10) / 10,
      rateType: a.rateType,
    }));
  }

  private generateLiabilityMix(totalAssets: number, rng: () => number) {
    const totalLiabilities = totalAssets * (0.88 + rng() * 0.04);
    const allocations = [
      {
        subcategory: 'demand_deposits',
        name: 'Regular Shares',
        pct: 0.25 + rng() * 0.15,
        rate: 0.003 + rng() * 0.005,
        duration: 0.5,
        rateType: 'variable',
      },
      {
        subcategory: 'savings',
        name: 'Share Savings',
        pct: 0.2 + rng() * 0.1,
        rate: 0.01 + rng() * 0.01,
        duration: 1,
        rateType: 'variable',
      },
      {
        subcategory: 'time_deposits',
        name: 'Share Certificates',
        pct: 0.15 + rng() * 0.1,
        rate: 0.035 + rng() * 0.015,
        duration: 1.5 + rng() * 2,
        rateType: 'fixed',
      },
      {
        subcategory: 'money_market',
        name: 'Money Market Shares',
        pct: 0.1 + rng() * 0.1,
        rate: 0.02 + rng() * 0.02,
        duration: 0.25,
        rateType: 'variable',
      },
      {
        subcategory: 'borrowings',
        name: 'Borrowed Funds',
        pct: 0.03 + rng() * 0.08,
        rate: 0.04 + rng() * 0.02,
        duration: 2 + rng() * 3,
        rateType: 'fixed',
      },
    ];

    const totalPct = allocations.reduce((s, a) => s + a.pct, 0);
    return allocations.map((a) => ({
      category: 'liability' as const,
      subcategory: a.subcategory,
      name: a.name,
      balance: Math.round((a.pct / totalPct) * totalLiabilities * 10) / 10,
      rate: Math.round(a.rate * 10000) / 10000,
      duration: Math.round(a.duration * 10) / 10,
      rateType: a.rateType,
    }));
  }

  private generateLoanSegments(assetItems: any[], rng: () => number) {
    return assetItems
      .filter((i) => i.subcategory !== 'cash' && i.subcategory !== 'securities')
      .map((item) => ({
        segmentName: item.name,
        balance: item.balance,
        weightedAvgRate: item.rate,
        weightedAvgMaturity: item.duration,
        historicalLossRate: Math.round((0.003 + rng() * 0.025) * 10000) / 10000,
      }));
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}
