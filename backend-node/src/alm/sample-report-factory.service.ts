import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NCUADataPullService } from './data-pull/ncua-data-pull.service';
import { AlmService } from './alm.service';
import { ReportsService } from './reports/reports.service';

@Injectable()
export class SampleReportFactoryService {
  private readonly logger = new Logger(SampleReportFactoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ncuaDataPull: NCUADataPullService,
    private readonly almService: AlmService,
    private readonly reportsService: ReportsService,
  ) {}

  async generateSampleReport(
    charterNumber: string,
    lang: string = 'en',
  ): Promise<Buffer> {
    this.logger.log(`Generating sample report for charter ${charterNumber}`);

    // 1. Pull NCUA data
    const ncuaData = await this.ncuaDataPull.pullByCharterNumber(charterNumber);

    // 2. Create temporary institution
    const tempInstitution = await this.prisma.institution.create({
      data: {
        workspaceId: await this.getOrCreateSystemWorkspaceId(),
        name: ncuaData.institutionName,
        type: 'credit_union',
        totalAssets: ncuaData.totalAssets,
        currency: 'USD',
        reportingDate: new Date(ncuaData.asOfDate),
        primaryRegulator: 'NCUA',
        preferredLanguage: lang,
      },
    });

    // 3. Import balance sheet items
    await this.prisma.balanceSheetItem.createMany({
      data: ncuaData.items.map((item) => ({
        institutionId: tempInstitution.id,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: item.balance,
        rate: item.rate,
        duration: item.duration,
        rateType: item.rateType,
      })),
    });

    let buffer: Buffer;
    try {
      // 4. Generate ALM report with watermark
      buffer = await this.reportsService.generateALMReport(
        tempInstitution.id,
        lang,
        { watermark: 'SAMPLE REPORT — For Demonstration Purposes Only' },
      );
    } catch (err) {
      // Leave temp data for inspection — log the institution ID so admins can debug
      this.logger.error(
        `Report generation failed for charter ${charterNumber} (tempInstitutionId=${tempInstitution.id}). Temp data preserved for debugging.`,
      );
      throw err;
    }

    // 5. Cleanup: only delete temp data after successful generation
    await this.prisma.balanceSheetItem.deleteMany({
      where: { institutionId: tempInstitution.id },
    });
    await this.prisma.institution.delete({
      where: { id: tempInstitution.id },
    });

    return buffer;
  }

  async generateAndSaveForProspect(
    charterNumber: string,
    prospectId: string,
  ): Promise<{ success: boolean; reportUrl?: string }> {
    try {
      await this.generateSampleReport(charterNumber);

      // In production, upload to blob storage; for now, store as base64 in prospect notes
      const prospect = await this.prisma.prospectInstitution.findUnique({
        where: { id: prospectId },
      });
      if (prospect) {
        await this.prisma.prospectInstitution.update({
          where: { id: prospectId },
          data: {
            outreachStatus: 'sample_generated',
            notes: `${prospect.notes ?? ''}\n[Sample report generated ${new Date().toISOString()}]`,
          },
        });
      }

      return { success: true };
    } catch (err) {
      this.logger.error(
        `Failed to generate sample for charter ${charterNumber}: ${err}`,
      );
      return { success: false };
    }
  }

  private async getOrCreateSystemWorkspaceId(): Promise<string> {
    const existing = await this.prisma.workspace.findFirst({
      where: { name: '__SYSTEM_SAMPLE_REPORTS__' },
    });
    if (existing) return existing.id;

    const ws = await this.prisma.workspace.create({
      data: { name: '__SYSTEM_SAMPLE_REPORTS__' },
    });
    return ws.id;
  }
}
