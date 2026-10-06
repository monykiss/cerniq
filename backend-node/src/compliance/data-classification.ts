// ─── SOC 2 Data Classification Scheme ─────────────────────
// Maps every sensitive field in the CERNIQ data model to a
// classification tier.  Auditors reference this inventory to
// verify that controls match the data's sensitivity level.

export enum DataClassification {
  PUBLIC = 'public', // Marketing content, pricing pages
  INTERNAL = 'internal', // Employee-only dashboards, audit logs
  CONFIDENTIAL = 'confidential', // Client institution data, financial metrics
  RESTRICTED = 'restricted', // PII, API keys, passwords, encryption keys
}

/**
 * Exhaustive map of dot-path field identifiers → classification.
 * Wildcard entries (e.g. `auditLog.*`) apply to every column in
 * that model unless a more-specific key overrides it.
 */
export const FIELD_CLASSIFICATIONS: Record<string, DataClassification> = {
  // ── User model ────────────────────────────────────────────
  'user.email': DataClassification.CONFIDENTIAL,
  'user.name': DataClassification.CONFIDENTIAL,
  'user.passwordHash': DataClassification.RESTRICTED,
  'user.avatarUrl': DataClassification.INTERNAL,
  'user.provider': DataClassification.INTERNAL,
  'user.providerId': DataClassification.RESTRICTED,
  'user.role': DataClassification.INTERNAL,
  'user.lastLoginAt': DataClassification.INTERNAL,
  'user.emailVerified': DataClassification.INTERNAL,

  // ── Authentication / Tokens ───────────────────────────────
  'refreshToken.token': DataClassification.RESTRICTED,
  'magicLink.token': DataClassification.RESTRICTED,
  'passwordResetToken.token': DataClassification.RESTRICTED,

  // ── API Keys ──────────────────────────────────────────────
  'apiKey.keyHash': DataClassification.RESTRICTED,
  'apiKey.keyPrefix': DataClassification.CONFIDENTIAL,
  'apiKey.name': DataClassification.INTERNAL,

  // ── Institution / Financial ───────────────────────────────
  'institution.name': DataClassification.CONFIDENTIAL,
  'institution.totalAssets': DataClassification.CONFIDENTIAL,
  'institution.cossecRegistrationNumber': DataClassification.CONFIDENTIAL,
  'institution.contactName': DataClassification.CONFIDENTIAL,
  'institution.contactEmail': DataClassification.CONFIDENTIAL,
  'institution.contactPhone': DataClassification.CONFIDENTIAL,
  'institution.type': DataClassification.INTERNAL,

  // ── Balance Sheet / ALM ───────────────────────────────────
  'balanceSheetItem.*': DataClassification.CONFIDENTIAL,
  'interestRateScenario.*': DataClassification.CONFIDENTIAL,
  'liquidityPosition.*': DataClassification.CONFIDENTIAL,
  'loanSegment.*': DataClassification.CONFIDENTIAL,
  'depositTier.*': DataClassification.CONFIDENTIAL,
  'loanCohort.*': DataClassification.CONFIDENTIAL,
  'yieldCurve.*': DataClassification.CONFIDENTIAL,

  // ── Audit Logs ────────────────────────────────────────────
  'auditLog.*': DataClassification.INTERNAL,
  'auditLog.ipAddress': DataClassification.CONFIDENTIAL,
  'auditLog.userAgent': DataClassification.INTERNAL,

  // ── Infrastructure Secrets (env vars, never persisted) ────
  'env.DATA_ENCRYPTION_KEY': DataClassification.RESTRICTED,
  'env.JWT_SECRET': DataClassification.RESTRICTED,
  'env.ADMIN_KEY': DataClassification.RESTRICTED,
  'env.DATABASE_URL': DataClassification.RESTRICTED,
  'env.STRIPE_SECRET_KEY': DataClassification.RESTRICTED,
  'env.SENTRY_DSN': DataClassification.INTERNAL,

  // ── Billing / Subscription ────────────────────────────────
  'subscription.stripeCustomerId': DataClassification.RESTRICTED,
  'subscription.stripeSubscriptionId': DataClassification.RESTRICTED,

  // ── Public ────────────────────────────────────────────────
  'marketData.tickerSymbol': DataClassification.PUBLIC,
  'marketData.price': DataClassification.PUBLIC,
};

/**
 * Look up the classification for a given field path.
 * Falls back to wildcard (`model.*`) if no exact match,
 * then defaults to CONFIDENTIAL (safe default for unknown fields).
 */
export function classifyField(fieldPath: string): DataClassification {
  // Exact match first
  if (FIELD_CLASSIFICATIONS[fieldPath]) {
    return FIELD_CLASSIFICATIONS[fieldPath];
  }

  // Wildcard match: "model.*"
  const modelName = fieldPath.split('.')[0];
  const wildcard = `${modelName}.*`;
  if (FIELD_CLASSIFICATIONS[wildcard]) {
    return FIELD_CLASSIFICATIONS[wildcard];
  }

  // Default to CONFIDENTIAL — treat unknown data as sensitive
  return DataClassification.CONFIDENTIAL;
}

/**
 * Returns a summary suitable for SOC 2 evidence packages:
 * how many fields fall into each classification tier.
 */
export function getClassificationSummary(): Record<DataClassification, number> {
  const summary: Record<DataClassification, number> = {
    [DataClassification.PUBLIC]: 0,
    [DataClassification.INTERNAL]: 0,
    [DataClassification.CONFIDENTIAL]: 0,
    [DataClassification.RESTRICTED]: 0,
  };

  for (const classification of Object.values(FIELD_CLASSIFICATIONS)) {
    summary[classification]++;
  }

  return summary;
}
