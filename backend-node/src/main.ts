// Load env before instrumentation so telemetry and Sentry can read startup configuration.
import 'dotenv/config';
import './instrument';
import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger as NestLogger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

const cookieParser = require('cookie-parser');

const helmet = require('helmet');

const express = require('express');

const compression = require('compression');
import { AppModule } from './app.module';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';
import { MaintenanceModeGuard } from './common/guards/maintenance-mode.guard';
import { corsOriginCallback } from './security/origin-allowlist';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { SensitiveFieldRedactorInterceptor } from './common/interceptors/sensitive-field-redactor.interceptor';
import { SanitizePipe } from './common/pipes/sanitize.pipe';
import { getGoogleOAuthWarnings } from './auth/oauth-config.util';
import { validateEnv } from './config/env.schema';

async function bootstrap() {
  // --- Zod-based env validation (exits on failure with formatted error) ---
  const env = validateEnv();

  // Warn on missing but non-fatal integrations
  const isProd = env.NODE_ENV === 'production';
  if (isProd && !env.ADMIN_KEY)
    console.warn('WARN: ADMIN_KEY not set — admin endpoints disabled.');
  if (isProd && !env.STRIPE_SECRET_KEY)
    console.warn('WARN: STRIPE_SECRET_KEY not set — billing disabled.');
  if (isProd && !env.RESEND_API_KEY)
    console.warn('WARN: RESEND_API_KEY not set — email delivery disabled.');
  if (isProd && !env.DATA_ENCRYPTION_KEY)
    console.warn(
      'WARN: DATA_ENCRYPTION_KEY not set — PII encryption disabled.',
    );
  if (isProd && !env.ANTHROPIC_API_KEY)
    console.warn(
      'WARN: ANTHROPIC_API_KEY not set — CERNIQ Analyst falls back to local data-only mode.',
    );
  if (isProd && !env.REDIS_URL)
    console.warn(
      'WARN: REDIS_URL not set — using in-memory rate limiting and cache.',
    );
  for (const warning of getGoogleOAuthWarnings()) {
    console.warn(`WARN: ${warning}`);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Required for Stripe webhook signature verification
    bufferLogs: true, // Buffer logs until Pino is attached
  });

  // Use Pino structured logger as the application logger
  try {
    app.useLogger(app.get(Logger));
  } catch {
    // Fallback to default NestJS logger if Pino module not loaded
    new NestLogger('Bootstrap').warn(
      'Pino logger not available, using default',
    );
  }

  // Trust Railway/Vercel proxy for correct client IP in rate limiting
  app.set('trust proxy', 1);

  // --- Request body size limits ---
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // --- Response compression (gzip/br) — reduces ALM report payloads by 70-90% ---
  app.use(compression({ threshold: 1024 })); // Only compress responses > 1KB

  // --- Security middleware ---
  app.use(cookieParser());
  app.use((_req: any, res: any, next: any) => {
    // Generate a per-request nonce for inline scripts
    const nonce = require('crypto').randomBytes(16).toString('base64');
    res.locals.cspNonce = nonce;
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            ((_req: any, res: any) => `'nonce-${res.locals.cspNonce}'`) as any,
            'https://cdn.segment.com',
            'https://*.google-analytics.com',
            'https://*.googletagmanager.com',
            'https://us.i.posthog.com',
          ],
          connectSrc: [
            "'self'",
            'https://api.segment.io',
            'https://*.google-analytics.com',
            'https://*.analytics.google.com',
            'https://us.i.posthog.com',
            'wss:',
          ],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"], // Styles need unsafe-inline for Tailwind
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );

  // --- Global exception filter & response envelope ---
  // Sentry filter must be registered first so it captures before our custom filter formats
  if (
    process.env.SENTRY_DSN &&
    typeof (Sentry as any).SentryGlobalFilter === 'function'
  ) {
    app.useGlobalFilters(new (Sentry as any).SentryGlobalFilter());
  }
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  // --- Enterprise interceptors & guards ---
  app.useGlobalInterceptors(new PerformanceInterceptor());
  app.useGlobalInterceptors(new SensitiveFieldRedactorInterceptor());
  app.useGlobalGuards(new MaintenanceModeGuard());

  // --- Global validation pipe ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // --- Input sanitization (XSS prevention) ---
  app.useGlobalPipes(new SanitizePipe());

  // --- CORS ---
  app.enableCors({
    origin: corsOriginCallback,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-admin-key',
      'x-organization-id',
      'x-klytics-org-id',
      'x-idempotency-key',
    ],
    maxAge: 86400,
  });

  // --- Graceful shutdown (drain connections on SIGTERM) ---
  app.enableShutdownHooks();

  // Mark health endpoint as 503 during shutdown so load balancers drain
  const appControllerModule = await import('./app.controller.js');
  process.on('SIGTERM', () => {
    appControllerModule.AppController.markShuttingDown();
  });

  // --- Swagger / OpenAPI ---
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CERNIQ API')
    .setDescription(
      'Institutional ALM Intelligence API for credit unions, cooperativas, and community banks.\n\n' +
        '## Authentication\n' +
        'All authenticated endpoints require an API key passed via the `Authorization` header:\n' +
        '```\nAuthorization: Bearer ck_live_...\n```\n\n' +
        '## Rate Limits\n' +
        '- **Standard tier:** 100 requests/hour per API key\n' +
        '- **Partner tier:** 1,000 requests/hour per API key\n\n' +
        '## Response Envelope\n' +
        'All responses are wrapped in: `{ "success": true, "data": ... }`',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'API Key (ck_live_...)' },
      'BearerAuth',
    )
    .addTag('ALM Analysis', 'Balance sheet analysis and regulatory compliance')
    .addTag(
      'Authentication',
      'User registration, login, OAuth, and API key management',
    )
    .addTag(
      'Billing',
      'Subscription checkout, Stripe webhooks, and billing portal',
    )
    .addTag(
      'Client Portal',
      'Report jobs, data submission, ALCO packs, and team management',
    )
    .addTag(
      'SpendCheck',
      'Expense management, anomaly detection, and AP intelligence',
    )
    .addTag('Benchmarks', 'Sector benchmarks and comparison data')
    .addTag('Reference Data', 'Supported frameworks and configuration')
    .addTag('System', 'Health checks and diagnostics')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, swaggerDocument, {
    customSiteTitle: 'CERNIQ API Documentation',
    customCss: `.topbar-wrapper img { content: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text x="0" y="15" font-size="16" font-family="system-ui" font-weight="bold" fill="%231B3A6B">CERNIQ</text></svg>'); }`,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
    },
  });
  const bootLogger = new NestLogger('Bootstrap');
  bootLogger.log('Swagger UI available at /api/v1/docs');

  // --- Start server ---
  const port = process.env.PORT || process.env.BACKEND_PORT || 3000;
  await app.listen(port, '0.0.0.0');
  bootLogger.log(
    `CERNIQ backend running on 0.0.0.0:${port} [${process.env.NODE_ENV || 'development'}]`,
  );
}

// --- Global crash handlers — catch everything Sentry + Pino can't ---
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled Promise rejection:', reason);
  Sentry.captureException(
    reason instanceof Error ? reason : new Error(String(reason)),
  );
  // Give Sentry 2s to flush, then exit
  setTimeout(() => process.exit(1), 2000);
});

process.on('uncaughtException', (error: Error) => {
  console.error('[FATAL] Uncaught exception:', error);
  Sentry.captureException(error);
  setTimeout(() => process.exit(1), 2000);
});

void bootstrap();
