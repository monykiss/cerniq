import { Module } from '@nestjs/common';
import { PipelineGateway } from './pipeline.gateway';

/**
 * Report-progress websocket for the customer portal.
 *
 * This module also hosted `RealtimeGateway`, which streamed quotes for the
 * trading surfaces and pulled in MarketData/Options/Portfolio. Those product
 * lines were removed. `PipelineGateway` is retained because the portal
 * (`frontend/components/portal/ReportProgressWS.tsx`) connects to its
 * `/pipeline` namespace to follow a report job — it depends on nothing beyond
 * socket.io and the shared origin allowlist.
 */
@Module({
  providers: [PipelineGateway],
  exports: [PipelineGateway],
})
export class RealtimeModule {}
