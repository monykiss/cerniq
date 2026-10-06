import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MarketDataFeedService } from './market-data-feed.service';
import { RateAlertService } from './rate-alert.service';
import { AuthTenantGuard } from '../auth/auth-tenant.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import {
  SetThresholdParamsSchema,
  HistoryQuerySchema,
  MarketDataSnapshot,
  RateAlert,
  RateAlertThreshold,
  TreasuryCurveResult,
  MarketRateResult,
} from './realtime-alm.dto';

@Controller('api/market-data')
export class MarketDataController {
  private readonly logger = new Logger(MarketDataController.name);

  constructor(
    private readonly marketDataFeed: MarketDataFeedService,
    private readonly rateAlertService: RateAlertService,
  ) {}

  // ─── Rate Endpoints ────────────────────────────────────────

  /**
   * GET /api/market-data/latest
   * Returns the latest market rates across all tracked data types.
   */
  // verify:auth-skip — public realtime ALM market-rate feed (Treasury / SOFR / etc.); no PII
  @Get('latest')
  async getLatestRates(): Promise<{ data: MarketDataSnapshot[] }> {
    const snapshots = await this.marketDataFeed.fetchLatestRates();
    return { data: snapshots };
  }

  /**
   * GET /api/market-data/treasury-curve
   * Returns the latest US Treasury yield curve.
   */
  // verify:auth-skip — public US Treasury yield curve feed; sourced from public market data
  @Get('treasury-curve')
  async getTreasuryCurve(): Promise<{ data: TreasuryCurveResult }> {
    const curve = await this.marketDataFeed.fetchTreasuryCurve();
    return { data: curve };
  }

  /**
   * GET /api/market-data/sofr
   * Returns the latest SOFR rate.
   */
  // verify:auth-skip — public SOFR rate feed; sourced from public market data
  @Get('sofr')
  async getSOFR(): Promise<{ data: MarketRateResult }> {
    const sofr = await this.marketDataFeed.fetchSOFR();
    return { data: sofr };
  }

  /**
   * GET /api/market-data/history/:dataType?from=&to=
   * Returns historical rate snapshots for a given data type.
   */
  // verify:auth-skip — public historical rate feed; no PII; same data class as /latest
  @Get('history/:dataType')
  async getHistory(
    @Param('dataType') dataType: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ data: MarketDataSnapshot[] }> {
    const queryParsed = HistoryQuerySchema.safeParse({ from, to });
    // Use defaults if query is malformed
    const fromDate = from
      ? new Date(from)
      : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException(
        'Invalid date format for from/to parameters',
      );
    }

    const snapshots = await this.marketDataFeed.getHistoricalRates(
      dataType,
      fromDate,
      toDate,
    );
    return { data: snapshots };
  }

  // ─── Alert Endpoints ───────────────────────────────────────

  /**
   * GET /api/market-data/alerts/:institutionId
   * Returns all active rate alerts for the institution.
   */
  @Get('alerts/:institutionId')
  @UseGuards(AuthTenantGuard, InstitutionScopeGuard)
  async getActiveAlerts(
    @Param('institutionId') institutionId: string,
  ): Promise<{ data: RateAlert[] }> {
    const alerts = await this.rateAlertService.getActiveAlerts(institutionId);
    return { data: alerts };
  }

  /**
   * POST /api/market-data/alerts/:institutionId
   * Create or update an alert threshold for the institution.
   */
  @Post('alerts/:institutionId')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthTenantGuard, InstitutionScopeGuard)
  async setAlertThreshold(
    @Param('institutionId') institutionId: string,
    @Body() body: unknown,
  ): Promise<{ data: RateAlertThreshold }> {
    const parsed = SetThresholdParamsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    const threshold = await this.rateAlertService.setThreshold(
      institutionId,
      parsed.data,
    );
    return { data: threshold };
  }

  /**
   * DELETE /api/market-data/alerts/:institutionId/:metric
   * Remove an alert threshold for a specific metric.
   */
  @Delete('alerts/:institutionId/:metric')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthTenantGuard, InstitutionScopeGuard)
  async removeAlertThreshold(
    @Param('institutionId') institutionId: string,
    @Param('metric') metric: string,
  ): Promise<void> {
    await this.rateAlertService.removeThreshold(institutionId, metric);
  }
}
