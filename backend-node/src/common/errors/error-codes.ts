/**
 * CERNIQ Enterprise Error Code Registry.
 *
 * Every error returned by the API includes a machine-readable code
 * from this registry. Clients can switch on these codes for
 * programmatic error handling without parsing messages.
 *
 * Format: DOMAIN_CATEGORY_DETAIL
 * Domains: AUTH, ALM, BILLING, EXPENSE, SYSTEM
 */
export const ERROR_CODES = {
  // ── Authentication ──────────────────────────
  AUTH_TOKEN_EXPIRED: {
    code: 'AUTH_TOKEN_EXPIRED',
    status: 401,
    message: 'Authentication token has expired',
  },
  AUTH_TOKEN_INVALID: {
    code: 'AUTH_TOKEN_INVALID',
    status: 401,
    message: 'Invalid authentication token',
  },
  AUTH_TOKEN_MISSING: {
    code: 'AUTH_TOKEN_MISSING',
    status: 401,
    message: 'No authentication token provided',
  },
  AUTH_API_KEY_INVALID: {
    code: 'AUTH_API_KEY_INVALID',
    status: 401,
    message: 'Invalid API key',
  },
  AUTH_API_KEY_REVOKED: {
    code: 'AUTH_API_KEY_REVOKED',
    status: 401,
    message: 'API key has been revoked',
  },
  AUTH_API_KEY_EXPIRED: {
    code: 'AUTH_API_KEY_EXPIRED',
    status: 401,
    message: 'API key has expired',
  },
  AUTH_INSUFFICIENT_ROLE: {
    code: 'AUTH_INSUFFICIENT_ROLE',
    status: 403,
    message: 'Insufficient role for this operation',
  },
  AUTH_ORG_REQUIRED: {
    code: 'AUTH_ORG_REQUIRED',
    status: 403,
    message: 'Organization context required',
  },
  AUTH_ORG_ACCESS_DENIED: {
    code: 'AUTH_ORG_ACCESS_DENIED',
    status: 403,
    message: 'Not a member of this organization',
  },

  // ── ALM Analysis ────────────────────────────
  ALM_INSTITUTION_NOT_FOUND: {
    code: 'ALM_INSTITUTION_NOT_FOUND',
    status: 404,
    message: 'Institution not found',
  },
  ALM_BALANCE_SHEET_EMPTY: {
    code: 'ALM_BALANCE_SHEET_EMPTY',
    status: 422,
    message: 'Balance sheet has no line items',
  },
  ALM_COMPUTATION_TIMEOUT: {
    code: 'ALM_COMPUTATION_TIMEOUT',
    status: 408,
    message: 'Analysis computation timed out',
  },
  ALM_COMPUTATION_FAILED: {
    code: 'ALM_COMPUTATION_FAILED',
    status: 500,
    message: 'Analysis computation failed',
  },
  ALM_MONTE_CARLO_INVALID_PARAMS: {
    code: 'ALM_MONTE_CARLO_INVALID_PARAMS',
    status: 422,
    message: 'Invalid Monte Carlo parameters',
  },
  ALM_REPORT_NOT_FOUND: {
    code: 'ALM_REPORT_NOT_FOUND',
    status: 404,
    message: 'Report not found',
  },
  ALM_WORKSPACE_NOT_FOUND: {
    code: 'ALM_WORKSPACE_NOT_FOUND',
    status: 404,
    message: 'Workspace not found',
  },

  // ── Billing ─────────────────────────────────
  BILLING_NO_SUBSCRIPTION: {
    code: 'BILLING_NO_SUBSCRIPTION',
    status: 402,
    message: 'No active subscription',
  },
  BILLING_PLAN_LIMIT: {
    code: 'BILLING_PLAN_LIMIT',
    status: 403,
    message: 'Plan limit reached — upgrade required',
  },
  BILLING_CHECKOUT_FAILED: {
    code: 'BILLING_CHECKOUT_FAILED',
    status: 500,
    message: 'Checkout session creation failed',
  },
  BILLING_WEBHOOK_INVALID: {
    code: 'BILLING_WEBHOOK_INVALID',
    status: 400,
    message: 'Invalid webhook signature',
  },

  // ── SpendCheck ──────────────────────────────
  EXPENSE_ORG_NOT_FOUND: {
    code: 'EXPENSE_ORG_NOT_FOUND',
    status: 404,
    message: 'Organization not found',
  },
  EXPENSE_FILE_TOO_LARGE: {
    code: 'EXPENSE_FILE_TOO_LARGE',
    status: 413,
    message: 'Upload exceeds maximum file size',
  },
  EXPENSE_INVALID_FORMAT: {
    code: 'EXPENSE_INVALID_FORMAT',
    status: 422,
    message: 'Invalid file format — CSV or XLSX required',
  },

  // ── System ──────────────────────────────────
  SYSTEM_RATE_LIMITED: {
    code: 'SYSTEM_RATE_LIMITED',
    status: 429,
    message: 'Rate limit exceeded',
  },
  SYSTEM_MAINTENANCE: {
    code: 'SYSTEM_MAINTENANCE',
    status: 503,
    message: 'System under maintenance',
  },
  SYSTEM_INTERNAL_ERROR: {
    code: 'SYSTEM_INTERNAL_ERROR',
    status: 500,
    message: 'Internal server error',
  },
  SYSTEM_TIMEOUT: {
    code: 'SYSTEM_TIMEOUT',
    status: 408,
    message: 'Request timed out',
  },
  SYSTEM_IDEMPOTENCY_CONFLICT: {
    code: 'SYSTEM_IDEMPOTENCY_CONFLICT',
    status: 409,
    message: 'Idempotency key already used with different parameters',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
