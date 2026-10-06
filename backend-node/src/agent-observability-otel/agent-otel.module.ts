import { Module } from '@nestjs/common';
import { AgentSpanFactory } from './agent-span.factory';
import { AgentCorrelationInterceptor } from './correlation.interceptor';
import { SseToSpanBridge } from './sse-to-span.bridge';

/**
 * Agent-specific OpenTelemetry wiring.
 *
 * The NodeSDK + OTLP exporter are initialised in `src/telemetry.ts` at
 * process start. This module only adds the CerniQ-specific semantic
 * conventions, span factory, SSE→span bridge, and the HTTP correlation
 * interceptor. Consumer modules (agent-trust, agent-eval, peer agents)
 * import {@link AgentSpanFactory} directly.
 *
 * To enable the interceptor globally, add to AppModule:
 *   providers: [{ provide: APP_INTERCEPTOR, useClass: AgentCorrelationInterceptor }]
 */
@Module({
  providers: [AgentSpanFactory, SseToSpanBridge, AgentCorrelationInterceptor],
  exports: [AgentSpanFactory, SseToSpanBridge, AgentCorrelationInterceptor],
})
export class AgentOtelModule {}
