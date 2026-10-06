import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { YieldCurveService, TenorRate } from './yield-curve.service';

// ─── Types ───────────────────────────────────────────────────

export interface FTPInstrument {
  id: string;
  name: string;
  category: 'asset' | 'liability';
  subcategory: string;
  balance: number;
  actualRate: number;
  duration: number;
  ftpRate: number; // matched-maturity rate from yield curve
  spread: number; // asset: actualRate - ftpRate; liability: ftpRate - actualRate
  spreadBps: number;
  contribution: number; // balance × spread (annualized)
}

export interface FTPSegment {
  segment: string;
  category: 'asset' | 'liability';
  totalBalance: number;
  weightedActualRate: number;
  weightedFTPRate: number;
  weightedSpread: number;
  totalContribution: number;
  instrumentCount: number;
}

export interface FTPAnalysis {
  instruments: FTPInstrument[];
  segments: FTPSegment[];
  summary: {
    totalAssetContribution: number;
    totalLiabilityContribution: number;
    netFTPMargin: number;
    netFTPMarginPct: number;
    totalAssets: number;
    totalLiabilities: number;
    weightedAssetSpread: number;
    weightedLiabilitySpread: number;
  };
  curveUsed: string;
  asOfDate: string;
}

export interface NewProductPricing {
  tenor: number;
  ftpRate: number;
  minimumRate: number; // ftpRate + target spread
  targetSpread: number;
  breakEvenRate: number;
}

@Injectable()
export class FTPService {
  private readonly logger = new Logger(FTPService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yieldCurveService: YieldCurveService,
  ) {}

  // ─── Full FTP Analysis ──────────────────────────────────────

  async getFTPAnalysis(
    institutionId: string,
    spreadAdjBps?: number,
  ): Promise<FTPAnalysis> {
    // Load balance sheet items
    const items = await this.prisma.balanceSheetItem.findMany({
      where: { institutionId },
      orderBy: { balance: 'desc' },
    });

    // Load yield curve
    let baseCurve: TenorRate[];
    let curveName = 'US Treasury (Default)';

    const savedCurve = await this.prisma.yieldCurve.findFirst({
      where: { institutionId, isBase: true },
      orderBy: { asOfDate: 'desc' },
    });

    if (savedCurve) {
      baseCurve = savedCurve.tenors as unknown as TenorRate[];
      curveName = savedCurve.name;
    } else {
      baseCurve = [
        { tenor: 0.25, rate: 0.048 },
        { tenor: 0.5, rate: 0.0465 },
        { tenor: 1, rate: 0.044 },
        { tenor: 2, rate: 0.042 },
        { tenor: 3, rate: 0.041 },
        { tenor: 5, rate: 0.0405 },
        { tenor: 7, rate: 0.041 },
        { tenor: 10, rate: 0.042 },
        { tenor: 20, rate: 0.0455 },
        { tenor: 30, rate: 0.0465 },
      ];
    }

    const adj = (spreadAdjBps ?? 0) / 10000;

    // Calculate FTP for each instrument
    const instruments: FTPInstrument[] = items.map((item: any) => {
      const tenor = Math.max(item.duration || 1, 0.25);
      const ftpRate = this.interpolateRate(baseCurve, tenor) + adj;
      const isAsset = item.category === 'asset';
      const spread = isAsset ? item.rate - ftpRate : ftpRate - item.rate;
      const contribution = item.balance * spread;

      return {
        id: item.id,
        name: item.name,
        category: item.category as 'asset' | 'liability',
        subcategory: item.subcategory,
        balance: item.balance,
        actualRate: item.rate,
        duration: tenor,
        ftpRate,
        spread,
        spreadBps: spread * 10000,
        contribution,
      };
    });

    // Aggregate by subcategory
    const segmentMap = new Map<string, FTPSegment>();
    for (const inst of instruments) {
      const key = `${inst.category}:${inst.subcategory}`;
      if (!segmentMap.has(key)) {
        segmentMap.set(key, {
          segment: inst.subcategory,
          category: inst.category,
          totalBalance: 0,
          weightedActualRate: 0,
          weightedFTPRate: 0,
          weightedSpread: 0,
          totalContribution: 0,
          instrumentCount: 0,
        });
      }
      const seg = segmentMap.get(key)!;
      seg.totalBalance += Number(inst.balance);
      seg.weightedActualRate += inst.actualRate * inst.balance;
      seg.weightedFTPRate += inst.ftpRate * inst.balance;
      seg.weightedSpread += inst.spread * inst.balance;
      seg.totalContribution += inst.contribution;
      seg.instrumentCount++;
    }

    const segments = Array.from(segmentMap.values()).map((seg) => ({
      ...seg,
      weightedActualRate:
        seg.totalBalance > 0 ? seg.weightedActualRate / seg.totalBalance : 0,
      weightedFTPRate:
        seg.totalBalance > 0 ? seg.weightedFTPRate / seg.totalBalance : 0,
      weightedSpread:
        seg.totalBalance > 0 ? seg.weightedSpread / seg.totalBalance : 0,
    }));

    // Summary
    const assets = instruments.filter((i) => i.category === 'asset');
    const liabilities = instruments.filter((i) => i.category === 'liability');
    const totalAssets = assets.reduce((s, i) => s + Number(i.balance), 0);
    const totalLiabilities = liabilities.reduce(
      (s, i) => s + Number(i.balance),
      0,
    );
    const totalAssetContrib = assets.reduce((s, i) => s + i.contribution, 0);
    const totalLiabContrib = liabilities.reduce(
      (s, i) => s + i.contribution,
      0,
    );

    return {
      instruments,
      segments: segments.sort(
        (a, b) => Math.abs(b.totalContribution) - Math.abs(a.totalContribution),
      ),
      summary: {
        totalAssetContribution: totalAssetContrib,
        totalLiabilityContribution: totalLiabContrib,
        netFTPMargin: totalAssetContrib + totalLiabContrib,
        netFTPMarginPct:
          totalAssets > 0
            ? (totalAssetContrib + totalLiabContrib) / totalAssets
            : 0,
        totalAssets,
        totalLiabilities,
        weightedAssetSpread:
          totalAssets > 0 ? totalAssetContrib / totalAssets : 0,
        weightedLiabilitySpread:
          totalLiabilities > 0 ? totalLiabContrib / totalLiabilities : 0,
      },
      curveUsed: curveName,
      asOfDate: new Date().toISOString(),
    };
  }

  // ─── Segment Summary ────────────────────────────────────────

  async getFTPSegments(institutionId: string): Promise<FTPSegment[]> {
    const analysis = await this.getFTPAnalysis(institutionId);
    return analysis.segments;
  }

  // ─── New Product Pricing Tool ──────────────────────────────

  getNewProductPricing(
    baseCurve: TenorRate[],
    tenors: number[] = [1, 2, 3, 5, 7, 10],
  ): NewProductPricing[] {
    return tenors.map((tenor) => {
      const ftpRate = this.interpolateRate(baseCurve, tenor);
      const targetSpread = 0.015; // 150bps default target
      return {
        tenor,
        ftpRate,
        minimumRate: ftpRate + targetSpread,
        targetSpread,
        breakEvenRate: ftpRate + 0.005, // 50bps for OpEx
      };
    });
  }

  // ─── Private ───────────────────────────────────────────────

  private interpolateRate(curve: TenorRate[], tenor: number): number {
    const sorted = [...curve].sort((a, b) => a.tenor - b.tenor);
    if (tenor <= sorted[0].tenor) return sorted[0].rate;
    if (tenor >= sorted[sorted.length - 1].tenor)
      return sorted[sorted.length - 1].rate;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (tenor >= sorted[i].tenor && tenor <= sorted[i + 1].tenor) {
        const t1 = sorted[i].tenor,
          t2 = sorted[i + 1].tenor;
        const r1 = sorted[i].rate,
          r2 = sorted[i + 1].rate;
        return r1 + ((r2 - r1) * (tenor - t1)) / (t2 - t1);
      }
    }
    return sorted[0].rate;
  }
}
