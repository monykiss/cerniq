import { ComplianceReportService } from './compliance-report.service';

describe('ComplianceReportService', () => {
  let service: ComplianceReportService;
  const mockPrisma = {
    user: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  } as any;
  const mockSoc2Evidence = {
    collectEvidence: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceReportService(mockPrisma, mockSoc2Evidence);

    // Default mocks
    mockPrisma.user.count.mockResolvedValue(10);
    mockPrisma.user.groupBy.mockResolvedValue([
      { role: 'OWNER', _count: { role: 2 } },
      { role: 'MEMBER', _count: { role: 8 } },
    ]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);
    mockPrisma.auditLog.count.mockResolvedValue(100);
    mockPrisma.auditLog.groupBy.mockResolvedValue([
      { action: 'login', _count: { action: 50 } },
    ]);
    mockSoc2Evidence.collectEvidence.mockResolvedValue({
      summary: { total: 10, pass: 9, fail: 1 },
      controls: [],
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generateSOC2Evidence returns a complete report', async () => {
    const report = await service.generateSOC2Evidence();
    expect(report.reportId).toMatch(/^SOC2-/);
    expect(report.sections).toHaveProperty('accessControl');
    expect(report.sections).toHaveProperty('changeManagement');
    expect(report.sections).toHaveProperty('dataEncryption');
    expect(report.sections).toHaveProperty('auditTrail');
    expect(report.sections).toHaveProperty('availability');
    expect(report.sections).toHaveProperty('incidentResponse');
    expect(report.controlsPackage).toBeDefined();
  });

  it('report includes access control evidence with role breakdown', async () => {
    const report = await service.generateSOC2Evidence();
    const ac = report.sections.accessControl;
    expect(ac.totalUsers).toBe(10);
    expect(ac.roleBreakdown).toHaveProperty('OWNER');
    expect(ac.mfaStatus.enforced).toBe(true);
  });

  it('report includes availability evidence', async () => {
    const report = await service.generateSOC2Evidence();
    const avail = report.sections.availability;
    expect(avail.healthEndpoint).toBe('/health');
    expect(avail.autoRestart).toBe(true);
  });

  it('report includes data encryption evidence', async () => {
    const report = await service.generateSOC2Evidence();
    const enc = report.sections.dataEncryption;
    expect(enc.algorithm).toBe('AES-256-GCM');
  });

  it('report includes audit trail evidence', async () => {
    const report = await service.generateSOC2Evidence();
    const at = report.sections.auditTrail;
    expect(at.totalEntries).toBe(100);
    expect(at.distinctActions).toContain('login');
  });

  it('report has valid reporting period', async () => {
    const report = await service.generateSOC2Evidence();
    const start = new Date(report.reportingPeriod.start);
    const end = new Date(report.reportingPeriod.end);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it('report includes change management evidence', async () => {
    const report = await service.generateSOC2Evidence();
    const cm = report.sections.changeManagement;
    expect(cm.cicdEnforced).toBe(true);
    expect(cm.codeReviewRequired).toBe(true);
    expect(cm.branchProtection).toBeTruthy();
    expect(typeof cm.totalChangesLast90Days).toBe('number');
  });

  it('report includes incident response evidence', async () => {
    const report = await service.generateSOC2Evidence();
    const ir = report.sections.incidentResponse;
    expect(ir.playbook).toBeTruthy();
    expect(ir.escalationPath).toBeTruthy();
    expect(ir.recentIncidents).toEqual([]);
  });

  it('maps deployment logs to change management evidence', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      {
        action: 'deployment',
        userId: 'user-1',
        metadata: { commitSha: 'abc123', author: 'dev' },
        createdAt: new Date(),
      },
    ]);
    mockPrisma.auditLog.count.mockResolvedValue(5);

    const report = await service.generateSOC2Evidence();
    const cm = report.sections.changeManagement;
    expect(cm.recentDeployments.length).toBeGreaterThan(0);
    expect(cm.recentDeployments[0].commitSha).toBe('abc123');
    expect(cm.recentDeployments[0].action).toBe('deployment');
  });

  it('detects audit log gaps when present', async () => {
    const now = new Date();
    const logs = [
      { createdAt: new Date(now.getTime() - 86400000 * 5) },
      { createdAt: new Date(now.getTime() - 86400000 * 2) },
    ];
    mockPrisma.auditLog.findMany.mockResolvedValue(logs);

    const report = await service.generateSOC2Evidence();
    const at = report.sections.auditTrail;
    // Gap of 3 days > 24 hours
    expect(at.gapDetected).toBe(true);
    expect(at.gapDetails).toContain('Gap detected');
  });

  it('reports no gap when logs are within 24 hours of each other', async () => {
    const now = new Date();
    const logs = [
      { createdAt: new Date(now.getTime() - 3600000 * 4) },
      { createdAt: new Date(now.getTime() - 3600000 * 2) },
      { createdAt: now },
    ];
    mockPrisma.auditLog.findMany.mockResolvedValue(logs);

    const report = await service.generateSOC2Evidence();
    const at = report.sections.auditTrail;
    expect(at.gapDetected).toBe(false);
    expect(at.gapDetails).toBeNull();
  });

  it('handles insufficient logs for gap analysis', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ createdAt: new Date() }]);

    const report = await service.generateSOC2Evidence();
    const at = report.sections.auditTrail;
    expect(at.gapDetected).toBe(false);
    expect(at.gapDetails).toContain('Insufficient');
  });

  it('handles audit gap detection failure gracefully', async () => {
    // Make the findMany for gap detection throw
    let callCount = 0;
    mockPrisma.auditLog.findMany.mockImplementation(() => {
      callCount++;
      // First call is for change management, second is for gap detection
      if (callCount >= 2) throw new Error('Query timeout');
      return Promise.resolve([]);
    });

    const report = await service.generateSOC2Evidence();
    const at = report.sections.auditTrail;
    expect(at.gapDetected).toBe(false);
    expect(at.gapDetails).toContain('failed');
  });

  it('includes data encryption evidence with correct algorithm', async () => {
    const report = await service.generateSOC2Evidence();
    const enc = report.sections.dataEncryption;
    expect(enc.algorithm).toBe('AES-256-GCM');
    expect(typeof enc.encryptedFieldCount).toBe('number');
    expect(enc.classificationSummary).toBeDefined();
  });

  it('reports encryption key status from environment', async () => {
    const origKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'test-key-32chars-0000000000000';

    const report = await service.generateSOC2Evidence();
    expect(report.sections.dataEncryption.encryptionKeyConfigured).toBe(true);

    if (origKey) {
      process.env.DATA_ENCRYPTION_KEY = origKey;
    } else {
      delete process.env.DATA_ENCRYPTION_KEY;
    }
  });

  it('reports controls package summary from SOC2EvidenceService', async () => {
    const report = await service.generateSOC2Evidence();
    expect(report.controlsPackage.summary.total).toBe(10);
    expect(report.controlsPackage.summary.pass).toBe(9);
    expect(report.controlsPackage.summary.fail).toBe(1);
  });

  it('report ID includes date component', async () => {
    const report = await service.generateSOC2Evidence();
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(report.reportId).toContain(yearMonth);
  });
});
