import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { UserThrottleGuard } from './common/guards/user-throttle.guard';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { SlowRequestInterceptor } from './common/interceptors/slow-query.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ApiVersionMiddleware } from './common/middleware/api-version.middleware';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { CorrelationInterceptor } from './common/interceptors/correlation.interceptor';
import { RealtimeModule } from './realtime/realtime.module';
import { CacheModule } from './cache/cache.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { StorageModule } from './storage/storage.module';
import { LlmModule } from './llm/llm.module';
import { AuthModule } from './auth/auth.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { JobsModule } from './jobs/jobs.module';
import { AlmModule } from './alm/alm.module';
import { ActionsModule } from './actions/actions.module';
import { EmailModule } from './email/email.module';
import { BillingModule } from './billing/billing.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PortalModule } from './portal/portal.module';
import { FeedbackModule } from './feedback/feedback.module';
import { DataCryptoModule } from './crypto/data-crypto.module';
import { AuditModule } from './audit/audit.module';
import { ApiV1Module } from './api-v1/api-v1.module';
import { ComplianceModule } from './compliance/compliance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ModelRegistryModule } from './model-registry/model-registry.module';
import { GovernanceModule } from './governance/governance.module';
import { AgentsModule } from './agents/agents.module';
import { AgentApiModule } from './agent-api/agent-api.module';
import { AgentTrustModule } from './agent-trust/agent-trust.module';
import { AgentEvalModule } from './agent-eval/agent-eval.module';
import { AgentOtelModule } from './agent-observability-otel/agent-otel.module';
import { AiAdvisorModule } from './ai-advisor/ai-advisor.module';
import { CossecModule } from './cossec/cossec.module';
import { RealtimeAlmModule } from './realtime-alm/realtime-alm.module';
import { EnterpriseModule } from './enterprise/enterprise.module';
import { NcuaModule } from './ncua/ncua.module';
import { ExamPrepModule } from './exam-prep/exam-prep.module';
import { ComplianceRegistryModule } from './compliance-registry/compliance-registry.module';

@Module({
  imports: [
    // Sentry error tracking (must be first)
    SentryModule.forRoot(),
    // Structured JSON logging
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        // Redact list covers every known auth token, API key, and PII
        // field that could reach the Pino stream. Any addition to the
        // auth surface (new header, new body field) needs a matching
        // entry here — otherwise that value lands in prod logs in
        // plaintext. Paired with Sentry's beforeSend() scrubber in
        // src/instrument.ts for the error-reporting path.
        redact: [
          // ─── Request headers (tokens + admin keys) ───────────────
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-admin-key"]',
          'req.headers["x-api-key"]',
          'req.headers["x-stripe-signature"]',
          'req.headers["x-webhook-secret"]',
          // ─── Request body (auth fields) ──────────────────────────
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.token',
          'req.body.refreshToken',
          'req.body.apiKey',
          'req.body.accessToken',
          'req.body.secret',
          'req.body.clientSecret',
          // ─── Request body (Stripe + payment) ─────────────────────
          'req.body.stripeToken',
          'req.body.paymentMethodId',
          'req.body.cardNumber',
          'req.body.cvc',
          // ─── Request body (PII for COSSEC/NCUA compliance) ───────
          'req.body.ssn',
          'req.body.ein',
          'req.body.taxId',
          // ─── Query string (sometimes tokens leak here) ───────────
          'req.query.apiKey',
          'req.query.token',
          'req.query.accessToken',
          // ─── Response Set-Cookie (session material) ──────────────
          'res.headers["set-cookie"]',
        ],
        serializers: {
          req: (req) => ({ method: req.method, url: req.url, id: req.id }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    // Rate limiting — 100 requests per minute globally
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    // Cron discoverer for @Cron decorators (required by AgentSchedulerService).
    // Without this, @Cron handlers are silently never registered.
    ScheduleModule.forRoot(),
    PrismaModule,
    // Application-level encryption (AES-256-GCM)
    DataCryptoModule,
    CacheModule,
    RealtimeModule,
    // SpendCheck modules
    AuthModule,
    OrganizationsModule,
    StorageModule,
    LlmModule,
    AnalyticsModule,
    // Data pipeline
    JobsModule,
    // Phase 3: action registry — enterprise actions across the whole app
    ActionsModule,
    // Asset Liability Management
    AlmModule,
    // Email notifications
    EmailModule,
    // Billing & subscriptions (Stripe)
    BillingModule,
    // Report pipeline automation
    PipelineModule,
    // Client portal API
    PortalModule,
    // Audit trail (COSSEC compliance)
    AuditModule,
    // NPS feedback & surveys
    FeedbackModule,
    // Public API v1 (Swagger-documented, API key auth)
    ApiV1Module,
    // SOC 2 Type II compliance automation
    ComplianceModule,
    // Slack/webhook notifications for sales alerts
    NotificationsModule,
    // Month-end Close Cockpit (CFO → CPA workflow)
    // FAANG Audit P1: Formal model governance registry
    ModelRegistryModule,
    // FAANG Audit P1: Governed scenarios + benchmarks
    GovernanceModule,
    // Agent Execution Layer (Blueprint §1): runtime for the 12-agent catalog.
    // Depends on AlmModule for the quantitative tools exposed to the LLM.
    AgentsModule,
    // Per-tenant HTTP surface for agent runs, alerts, copilot, SSE, trace export.
    // Depends on AgentsModule for the runner + event bus, PrismaModule for RLS.
    AgentApiModule,
    // Agent trust layer: PII redaction, prompt injection shield, output schema validation.
    AgentTrustModule,
    // Agent eval harness: golden-case regression, replay runner, regression scoring.
    AgentEvalModule,
    // Agent observability: OpenTelemetry spans for tool calls, LLM turns, run lifecycle.
    AgentOtelModule,
    // Wave 03: AI Advisor — bilingual conversational ALM analysis (Claude claude-sonnet-4-6).
    AiAdvisorModule,
    // Wave 03: CPA White-Label — multi-tenant CPA firm management + branded reports.
    // Wave 02 Gap: COSSEC examination findings parser ingest + sample report generator.
    CossecModule,
    // Wave 03: Real-time ALM dashboard — SOFR/Treasury feeds, rate alerts, WebSocket push.
    RealtimeAlmModule,
    // Wave 03: Enterprise API — bulk report batches, webhook delivery, HMAC-signed callbacks.
    EnterpriseModule,
    // Wave 03: NCUA Form 5300 integration — US credit union data import + field mapping.
    NcuaModule,
    // Wave 03: Exam Prep Suite — COSSEC readiness scoring, evidence package generation.
    ExamPrepModule,
    // 62-module COSSEC compliance registry — queryable regulatory coverage map.
    ComplianceRegistryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: UserThrottleGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SlowRequestInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        RequestIdMiddleware,
        ApiVersionMiddleware,
        RequestLoggingMiddleware,
      )
      .forRoutes('*');

    // RLS tenant context: sets PostgreSQL session variables for row-level security.
    // Applied to all api/* routes; no-ops gracefully for unauthenticated requests.
    consumer.apply(TenantContextMiddleware).forRoutes('api/*');
  }
}
