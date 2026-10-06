import {
  CAMELCertificationService,
  COSSEC_RATIOS,
  getComplianceBadge,
  narrativeEs,
  narrativeEn,
  parsePeriod,
} from './camel-certification.service';
import { CAMELResult } from './camel-scorer.service';

describe('CAMELCertificationService', () => {
  let service: CAMELCertificationService;

  // ── Mocks ──────────────────────────────────────────────────────

  const mockInstitution = {
    id: 'inst-test',
    name: 'Cooperativa Test',
    cossecRegistrationNumber: 'COSSEC-1234',
    primaryRegulator: 'COSSEC',
    type: 'cooperativa',
    currency: 'USD',
    reportingDate: new Date('2026-03-31'),
  };

  const mockCAMELResult: CAMELResult = {
    components: [
      {
        component: 'Capital',
        componentEs: 'Capital',
        score: 2,
        rating: 'Satisfactory',
        ratingEs: 'Satisfactorio',
        detail: 'NWR 9.0% — Adequately capitalized above 7%.',
        detailEs: 'NWR 9.0% — Adecuadamente capitalizada sobre 7%.',
      },
      {
        component: 'Asset Quality',
        componentEs: 'Calidad de Activos',
        score: 2,
        rating: 'Satisfactory',
        ratingEs: 'Satisfactorio',
        detail: 'NPL: 1.80%, Classified: 3.00%.',
        detailEs: 'NPL: 1.80%, Clasificados: 3.00%.',
      },
      {
        component: 'Management',
        componentEs: 'Administración',
        score: 2,
        rating: 'Satisfactory',
        ratingEs: 'Satisfactorio',
        detail: 'Governance checklist: 18/24 items complete.',
        detailEs: 'Lista de gobernanza: 18/24 ítems completos.',
      },
      {
        component: 'Earnings',
        componentEs: 'Rentabilidad',
        score: 2,
        rating: 'Satisfactory',
        ratingEs: 'Satisfactorio',
        detail: 'ROA: 0.80%, Expense ratio: 78.0%.',
        detailEs: 'ROA: 0.80%, Ratio de gastos: 78.0%.',
      },
      {
        component: 'Liquidity',
        componentEs: 'Liquidez',
        score: 2,
        rating: 'Satisfactory',
        ratingEs: 'Satisfactorio',
        detail: 'LCR: 115%, NSFR: 108%, Days of liquidity: 45.',
        detailEs: 'LCR: 115%, NSFR: 108%, Días de liquidez: 45.',
      },
    ],
    composite: 2,
    compositeRating: 'Satisfactory',
    compositeRatingEs: 'Satisfactorio',
    examReadiness: 'READY',
  };

  const mockComplianceResult = {
    ratios: [
      { id: 1, value: 9.0 },
      { id: 2, value: 0 },
      { id: 9, value: 115 },
      { id: 12, value: 3.2 },
    ],
    summary: {
      totalAssets: 445,
      totalLiabilities: 385,
      equity: 60,
      totalLoans: 200,
      totalShares: 300,
      liquidAssets: 80,
      capitalRatio: 13.5,
      loanToShareRatio: 66.7,
      liquidityRatio: 18.0,
      earningAssets: 400,
      interestIncome: 20,
      interestExpense: 8,
      nim: 3.2,
    },
  };

  const mockSummaryResult = {
    riskScore: 72,
    durationGap: { durationGap: 1.5, riskProfile: 'asset-sensitive' },
    niiSensitivity: {
      baseNII: 12,
      riskRating: 'moderate',
      scenarios: [
        { shiftBps: 200, niImpactPct: 8.5, mveImpactPct: 5 },
        { shiftBps: -200, niImpactPct: -7.2, mveImpactPct: -4 },
      ],
    },
  };

  const mockPrisma = {
    institution: {
      findUnique: jest.fn().mockResolvedValue(mockInstitution),
    },
    balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    camelCertification: {
      upsert: jest.fn().mockResolvedValue({ id: 'cert-mock-id' }),
    },
  } as any;

  const mockCamelScorer = {
    scoreInstitution: jest.fn().mockResolvedValue(mockCAMELResult),
  } as any;

  const mockAlmEnterprise = {
    getALMSummary: jest.fn().mockResolvedValue(mockSummaryResult),
    getRegulatoryCompliance: jest.fn().mockResolvedValue(mockComplianceResult),
  } as any;

  const mockAudit = {
    log: jest.fn(),
  } as any;

  beforeEach(() => {
    service = new CAMELCertificationService(
      mockPrisma,
      mockCamelScorer,
      mockAlmEnterprise,
      mockAudit,
    );
    jest.clearAllMocks();
    mockPrisma.institution.findUnique.mockResolvedValue(mockInstitution);
    mockCamelScorer.scoreInstitution.mockResolvedValue(mockCAMELResult);
    mockAlmEnterprise.getALMSummary.mockResolvedValue(mockSummaryResult);
    mockAlmEnterprise.getRegulatoryCompliance.mockResolvedValue(
      mockComplianceResult,
    );
  });

  // ── Basic generation ────────────────────────────────────────────

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should generate certification HTML and hash', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toBeTruthy();
    expect(result.hash).toBeTruthy();
    expect(result.hash.length).toBe(64); // SHA-256 hex length
  });

  // ── All 12 ratio names in Spanish ──────────────────────────────

  it('should contain all 12 COSSEC ratio names in Spanish', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );

    const expectedNames = [
      'Razón de Capital Neto (NWR)',
      'Razón de Cobertura de Liquidez (LCR)',
      'Margen de Interés Neto (NIM)',
      'Razón de Préstamos No Corrientes (NCR)',
      'Razón de Cobertura de Provisiones',
      'Rendimiento sobre Activos (ROA)',
      'Rendimiento sobre Capital (ROE)',
      'Razón de Eficiencia Operativa',
      'Razón de Concentración de Préstamos',
      'Brecha de Duración',
      'Sensibilidad NII (±200bps)',
      'Razón Préstamos/Depósitos',
    ];

    for (const name of expectedNames) {
      expect(result.html).toContain(name);
    }
  });

  it('should contain all 12 COSSEC ratio names in English', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'en',
    );

    const expectedNames = [
      'Net Worth Ratio (NWR)',
      'Liquidity Coverage Ratio (LCR)',
      'Net Interest Margin (NIM)',
      'Non-Current Loan Ratio (NCR)',
      'Provision Coverage Ratio',
      'Return on Assets (ROA)',
      'Return on Equity (ROE)',
      'Operating Efficiency Ratio',
      'Loan Concentration Ratio',
      'Duration Gap',
      'NII Sensitivity (±200bps)',
      'Loan-to-Deposit Ratio',
    ];

    for (const name of expectedNames) {
      expect(result.html).toContain(name);
    }
  });

  // ── CUMPLE/ALERTA/INCUMPLE badge rendering ─────────────────────

  it('should render CUMPLE badge for passing ratios', () => {
    const nwrDef = COSSEC_RATIOS[0]; // NWR, threshold >= 6%
    const result = getComplianceBadge(9.0, nwrDef);
    expect(result.badge).toBe('CUMPLE');
    expect(result.badgeEn).toBe('PASS');
    expect(result.color).toBe('#16a34a');
  });

  it('should render ALERTA badge for warning-level ratios', () => {
    const nwrDef = COSSEC_RATIOS[0]; // NWR, threshold >= 6%
    // 85% of 6 = 5.1 — value between 5.1 and 6 is ALERTA
    const result = getComplianceBadge(5.5, nwrDef);
    expect(result.badge).toBe('ALERTA');
    expect(result.badgeEn).toBe('WARNING');
    expect(result.color).toBe('#d97706');
  });

  it('should render INCUMPLE badge for failing ratios', () => {
    const nwrDef = COSSEC_RATIOS[0]; // NWR, threshold >= 6%
    const result = getComplianceBadge(3.0, nwrDef);
    expect(result.badge).toBe('INCUMPLE');
    expect(result.badgeEn).toBe('FAIL');
    expect(result.color).toBe('#dc2626');
  });

  it('should handle lte threshold direction correctly', () => {
    const effDef = COSSEC_RATIOS[7]; // Efficiency, threshold < 85%
    expect(getComplianceBadge(75, effDef).badge).toBe('CUMPLE');
    expect(getComplianceBadge(92, effDef).badge).toBe('ALERTA');
    expect(getComplianceBadge(120, effDef).badge).toBe('INCUMPLE');
  });

  it('should handle range threshold direction correctly', () => {
    const durationDef = COSSEC_RATIOS[9]; // Duration gap, -1 to +3
    expect(getComplianceBadge(1.0, durationDef).badge).toBe('CUMPLE');
    expect(getComplianceBadge(-1.5, durationDef).badge).toBe('ALERTA');
    expect(getComplianceBadge(6.0, durationDef).badge).toBe('INCUMPLE');
  });

  // ── Badges render in HTML ──────────────────────────────────────

  it('should contain CUMPLE/ALERTA/INCUMPLE badges in Spanish HTML', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    // At minimum CUMPLE should appear (most ratios should pass with mock data)
    expect(result.html).toMatch(/CUMPLE|ALERTA|INCUMPLE/);
  });

  it('should contain PASS/WARNING/FAIL badges in English HTML', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'en',
    );
    expect(result.html).toMatch(/PASS|WARNING|FAIL/);
  });

  // ── Verification hash determinism ──────────────────────────────

  it('should produce deterministic hash for same input', async () => {
    const result1 = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    const result2 = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result1.hash).toBe(result2.hash);
  });

  it('should produce different hash for different periods', async () => {
    const result1 = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    const result2 = await service.generateCertification(
      'inst-test',
      '2026-Q2',
      'es',
    );
    expect(result1.hash).not.toBe(result2.hash);
  });

  // ── Signature block ────────────────────────────────────────────

  it('should contain signature block in Spanish', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('Certificado por');
    expect(result.html).toContain('Cargo');
    expect(result.html).toContain('Fecha');
  });

  it('should contain signature block in English', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'en',
    );
    expect(result.html).toContain('Certified by');
    expect(result.html).toContain('Title');
    expect(result.html).toContain('Date');
  });

  // ── Bilingual support ──────────────────────────────────────────

  it('should render Spanish content when lang=es', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('AUTOEVALUACI');
    expect(result.html).toContain('Tabla de 12 Razones COSSEC');
    expect(result.html).toContain('Puntaje Compuesto CAMEL');
    expect(result.html).toContain('Bloque de Certificaci');
    expect(result.html).toContain('lang="es"');
  });

  it('should render English content when lang=en', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'en',
    );
    expect(result.html).toContain('CAMEL SELF-ASSESSMENT');
    expect(result.html).toContain('COSSEC 12-Ratio Table');
    expect(result.html).toContain('CAMEL Composite Score');
    expect(result.html).toContain('Certification Block');
    expect(result.html).toContain('lang="en"');
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it('should throw NotFoundException for missing institution', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    await expect(
      service.generateCertification('missing-id', '2026-Q1', 'es'),
    ).rejects.toThrow('not found');
  });

  it('should handle zero values gracefully', async () => {
    mockAlmEnterprise.getRegulatoryCompliance.mockResolvedValue({
      ratios: [],
      summary: {
        totalAssets: 0,
        totalLiabilities: 0,
        equity: 0,
        totalLoans: 0,
        totalShares: 0,
        liquidAssets: 0,
        nim: 0,
      },
    });
    mockAlmEnterprise.getALMSummary.mockResolvedValue({
      riskScore: null,
      durationGap: { durationGap: 0, riskProfile: 'neutral' },
      niiSensitivity: { baseNII: 0, riskRating: 'low', scenarios: [] },
    });

    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toBeTruthy();
    expect(result.hash).toBeTruthy();
    // Should still contain all 12 ratios
    expect(result.html).toContain('Razón de Capital Neto');
    expect(result.html).toContain('Razón Préstamos/Depósitos');
  });

  it('should handle failed ALM summary gracefully', async () => {
    mockAlmEnterprise.getALMSummary.mockRejectedValue(
      new Error('ALM computation failed'),
    );

    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toBeTruthy();
    // Duration and NII fields will use defaults
  });

  it('should handle failed compliance data gracefully', async () => {
    mockAlmEnterprise.getRegulatoryCompliance.mockRejectedValue(
      new Error('Compliance failed'),
    );

    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toBeTruthy();
  });

  // ── Institution metadata in HTML ───────────────────────────────

  it('should include institution name and COSSEC number', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('Cooperativa Test');
    expect(result.html).toContain('COSSEC-1234');
  });

  it('should handle missing COSSEC registration number', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue({
      ...mockInstitution,
      cossecRegistrationNumber: null,
    });
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('N/A');
  });

  // ── Verification hash in footer ────────────────────────────────

  it('should display verification hash in footer', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('Hash de verificación CERNIQ');
    expect(result.html).toContain(result.hash);
  });

  // ── Footer disclaimer ──────────────────────────────────────────

  it('should include CERNIQ footer disclaimer in Spanish', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('Generado por CERNIQ');
    expect(result.html).toContain('cerniq.io');
    expect(result.html).toContain('datos proporcionados por la institución');
  });

  it('should include CERNIQ footer disclaimer in English', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'en',
    );
    expect(result.html).toContain('Generated by CERNIQ');
    expect(result.html).toContain('cerniq.io');
    expect(result.html).toContain('data provided by the institution');
  });

  // ── CAMEL composite in HTML ────────────────────────────────────

  it('should display CAMEL composite score and all 5 components', async () => {
    const result = await service.generateCertification(
      'inst-test',
      '2026-Q1',
      'es',
    );
    expect(result.html).toContain('Capital');
    expect(result.html).toContain('Calidad de Activos');
    expect(result.html).toContain('Administración');
    expect(result.html).toContain('Rentabilidad');
    expect(result.html).toContain('Liquidez');
    // Composite score display
    expect(result.html).toContain('Puntaje Compuesto');
  });

  // ── Certify method ─────────────────────────────────────────────

  it('should persist certification and log audit', async () => {
    const result = await service.certify(
      'inst-test',
      '2026-Q1',
      { certifiedBy: 'Juan Rodriguez', title: 'CEO' },
      'user-123',
    );
    expect(result.certificationId).toBe('cert-mock-id');
    expect(result.hash).toBeTruthy();
    expect(result.certifiedAt).toBeTruthy();
    expect(result.composite).toBeGreaterThanOrEqual(1);
    expect(result.composite).toBeLessThanOrEqual(5);
    // Persisted via upsert
    expect(mockPrisma.camelCertification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          institution_period_cert: {
            institutionId: 'inst-test',
            period: '2026-Q1',
          },
        },
        create: expect.objectContaining({
          institutionId: 'inst-test',
          period: '2026-Q1',
          certifiedBy: 'Juan Rodriguez',
          title: 'CEO',
        }),
      }),
    );
    // Audit logged
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CAMEL_CERTIFICATION',
        resource: 'camel_certification',
        resourceId: 'cert-mock-id',
        userId: 'user-123',
        institutionId: 'inst-test',
      }),
    );
  });

  // ── Narrative generators ───────────────────────────────────────

  it('should generate Spanish narrative for passing gte ratio', () => {
    const def = COSSEC_RATIOS[0]; // NWR >= 6%
    const text = narrativeEs(def, 9.0, 'CUMPLE');
    expect(text).toContain('Razón de Capital Neto');
    expect(text).toContain('9.00%');
    expect(text).toContain('cumple con');
  });

  it('should generate English narrative for failing lte ratio', () => {
    const def = COSSEC_RATIOS[7]; // Efficiency < 85%
    const text = narrativeEn(def, 92.0, 'FAIL');
    expect(text).toContain('Operating Efficiency');
    expect(text).toContain('92.00%');
    expect(text).toContain('exceeds');
  });

  it('should generate narrative for range-type ratio', () => {
    const def = COSSEC_RATIOS[9]; // Duration gap -1 to +3
    const textIn = narrativeEs(def, 1.5, 'CUMPLE');
    expect(textIn).toContain('dentro del');
    const textOut = narrativeEs(def, 5.0, 'INCUMPLE');
    expect(textOut).toContain('fuera del');
  });

  // ── Period parser ──────────────────────────────────────────────

  it('should parse period format "2026-Q1"', () => {
    const result = parsePeriod('2026-Q1');
    expect(result.quarter).toBe('Q1');
    expect(result.year).toBe('2026');
  });

  it('should parse period format "Q2-2026"', () => {
    const result = parsePeriod('Q2-2026');
    expect(result.quarter).toBe('Q2');
    expect(result.year).toBe('2026');
  });

  it('should handle unexpected period format gracefully', () => {
    const result = parsePeriod('March2026');
    // Falls back to returning the raw string
    expect(result.quarter).toBe('March2026');
  });

  // ── 12 ratio definitions ───────────────────────────────────────

  it('should define exactly 12 COSSEC ratios', () => {
    expect(COSSEC_RATIOS.length).toBe(12);
  });

  it('should have unique IDs for all 12 ratios', () => {
    const ids = COSSEC_RATIOS.map((r) => r.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('should have bilingual names for all ratios', () => {
    for (const ratio of COSSEC_RATIOS) {
      expect(ratio.nameEs).toBeTruthy();
      expect(ratio.nameEn).toBeTruthy();
      expect(ratio.formulaEs).toBeTruthy();
      expect(ratio.formulaEn).toBeTruthy();
    }
  });
});
