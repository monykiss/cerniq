import {
  DataClassification,
  FIELD_CLASSIFICATIONS,
  classifyField,
  getClassificationSummary,
} from './data-classification';

describe('DataClassification enum', () => {
  it('should have four classification tiers', () => {
    expect(DataClassification.PUBLIC).toBe('public');
    expect(DataClassification.INTERNAL).toBe('internal');
    expect(DataClassification.CONFIDENTIAL).toBe('confidential');
    expect(DataClassification.RESTRICTED).toBe('restricted');
  });
});

describe('classifyField', () => {
  // ── Exact matches ──

  it('should return RESTRICTED for user.passwordHash', () => {
    expect(classifyField('user.passwordHash')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return CONFIDENTIAL for user.email', () => {
    expect(classifyField('user.email')).toBe(DataClassification.CONFIDENTIAL);
  });

  it('should return INTERNAL for user.avatarUrl', () => {
    expect(classifyField('user.avatarUrl')).toBe(DataClassification.INTERNAL);
  });

  it('should return PUBLIC for marketData.tickerSymbol', () => {
    expect(classifyField('marketData.tickerSymbol')).toBe(
      DataClassification.PUBLIC,
    );
  });

  it('should return PUBLIC for marketData.price', () => {
    expect(classifyField('marketData.price')).toBe(DataClassification.PUBLIC);
  });

  it('should return RESTRICTED for refreshToken.token', () => {
    expect(classifyField('refreshToken.token')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return RESTRICTED for magicLink.token', () => {
    expect(classifyField('magicLink.token')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return RESTRICTED for passwordResetToken.token', () => {
    expect(classifyField('passwordResetToken.token')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return RESTRICTED for env.JWT_SECRET', () => {
    expect(classifyField('env.JWT_SECRET')).toBe(DataClassification.RESTRICTED);
  });

  it('should return RESTRICTED for env.DATABASE_URL', () => {
    expect(classifyField('env.DATABASE_URL')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return RESTRICTED for apiKey.keyHash', () => {
    expect(classifyField('apiKey.keyHash')).toBe(DataClassification.RESTRICTED);
  });

  it('should return CONFIDENTIAL for apiKey.keyPrefix', () => {
    expect(classifyField('apiKey.keyPrefix')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should return INTERNAL for apiKey.name', () => {
    expect(classifyField('apiKey.name')).toBe(DataClassification.INTERNAL);
  });

  it('should return RESTRICTED for subscription.stripeCustomerId', () => {
    expect(classifyField('subscription.stripeCustomerId')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return RESTRICTED for subscription.stripeSubscriptionId', () => {
    expect(classifyField('subscription.stripeSubscriptionId')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return CONFIDENTIAL for institution.contactEmail', () => {
    expect(classifyField('institution.contactEmail')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should return CONFIDENTIAL for institution.contactPhone', () => {
    expect(classifyField('institution.contactPhone')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should return INTERNAL for institution.type', () => {
    expect(classifyField('institution.type')).toBe(DataClassification.INTERNAL);
  });

  it('should return INTERNAL for user.role', () => {
    expect(classifyField('user.role')).toBe(DataClassification.INTERNAL);
  });

  it('should return INTERNAL for user.lastLoginAt', () => {
    expect(classifyField('user.lastLoginAt')).toBe(DataClassification.INTERNAL);
  });

  it('should return RESTRICTED for user.providerId', () => {
    expect(classifyField('user.providerId')).toBe(
      DataClassification.RESTRICTED,
    );
  });

  it('should return INTERNAL for env.SENTRY_DSN', () => {
    expect(classifyField('env.SENTRY_DSN')).toBe(DataClassification.INTERNAL);
  });

  // ── Wildcard matches ──

  it('should match wildcard for balanceSheetItem.someField', () => {
    expect(classifyField('balanceSheetItem.someField')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for auditLog.createdAt (INTERNAL)', () => {
    expect(classifyField('auditLog.createdAt')).toBe(
      DataClassification.INTERNAL,
    );
  });

  it('should prefer exact match over wildcard for auditLog.ipAddress', () => {
    expect(classifyField('auditLog.ipAddress')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for liquidityPosition.amount', () => {
    expect(classifyField('liquidityPosition.amount')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for interestRateScenario.rate', () => {
    expect(classifyField('interestRateScenario.rate')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for loanSegment.balance', () => {
    expect(classifyField('loanSegment.balance')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for depositTier.rate', () => {
    expect(classifyField('depositTier.rate')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for loanCohort.lossRate', () => {
    expect(classifyField('loanCohort.lossRate')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should match wildcard for yieldCurve.tenor', () => {
    expect(classifyField('yieldCurve.tenor')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  // ── Default fallback ──

  it('should default to CONFIDENTIAL for unknown model.field', () => {
    expect(classifyField('unknownModel.unknownField')).toBe(
      DataClassification.CONFIDENTIAL,
    );
  });

  it('should default to CONFIDENTIAL for single-part paths', () => {
    expect(classifyField('something')).toBe(DataClassification.CONFIDENTIAL);
  });

  it('should default to CONFIDENTIAL for deeply nested unknown path', () => {
    expect(classifyField('a.b.c.d')).toBe(DataClassification.CONFIDENTIAL);
  });
});

describe('getClassificationSummary', () => {
  it('should return counts for all four classification tiers', () => {
    const summary = getClassificationSummary();
    expect(summary).toHaveProperty(DataClassification.PUBLIC);
    expect(summary).toHaveProperty(DataClassification.INTERNAL);
    expect(summary).toHaveProperty(DataClassification.CONFIDENTIAL);
    expect(summary).toHaveProperty(DataClassification.RESTRICTED);
  });

  it('should have non-negative counts', () => {
    const summary = getClassificationSummary();
    expect(summary[DataClassification.PUBLIC]).toBeGreaterThanOrEqual(0);
    expect(summary[DataClassification.INTERNAL]).toBeGreaterThanOrEqual(0);
    expect(summary[DataClassification.CONFIDENTIAL]).toBeGreaterThanOrEqual(0);
    expect(summary[DataClassification.RESTRICTED]).toBeGreaterThanOrEqual(0);
  });

  it('should have total count equal to FIELD_CLASSIFICATIONS size', () => {
    const summary = getClassificationSummary();
    const total =
      summary[DataClassification.PUBLIC] +
      summary[DataClassification.INTERNAL] +
      summary[DataClassification.CONFIDENTIAL] +
      summary[DataClassification.RESTRICTED];
    expect(total).toBe(Object.keys(FIELD_CLASSIFICATIONS).length);
  });

  it('should have at least one RESTRICTED field', () => {
    const summary = getClassificationSummary();
    expect(summary[DataClassification.RESTRICTED]).toBeGreaterThan(0);
  });

  it('should have at least one PUBLIC field', () => {
    const summary = getClassificationSummary();
    expect(summary[DataClassification.PUBLIC]).toBeGreaterThan(0);
  });

  it('should have at least one INTERNAL field', () => {
    const summary = getClassificationSummary();
    expect(summary[DataClassification.INTERNAL]).toBeGreaterThan(0);
  });

  it('should have at least one CONFIDENTIAL field', () => {
    const summary = getClassificationSummary();
    expect(summary[DataClassification.CONFIDENTIAL]).toBeGreaterThan(0);
  });

  it('should return consistent results on multiple calls', () => {
    const s1 = getClassificationSummary();
    const s2 = getClassificationSummary();
    expect(s1).toEqual(s2);
  });
});
