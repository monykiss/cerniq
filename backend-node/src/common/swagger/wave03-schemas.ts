/**
 * Wave 03 Swagger/OpenAPI Schemas
 *
 * Central file defining ApiProperty decorators and response schemas for all
 * Wave 03 endpoints. Controllers import these classes instead of defining
 * inline DTO decorators — keeps Swagger definitions DRY and testable.
 *
 * Covers: AI Advisor, CPA White-Label, COSSEC Parser, Enterprise API,
 *         NCUA Integration, Exam Prep, Market Data
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

// ─── AI Advisor ─────────────────────────────────────────────────────────────

@ApiSchema({
  description:
    'AI Advisor response with bilingual content and session tracking',
})
export class AiAdvisorAskResponse {
  @ApiProperty({
    description: 'English response content from the AI advisor',
    example: 'Based on your ALM data, interest rate risk is elevated...',
  })
  content: string;

  @ApiProperty({
    description: 'Spanish translation of the response content',
    example:
      'Basado en sus datos ALM, el riesgo de tasa de interes esta elevado...',
  })
  contentEs: string;

  @ApiProperty({
    description: 'Model identifier used for this response',
    example: 'claude-sonnet-4-20250514',
  })
  modelId: string;

  @ApiProperty({
    description: 'Total tokens consumed (input + output)',
    example: 1847,
  })
  tokenCount: number;

  @ApiProperty({
    description: 'ALM modules referenced during response generation',
    type: [String],
    example: ['interest-rate-risk', 'liquidity', 'capital-adequacy'],
  })
  almModulesReferenced: string[];

  @ApiProperty({
    description: 'Session identifier for conversation continuity',
    example: 'sess_a1b2c3d4e5f6',
  })
  sessionId: string;
}

export class AiAdvisorSessionSummary {
  @ApiProperty({
    description: 'Unique session identifier',
    example: 'sess_a1b2c3d4e5f6',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Preview of the first message in the session',
    example: 'What is our current interest rate risk exposure?',
  })
  preview: string;

  @ApiProperty({
    description: 'Total number of messages in the session',
    example: 12,
  })
  messageCount: number;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the session was created',
    example: '2026-04-15T14:30:00.000Z',
  })
  createdAt: string;
}

@ApiSchema({ description: 'List of AI Advisor conversation sessions' })
export class AiAdvisorSessionListResponse {
  @ApiProperty({
    description: 'Array of session summaries',
    type: [AiAdvisorSessionSummary],
  })
  sessions: AiAdvisorSessionSummary[];
}

// ─── CPA White-Label ────────────────────────────────────────────────────────

export class CpaBranding {
  @ApiProperty({
    description: 'Primary brand color hex',
    example: '#1B3A6B',
    required: false,
  })
  primaryColor?: string;

  @ApiProperty({
    description: 'Logo URL for white-label portal',
    required: false,
  })
  logoUrl?: string;

  @ApiProperty({
    description: 'Custom domain for white-label portal',
    required: false,
  })
  customDomain?: string;
}

@ApiSchema({
  description: 'CPA firm details with branding and subscription tier',
})
export class CpaFirmResponse {
  @ApiProperty({
    description: 'Unique firm identifier',
    example: 'firm_abc123',
  })
  id: string;

  @ApiProperty({
    description: 'Firm display name',
    example: 'Rivera & Associates CPAs',
  })
  name: string;

  @ApiProperty({
    description: 'URL-safe slug for the firm',
    example: 'rivera-associates',
  })
  slug: string;

  @ApiProperty({
    description: 'Subscription tier',
    enum: ['STARTER', 'PROFESSIONAL', 'PARTNER'],
    example: 'PARTNER',
  })
  tier: string;

  @ApiProperty({
    description: 'Number of active clients under this firm',
    example: 12,
  })
  clientCount: number;

  @ApiProperty({
    description: 'Whether the firm account is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'White-label branding configuration',
    type: CpaBranding,
    required: false,
  })
  branding?: CpaBranding;
}

export class ClientSummary {
  @ApiProperty({
    description: 'Client institution identifier',
    example: 'inst_xyz789',
  })
  id: string;

  @ApiProperty({
    description: 'Institution name',
    example: 'Cooperativa de Ahorro Caguas',
  })
  name: string;

  @ApiProperty({ description: 'Total assets in dollars', example: 285000000 })
  totalAssets: number;

  @ApiProperty({ description: 'Overall health score (0-100)', example: 72 })
  healthScore: number;

  @ApiProperty({
    description: 'Last analysis timestamp (ISO-8601)',
    example: '2026-04-14T08:00:00.000Z',
  })
  lastAnalyzedAt: string;
}

@ApiSchema({ description: 'List of clients under a CPA firm' })
export class CpaClientListResponse {
  @ApiProperty({
    description: 'Array of client summaries',
    type: [ClientSummary],
  })
  clients: ClientSummary[];
}

export class RiskDistributionEntry {
  @ApiProperty({
    description: 'Risk level category',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    example: 'MEDIUM',
  })
  level: string;

  @ApiProperty({
    description: 'Number of clients at this risk level',
    example: 5,
  })
  count: number;

  @ApiProperty({ description: 'Percentage of total clients', example: 41.7 })
  percentage: number;
}

@ApiSchema({ description: 'CPA firm dashboard with aggregated client metrics' })
export class CpaDashboardResponse {
  @ApiProperty({
    description: 'Total number of clients under advisory',
    example: 12,
  })
  totalClients: number;

  @ApiProperty({
    description: 'Combined assets under advisory in dollars',
    example: 3400000000,
  })
  totalAssetsUnderAdvisory: number;

  @ApiProperty({
    description: 'Distribution of clients across risk levels',
    type: [RiskDistributionEntry],
  })
  riskDistribution: RiskDistributionEntry[];
}

// ─── COSSEC Parser ──────────────────────────────────────────────────────────

@ApiSchema({ description: 'Result of a COSSEC data file ingestion' })
export class CossecIngestResponse {
  @ApiProperty({
    description: 'Total records received in the upload',
    example: 109,
  })
  totalReceived: number;

  @ApiProperty({
    description: 'Records matched to existing institutions',
    example: 95,
  })
  matched: number;

  @ApiProperty({
    description: 'Records that could not be matched',
    example: 14,
  })
  unmatched: number;

  @ApiProperty({ description: 'New institution records created', example: 8 })
  created: number;

  @ApiProperty({ description: 'Duplicate records skipped', example: 6 })
  duplicatesSkipped: number;
}

// ─── Enterprise API ─────────────────────────────────────────────────────────

@ApiSchema({ description: 'Status summary of sample report generation queue' })
export class SampleReportStatusResponse {
  @ApiProperty({ description: 'Reports waiting in queue', example: 3 })
  waiting: number;

  @ApiProperty({ description: 'Reports currently being generated', example: 1 })
  active: number;

  @ApiProperty({ description: 'Successfully completed reports', example: 47 })
  completed: number;

  @ApiProperty({ description: 'Reports that failed generation', example: 2 })
  failed: number;
}

@ApiSchema({ description: 'Enterprise batch job status and progress' })
export class EnterpriseBatchResponse {
  @ApiProperty({
    description: 'Unique batch job identifier',
    example: 'batch_20260415_001',
  })
  id: string;

  @ApiProperty({
    description: 'Current batch status',
    enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    example: 'RUNNING',
  })
  status: string;

  @ApiProperty({ description: 'Total items in the batch', example: 50 })
  totalItems: number;

  @ApiProperty({
    description: 'Items that have completed successfully',
    example: 32,
  })
  completedItems: number;

  @ApiProperty({ description: 'Items that encountered errors', example: 1 })
  failedItems: number;

  @ApiProperty({ description: 'Completion percentage (0-100)', example: 66 })
  progressPercent: number;
}

@ApiSchema({ description: 'Webhook delivery attempt record' })
export class WebhookDeliveryResponse {
  @ApiProperty({
    description: 'Unique delivery identifier',
    example: 'whd_abc123',
  })
  id: string;

  @ApiProperty({
    description: 'Target URL the webhook was sent to',
    example: 'https://partner.example.com/webhooks/cerniq',
  })
  targetUrl: string;

  @ApiProperty({
    description: 'HTTP response status code from the target',
    example: 200,
  })
  responseStatus: number;

  @ApiProperty({ description: 'Delivery attempt number (1-based)', example: 1 })
  attempt: number;

  @ApiProperty({
    description: 'ISO-8601 timestamp of successful delivery',
    example: '2026-04-15T14:30:00.000Z',
    required: false,
  })
  deliveredAt?: string;
}

// ─── NCUA Integration ───────────────────────────────────────────────────────

@ApiSchema({ description: 'Result of an NCUA Call Report data import' })
export class NcuaImportResponse {
  @ApiProperty({
    description: 'NCUA charter number or internal institution ID',
    example: '12345',
  })
  institutionId: string;

  @ApiProperty({
    description: 'Institution name from NCUA records',
    example: 'First Federal Credit Union',
  })
  name: string;

  @ApiProperty({
    description: 'Total assets in dollars from the latest call report',
    example: 450000000,
  })
  totalAssets: number;

  @ApiProperty({
    description: 'Number of balance sheet line items imported',
    example: 142,
  })
  balanceSheetItemCount: number;

  @ApiProperty({
    description: 'Number of quarterly periods imported',
    example: 4,
  })
  quartersImported: number;
}

// ─── Exam Prep ──────────────────────────────────────────────────────────────

export class CategoryScore {
  @ApiProperty({ description: 'CAMEL category name', example: 'CAPITAL' })
  category: string;

  @ApiProperty({
    description: 'Letter grade for this category',
    enum: ['A', 'B', 'C', 'D', 'F'],
    example: 'B',
  })
  grade: string;

  @ApiProperty({ description: 'Numeric score (0-100)', example: 82 })
  score: number;

  @ApiProperty({
    description: 'Key finding for this category',
    example: 'Net worth ratio at 7.4%, above well-capitalized threshold',
  })
  finding: string;
}

@ApiSchema({
  description:
    'Exam readiness assessment with CAMEL grades and evidence package',
})
export class ExamReadinessResponse {
  @ApiProperty({
    description: 'Overall letter grade',
    enum: ['A', 'B', 'C', 'D', 'F'],
    example: 'B',
  })
  overallGrade: string;

  @ApiProperty({ description: 'Overall numeric score (0-100)', example: 78 })
  overallScore: number;

  @ApiProperty({
    description: 'Per-category CAMEL scores',
    type: [CategoryScore],
  })
  categoryScores: CategoryScore[];

  @ApiProperty({
    description: 'URL to the downloadable evidence package (PDF)',
    example: 'https://api.example.com/reports/evidence/ep_20260415.pdf',
    required: false,
  })
  evidencePackageUrl?: string;
}

// ─── Market Data ────────────────────────────────────────────────────────────

export class RateDataPoint {
  @ApiProperty({
    description: 'Rate data type identifier',
    example: 'SOFR_OVERNIGHT',
  })
  dataType: string;

  @ApiProperty({ description: 'Current value', example: 4.33 })
  value: number;

  @ApiProperty({ description: 'Previous period value', example: 4.35 })
  previousValue: number;

  @ApiProperty({
    description: 'Percentage change from previous value',
    example: -0.46,
  })
  changePercent: number;

  @ApiProperty({
    description: 'As-of date for this data point (ISO-8601 date)',
    example: '2026-04-15',
  })
  asOfDate: string;
}

@ApiSchema({
  description: 'Latest market rate data across tracked instruments',
})
export class MarketDataLatestResponse {
  @ApiProperty({
    description: 'Array of rate data points',
    type: [RateDataPoint],
  })
  rates: RateDataPoint[];
}

@ApiSchema({
  description:
    'Rate alert triggered by threshold breach or significant movement',
})
export class RateAlertResponse {
  @ApiProperty({
    description: 'Metric that triggered the alert',
    example: 'SOFR_OVERNIGHT',
  })
  metric: string;

  @ApiProperty({
    description: 'Alert severity level',
    enum: ['INFO', 'WARNING', 'CRITICAL'],
    example: 'WARNING',
  })
  level: string;

  @ApiProperty({ description: 'Current value of the metric', example: 4.33 })
  currentValue: number;

  @ApiProperty({ description: 'Threshold that was breached', example: 4.5 })
  threshold: number;

  @ApiProperty({
    description: 'Human-readable alert message (English)',
    example: 'SOFR overnight rate dropped 46bps below alert threshold',
  })
  message: string;

  @ApiProperty({
    description: 'Human-readable alert message (Spanish)',
    example:
      'La tasa SOFR overnight bajo 46bps por debajo del umbral de alerta',
  })
  messageEs: string;
}

// ─── Wave 03 Tag Registration ───────────────────────────────────────────────

/**
 * Registers all Wave 03 API tags on an existing OpenAPI document.
 * Call this after SwaggerModule.createDocument() in main.ts:
 *
 * ```ts
 * const doc = SwaggerModule.createDocument(app, config);
 * registerWave03Tags(doc);
 * SwaggerModule.setup('api/v1/docs', app, doc);
 * ```
 */
export function registerWave03Tags(document: OpenAPIObject): void {
  const wave03Tags = [
    {
      name: 'AI Advisor',
      description:
        'Bilingual AI-powered ALM advisory with session management and context-aware responses',
    },
    {
      name: 'CPA White-Label',
      description:
        'Multi-tenant CPA firm portal with client management, branding, and aggregated dashboards',
    },
    {
      name: 'COSSEC Parser',
      description:
        'COSSEC regulatory data file ingestion, parsing, and institution matching',
    },
    {
      name: 'Enterprise API',
      description:
        'Batch processing, webhook delivery, sample report queue, and tenant API key management',
    },
    {
      name: 'NCUA Integration',
      description:
        'NCUA Call Report data import and balance sheet synchronization',
    },
    {
      name: 'Exam Prep',
      description:
        'CAMEL self-assessment, exam readiness scoring, and evidence package generation',
    },
    {
      name: 'Market Data',
      description:
        'Real-time and historical rate data feeds with configurable alert thresholds',
    },
  ];

  if (!document.tags) {
    document.tags = [];
  }

  const existingNames = new Set(document.tags.map((t) => t.name));

  for (const tag of wave03Tags) {
    if (!existingNames.has(tag.name)) {
      document.tags.push(tag);
    }
  }
}
