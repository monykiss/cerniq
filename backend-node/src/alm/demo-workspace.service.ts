import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NCUADataPullService } from './data-pull/ncua-data-pull.service';

export interface DemoWorkspace {
  institutionId: string;
  name: string;
  dashboardUrl: string;
  talkingPoints: string[];
  metrics: { healthScore: number; camelComposite: number };
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class DemoWorkspaceService {
  private readonly logger = new Logger(DemoWorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ncuaDataPull: NCUADataPullService,
  ) {}

  async buildWorkspace(
    charterNumber: string,
    demoLabel: string,
  ): Promise<DemoWorkspace> {
    const start = Date.now();

    const ncuaData = await this.ncuaDataPull.pullByCharterNumber(charterNumber);

    let workspaceId: string;
    const sysWs = await this.prisma.workspace.findFirst({
      where: { name: '__DEMO_WORKSPACES__' },
    });
    if (sysWs) {
      workspaceId = sysWs.id;
    } else {
      workspaceId = (
        await this.prisma.workspace.create({
          data: { name: '__DEMO_WORKSPACES__' },
        })
      ).id;
    }

    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);

    const inst = await this.prisma.institution.create({
      data: {
        workspaceId,
        name: `${ncuaData.institutionName} [DEMO: ${demoLabel}]`,
        type: 'credit_union',
        totalAssets: ncuaData.totalAssets,
        currency: 'USD',
        reportingDate: new Date(),
        primaryRegulator: 'NCUA',
      },
    });

    await this.prisma.balanceSheetItem.createMany({
      data: ncuaData.items.map((item) => ({
        institutionId: inst.id,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate,
        duration: item.duration,
        rateType: item.rateType,
      })),
    });

    const talkingPoints = [
      `${ncuaData.institutionName}: $${ncuaData.totalAssets.toFixed(0)}M assets, NWR ${ncuaData.netWorthRatio.toFixed(1)}%`,
      ncuaData.netWorthRatio < 9
        ? 'Capital below PR median — lead with capital planning demo'
        : 'Capital strong — lead with rate shock + COSSEC exam pack',
      'Show the AI Analyst: "What is our biggest risk right now?" — instant answer from their actual data',
    ];

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    this.logger.log(
      `Demo workspace built in ${elapsed}s for ${ncuaData.institutionName}`,
    );

    return {
      institutionId: inst.id,
      name: ncuaData.institutionName,
      dashboardUrl: `/alm?institution=${inst.id}&demo=true`,
      talkingPoints,
      metrics: { healthScore: 72, camelComposite: 2 },
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
