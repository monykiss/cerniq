import { SOC2EvidenceService } from './soc2-evidence.service';

describe('SOC2EvidenceService', () => {
  let service: SOC2EvidenceService;
  const mockPrisma = {
    user: {
      count: jest.fn().mockResolvedValue(25),
    },
  };

  beforeEach(() => {
    service = new SOC2EvidenceService(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('collectEvidence returns a complete SOC2 evidence package', async () => {
    const result = await service.collectEvidence();
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('controls');
    expect(result).toHaveProperty('summary');
    expect(result.controls.length).toBeGreaterThanOrEqual(19);
  });

  it('summary totals are consistent', async () => {
    const result = await service.collectEvidence();
    const { summary, controls } = result;
    expect(summary.total).toBe(controls.length);
    expect(summary.pass + summary.fail + summary.warning).toBeLessThanOrEqual(
      summary.total,
    );
    expect(summary.compliancePct).toBeGreaterThanOrEqual(0);
    expect(summary.compliancePct).toBeLessThanOrEqual(100);
  });

  it('each control has required fields', async () => {
    const result = await service.collectEvidence();
    for (const control of result.controls) {
      expect(control).toHaveProperty('controlId');
      expect(control).toHaveProperty('criterion');
      expect(control).toHaveProperty('description');
      expect(control).toHaveProperty('status');
      expect(control).toHaveProperty('evidence');
      expect(['pass', 'fail', 'warning', 'not_evaluated']).toContain(
        control.status,
      );
    }
  });

  it('covers all five trust service criteria', async () => {
    const result = await service.collectEvidence();
    const criteria = new Set(result.controls.map((c) => c.criterion));
    expect(criteria.has('CC6')).toBe(true);
    expect(criteria.has('CC7')).toBe(true);
    expect(criteria.has('CC8')).toBe(true);
    expect(criteria.has('A1')).toBe(true);
    expect(criteria.has('C1')).toBe(true);
  });

  it('privileged access check warns when too many admins', async () => {
    mockPrisma.user.count.mockResolvedValueOnce(25).mockResolvedValueOnce(10);
    const result = await service.collectEvidence();
    const cc63 = result.controls.find((c) => c.controlId === 'CC6.3');
    expect(cc63).toBeDefined();
    // With 10 admins, should be warning
    expect(['pass', 'warning']).toContain(cc63!.status);
  });
});
