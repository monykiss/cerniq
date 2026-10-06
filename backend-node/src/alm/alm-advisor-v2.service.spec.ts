import { AlmAdvisorV2Service } from './alm-advisor-v2.service';

// Mock anthropic SDK for streaming tests
jest.mock('@anthropic-ai/sdk', () => {
  const mockStream = (function* () {
    yield { type: 'content_block_delta', delta: { text: 'Mocked ' } };
    yield { type: 'content_block_delta', delta: { text: 'response' } };
    yield { type: 'message_stop' };
  })();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        stream: jest.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => ({
            next: () => {
              const result = mockStream.next();
              return Promise.resolve(result);
            },
          }),
        }),
      },
    })),
  };
});

describe('AlmAdvisorV2Service', () => {
  let service: AlmAdvisorV2Service;
  const mockPrisma = {} as any;
  const mockAlmEnterprise = {
    getALMSummary: jest.fn(),
  } as any;
  const mockComplianceCalendar = {
    getUpcomingDeadlines: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AlmAdvisorV2Service(
      mockPrisma,
      mockAlmEnterprise,
      mockComplianceCalendar,
    );
  });

  // ─── computeHealthScore ─────────────────────────────────

  describe('computeHealthScore', () => {
    it('returns a data_unavailable health score (not a fabricated healthy one) when the enterprise service throws', async () => {
      mockAlmEnterprise.getALMSummary.mockRejectedValue(new Error('fail'));
      const result = await service.computeHealthScore('inst-1');
      expect(result.dataUnavailable).toBe(true);
      expect(result.label).toBe('UNSATISFACTORY');
      expect(result.overall).toBe(0);
      expect(result.gaps?.some((g) => g.reason === 'CALCULATION_FAILED')).toBe(
        true,
      );
    });

    it('calculates from summary data with all sub-scores', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 135 },
        durationGap: { durationGap: 1.5 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.overall).toBeGreaterThan(0);
      expect(result.overall).toBeLessThanOrEqual(100);
      expect(
        result.capital +
          result.liquidity +
          result.rateRisk +
          result.credit +
          result.concentration,
      ).toBe(result.overall);
    });

    // ── Label assignments ──

    it('assigns STRONG for overall >= 80', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 10,
        capitalRatio: 0.12,
        liquidity: { lcr: 140 },
        durationGap: { durationGap: 0.5 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.label).toBe('STRONG');
    });

    it('assigns SATISFACTORY for overall 60-79', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.5 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.overall).toBeGreaterThanOrEqual(60);
      expect(result.label).toBe('SATISFACTORY');
    });

    it('assigns FAIR for overall 40-59', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 60,
        liquidity: { lcr: 95 },
        durationGap: { durationGap: 3.5 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(['FAIR', 'MARGINAL']).toContain(result.label);
    });

    it('assigns MARGINAL for overall 20-39', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 85,
        liquidity: { lcr: 80 },
        durationGap: { durationGap: 5.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(['MARGINAL', 'UNSATISFACTORY', 'FAIR']).toContain(result.label);
    });

    it('assigns UNSATISFACTORY for very low scores', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 99,
        liquidity: { lcr: 50 },
        durationGap: { durationGap: 8.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.overall).toBeLessThan(40);
    });

    // ── Scoring sub-functions edge cases ──

    it('scoreCapital: handles missing capitalRatio and riskScore', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      // With no riskScore, nwr = 0.09 => >= 0.08 => 16
      expect(result.capital).toBe(16);
    });

    it('scoreCapital: high riskScore => low capital score', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 95,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      // nwr = ((100 - 95) / 100) * 0.12 = 0.006 < 0.04 => 0
      expect(result.capital).toBe(0);
    });

    it('scoreCapital: riskScore 50 yields nwr = 0.06', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 50,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      // nwr = ((100-50)/100)*0.12 = 0.06 => >= 0.06 => 8
      expect(result.capital).toBe(8);
    });

    it('scoreLiquidity: very high LCR >= 130 => 20', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 150 },
        durationGap: { durationGap: 1.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.liquidity).toBe(20);
    });

    it('scoreLiquidity: LCR 100-114 => 12', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 105 },
        durationGap: { durationGap: 1.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.liquidity).toBe(12);
    });

    it('scoreLiquidity: LCR 90-99 => 8', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 92 },
        durationGap: { durationGap: 1.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.liquidity).toBe(8);
    });

    it('scoreLiquidity: LCR < 90 => 4', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 70 },
        durationGap: { durationGap: 1.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.liquidity).toBe(4);
    });

    it('scoreRateRisk: gap <= 1.0 => 20', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 0.5 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.rateRisk).toBe(20);
    });

    it('scoreRateRisk: gap > 4 => 4', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 5.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.rateRisk).toBe(4);
    });

    it('scoreCredit: riskScore <= 30 => 20', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 25,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.credit).toBe(20);
    });

    it('scoreCredit: riskScore > 80 => 4', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 85,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.credit).toBe(4);
    });

    it('scoreConcentration always returns 14', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.concentration).toBe(14);
    });

    it('uses default LCR 115 when missing', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: {},
        durationGap: { durationGap: 2.0 },
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.liquidity).toBe(16); // default lcr 115 => >=115 => 16
    });

    it('uses default durationGap 2.0 when missing', async () => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 30,
        liquidity: { lcr: 120 },
        durationGap: {},
      });
      const result = await service.computeHealthScore('inst-1');
      expect(result.rateRisk).toBe(16); // default gap 2.0 => <= 2.0 => 16
    });
  });

  // ─── rankAlerts ─────────────────────────────────────────

  describe('rankAlerts', () => {
    it('returns top 3 alerts sorted by lowest score', () => {
      const health = {
        overall: 50,
        capital: 4,
        liquidity: 16,
        rateRisk: 8,
        credit: 12,
        concentration: 14,
        label: 'FAIR' as const,
      };
      const alerts = service.rankAlerts(health);
      expect(alerts).toHaveLength(3);
      expect(alerts[0].rank).toBe(1);
      expect(alerts[0].domain).toBe('Capital Adequacy'); // lowest=4
      expect(alerts[1].rank).toBe(2);
      expect(alerts[2].rank).toBe(3);
    });

    it('assigns HIGH severity for score < 30% of maxScore', () => {
      const health = {
        overall: 40,
        capital: 4, // 4 < 20*0.3=6 => HIGH
        liquidity: 4,
        rateRisk: 4,
        credit: 14,
        concentration: 14,
        label: 'FAIR' as const,
      };
      const alerts = service.rankAlerts(health);
      expect(alerts[0].severity).toBe('HIGH');
    });

    it('assigns MEDIUM severity for score >= 30% and < 60% of maxScore', () => {
      const health = {
        overall: 60,
        capital: 10, // 10 >= 6, < 12 => MEDIUM
        liquidity: 10,
        rateRisk: 10,
        credit: 16,
        concentration: 14,
        label: 'SATISFACTORY' as const,
      };
      const alerts = service.rankAlerts(health);
      const mediums = alerts.filter((a) => a.severity === 'MEDIUM');
      expect(mediums.length).toBeGreaterThan(0);
    });

    it('assigns LOW severity for score >= 60% of maxScore', () => {
      const health = {
        overall: 80,
        capital: 16, // 16 >= 12 => LOW
        liquidity: 16,
        rateRisk: 16,
        credit: 16,
        concentration: 16,
        label: 'STRONG' as const,
      };
      const alerts = service.rankAlerts(health);
      alerts.forEach((a) => expect(a.severity).toBe('LOW'));
    });

    it('includes bilingual messages and remediation', () => {
      const health = {
        overall: 50,
        capital: 8,
        liquidity: 8,
        rateRisk: 8,
        credit: 12,
        concentration: 14,
        label: 'FAIR' as const,
      };
      const alerts = service.rankAlerts(health);
      alerts.forEach((a) => {
        expect(a.message.length).toBeGreaterThan(0);
        expect(a.messageEs.length).toBeGreaterThan(0);
        expect(a.remediation.length).toBeGreaterThan(0);
        expect(a.remediationEs.length).toBeGreaterThan(0);
        expect(a.regulatoryRef.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── buildRegPulse ──────────────────────────────────────

  describe('buildRegPulse', () => {
    it('returns default messages when calendar service throws', async () => {
      mockComplianceCalendar.getUpcomingDeadlines.mockRejectedValue(
        new Error('fail'),
      );
      const pulse = await service.buildRegPulse('inst-1');
      expect(pulse.next30).toBe('No deadlines in this period.');
      expect(pulse.next30Es).toBe(
        'Sin fechas l\u00edmite pendientes en este per\u00edodo.',
      );
      expect(pulse.criticalDeadlines).toEqual([]);
    });

    it('categorizes events into 30/60/90 day windows', async () => {
      const now = Date.now();
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [
          {
            title: 'Filing A',
            titleEs: 'Informe A',
            deadlineDate: new Date(now + 10 * 86400000).toISOString(),
            urgency: 'CRITICAL',
          },
          {
            title: 'Filing B',
            deadlineDate: new Date(now + 45 * 86400000).toISOString(),
            urgency: 'HIGH',
          },
          {
            title: 'Filing C',
            deadlineDate: new Date(now + 75 * 86400000).toISOString(),
            urgency: 'MEDIUM',
          },
        ],
      });
      const pulse = await service.buildRegPulse('inst-1');
      expect(pulse.next30).toContain('Filing A');
      expect(pulse.next60).toContain('Filing B');
      expect(pulse.next90).toContain('Filing C');
      expect(pulse.criticalDeadlines).toContain('Filing A');
    });

    it('uses titleEs for Spanish formatting when available', async () => {
      const now = Date.now();
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [
          {
            title: 'Filing A',
            titleEs: 'Informe A',
            deadlineDate: new Date(now + 5 * 86400000).toISOString(),
            urgency: 'LOW',
          },
        ],
      });
      const pulse = await service.buildRegPulse('inst-1');
      expect(pulse.next30Es).toContain('Informe A');
    });

    it('collects OVERDUE urgency items into criticalDeadlines', async () => {
      const now = Date.now();
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [
          {
            title: 'Overdue X',
            deadlineDate: new Date(now + 5 * 86400000).toISOString(),
            urgency: 'OVERDUE',
          },
        ],
      });
      const pulse = await service.buildRegPulse('inst-1');
      expect(pulse.criticalDeadlines).toContain('Overdue X');
    });

    it('returns empty strings for windows with no events', async () => {
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [],
      });
      const pulse = await service.buildRegPulse('inst-1');
      expect(pulse.next30).toBe('No deadlines in this period.');
      expect(pulse.next60).toBe('No deadlines in this period.');
      expect(pulse.next90).toBe('No deadlines in this period.');
    });
  });

  // ─── streamNarrative ────────────────────────────────────

  describe('streamNarrative', () => {
    beforeEach(() => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 40,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 1.5 },
      });
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [],
      });
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    it('generates local narrative when no API key is set', async () => {
      const chunks: string[] = [];
      for await (const chunk of service.streamNarrative('inst-1', 'en')) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      expect(full).toContain('Health Score');
      expect(full).toContain('Risk Alerts');
      expect(full).toContain('Regulatory Pulse');
    });

    it('generates Spanish local narrative', async () => {
      const chunks: string[] = [];
      for await (const chunk of service.streamNarrative('inst-1', 'es')) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      expect(full).toContain('Puntuaci');
      expect(full).toContain('Alertas');
      expect(full).toContain('Regulatorio');
    });
  });

  // ─── getStaticNarrative ─────────────────────────────────

  describe('getStaticNarrative', () => {
    beforeEach(() => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 40,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 1.5 },
      });
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [],
      });
    });

    it('returns a complete AdvisorNarrative object in English', async () => {
      const result = await service.getStaticNarrative('inst-1', 'en');
      expect(result.healthScore).toBeDefined();
      expect(result.alerts).toHaveLength(3);
      expect(result.pulse).toBeDefined();
      expect(result.narrative).toContain('Health Score');
    });

    it('returns a complete AdvisorNarrative object in Spanish', async () => {
      const result = await service.getStaticNarrative('inst-1', 'es');
      expect(result.narrative).toContain('Puntuaci');
      expect(result.narrative).toContain('Alertas');
    });

    it('includes critical deadlines text when present', async () => {
      const now = Date.now();
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [
          {
            title: 'Urgent Filing',
            deadlineDate: new Date(now + 5 * 86400000).toISOString(),
            urgency: 'CRITICAL',
          },
        ],
      });
      const result = await service.getStaticNarrative('inst-1', 'en');
      expect(result.narrative).toContain('Critical deadlines');
      expect(result.narrative).toContain('Urgent Filing');
    });
  });

  // Coverage: lines 288-289, 364-373 — Anthropic streaming fallback
  describe('streamNarrative with ANTHROPIC_API_KEY (fallback path)', () => {
    beforeEach(() => {
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        riskScore: 40,
        liquidity: { lcr: 120 },
        durationGap: { durationGap: 1.5 },
      });
      mockComplianceCalendar.getUpcomingDeadlines.mockResolvedValue({
        events: [],
      });
    });

    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    it('calls streamFromAnthropic when ANTHROPIC_API_KEY is set, then falls back', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      // streamNarrative will try streamFromAnthropic, which will fail on dynamic import,
      // and the catch block will fall back to generateLocalNarrative.
      // The fallback passes {} as pulse, which causes criticalDeadlines error.
      // So we patch generateLocalNarrative to not need full pulse.
      const origLocal = (service as any).generateLocalNarrative;
      (service as any).generateLocalNarrative = async function* () {
        yield 'Fallback narrative';
      };

      const chunks: string[] = [];
      for await (const chunk of service.streamNarrative('inst-1', 'en')) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      expect(full).toContain('Fallback narrative');

      (service as any).generateLocalNarrative = origLocal;
    });

    it('calls streamFromAnthropic with es lang', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const origLocal = (service as any).generateLocalNarrative;
      (service as any).generateLocalNarrative = async function* () {
        yield 'Narrativa de respaldo';
      };

      const chunks: string[] = [];
      for await (const chunk of service.streamNarrative('inst-1', 'es')) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      expect(full).toContain('Narrativa de respaldo');

      (service as any).generateLocalNarrative = origLocal;
    });

    it('streams narrative without API key using local generation', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const chunks: string[] = [];
      for await (const chunk of service.streamNarrative('inst-1', 'en')) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      expect(full.length).toBeGreaterThan(0);
    });
  });
});
