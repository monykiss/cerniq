// ─── Bull Queue Configuration ───────────────────────────────
// Requires: npm install @nestjs/bull bull ioredis
// Redis URL from environment: REDIS_URL

export const QUEUE_NAMES = {
  ALM_COMPUTE: 'alm-compute', // Monte Carlo, OAS, VaR, credit risk
  ALM_REPORTS: 'alm-reports', // PDF generation, board report, COSSEC exam pack
  MARKET_DATA: 'market-data', // FRED pulls, NCUA pulls, peer benchmarks
  NOTIFICATIONS: 'notifications', // emails, webhooks, policy breach alerts
  PROSPECT: 'prospect', // prospect analysis, email generation
} as const;

export const QUEUE_OPTIONS = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 60000 }, // 1min, 4min, 16min
    removeOnComplete: 100, // keep last 100 completed
    removeOnFail: 50,
  },
  limiter: {
    max: 10,
    duration: 60000, // 10 jobs per minute per queue
  },
};

export interface QueueJobData {
  institutionId: string;
  jobType: string;
  params?: Record<string, any>;
  requestedBy?: string;
  priority?: number;
}

export interface QueueJobResult {
  success: boolean;
  data?: any;
  error?: string;
  duration?: number;
}

// ─── Job Type Registry ──────────────────────────────────────

export const JOB_TYPES = {
  // ALM Compute
  MONTE_CARLO: 'monte_carlo',
  OAS_PORTFOLIO: 'oas_portfolio',
  VAR_SUITE: 'var_suite',
  CREDIT_RISK: 'credit_risk',
  FORWARD_SIM: 'forward_simulation',

  // Reports
  BOARD_REPORT: 'board_report',
  EXAM_PACK: 'exam_pack',
  ALM_REPORT_PDF: 'alm_report_pdf',
  FORM_5300: 'form_5300',

  // Market Data
  FRED_PULL: 'fred_pull',
  NCUA_PULL: 'ncua_pull',
  PEER_BENCHMARK_UPDATE: 'peer_benchmark_update',

  // Notifications
  POLICY_BREACH_ALERT: 'policy_breach_alert',
  RATE_MOVE_ALERT: 'rate_move_alert',
  COMPLIANCE_DEADLINE: 'compliance_deadline',
  WEBHOOK_DISPATCH: 'webhook_dispatch',

  // Prospect
  PROSPECT_ANALYZE: 'prospect_analyze',
  PROSPECT_EMAIL: 'prospect_email',
  PROSPECT_BATCH: 'prospect_batch',
} as const;
