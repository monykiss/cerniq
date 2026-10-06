import { Module } from '@nestjs/common';
import { AlmRealtimeGateway } from './alm-realtime.gateway';
import { MarketDataFeedService } from './market-data-feed.service';
import { RateAlertService } from './rate-alert.service';
import { AlmRecalcService } from './alm-recalc.service';
import { MarketDataController } from './market-data.controller';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';

/**
 * Real-Time ALM Dashboard module (W3-5).
 *
 * Provides live market data feeds (SOFR, Treasury curve, PR deposit rates),
 * auto-recalculates NII/EVE sensitivity when rates change, and pushes
 * updates to connected clients via WebSocket (Socket.IO).
 *
 * NOTE: This is separate from the existing RealtimeModule at
 * backend-node/src/realtime/ which handles stock/market WebSockets.
 *
 * PrismaModule and CacheModule are @Global(), so they are available
 * without explicit imports here.
 */
@Module({
  controllers: [MarketDataController],
  providers: [
    AlmRealtimeGateway,
    MarketDataFeedService,
    RateAlertService,
    AlmRecalcService,
    InstitutionScopeGuard,
  ],
  exports: [MarketDataFeedService, RateAlertService],
})
export class RealtimeAlmModule {}
