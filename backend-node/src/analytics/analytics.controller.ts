import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('api/analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary(@Req() req: any) {
    const orgId = req.headers['x-organization-id'] || 'default-org';
    return this.analyticsService.getSummary(orgId, req.user.userId);
  }

  @Get('trends')
  getSpendingTrends(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: any,
  ) {
    const orgId = req.headers['x-organization-id'] || 'default-org';
    const range = {
      startDate:
        startDate ||
        new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate || new Date().toISOString(),
    };
    return this.analyticsService.getSpendingTrends(
      orgId,
      req.user.userId,
      range,
    );
  }

  @Get('categories')
  getCategoryBreakdown(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: any,
  ) {
    const orgId = req.headers['x-organization-id'] || 'default-org';
    const range = startDate && endDate ? { startDate, endDate } : undefined;
    return this.analyticsService.getCategoryBreakdown(
      orgId,
      req.user.userId,
      range,
    );
  }

  @Get('team')
  getTeamComparison(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: any,
  ) {
    const orgId = req.headers['x-organization-id'] || 'default-org';
    const range = startDate && endDate ? { startDate, endDate } : undefined;
    return this.analyticsService.getTeamComparison(
      orgId,
      req.user.userId,
      range,
    );
  }

  @Get('export')
  async exportExpenses(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('format') format: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const orgId = req.headers['x-organization-id'] || 'default-org';
    const range = startDate && endDate ? { startDate, endDate } : undefined;
    const data = await this.analyticsService.exportExpenses(
      orgId,
      req.user.userId,
      range,
    );

    if (format === 'csv' && res) {
      const headers = Object.keys(data[0] || {});
      const csv = [
        headers.join(','),
        ...data.map((row: any) => headers.map((h) => `"${row[h]}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=expenses.csv');
      return res.send(csv);
    }

    return res.json(data);
  }
}
