import OpenAI from 'openai';
import { AlmAdvisorService } from './alm-advisor.service';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

describe('AlmAdvisorService', () => {
  let service: AlmAdvisorService;
  const mockPrisma = { auditLog: { create: jest.fn() } } as any;
  const mockAlmEnterprise = {
    getCOSSECCompliance: jest.fn(),
    getALMSummary: jest.fn(),
  } as any;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
    service = new AlmAdvisorService(mockPrisma, mockAlmEnterprise);
  });

  // ─── Constructor ────────────────────────────────────────

  it('creates service without ANTHROPIC_API_KEY', () => {
    expect(service).toBeDefined();
    expect((service as any).anthropic).toBeUndefined();
  });

  it('creates service with ANTHROPIC_API_KEY set (SDK may or may not load)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const svc2 = new AlmAdvisorService(mockPrisma, mockAlmEnterprise);
    expect(svc2).toBeDefined();
    // SDK may load or fail depending on environment - either way service is defined
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('creates service with OPENAI_API_KEY set when Anthropic is absent', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    const svc2 = new AlmAdvisorService(mockPrisma, mockAlmEnterprise);
    expect(svc2).toBeDefined();
    expect((svc2 as any).openai).toBeDefined();
    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-test-key' });
    delete process.env.OPENAI_API_KEY;
  });

  // ─── ask: no SDK ────────────────────────────────────────

  describe('ask — no SDK available', () => {
    it('returns unavailable message in Spanish', async () => {
      const result = await service.ask('inst-1', 'Hola', [], 'es');
      expect(result.response).toContain('no esta disponible');
      expect(result.response).toContain('OPENAI_API_KEY');
      expect(result.tokensUsed).toBe(0);
    });

    it('returns unavailable message in English', async () => {
      const result = await service.ask('inst-1', 'Hello', [], 'en');
      expect(result.response).toContain('not available');
      expect(result.response).toContain('OPENAI_API_KEY');
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ─── ask: daily limit ──────────────────────────────────

  describe('ask — daily limit reached', () => {
    beforeEach(() => {
      (service as any).anthropic = { messages: { create: jest.fn() } };
      const dayKey = `inst-1:${new Date().toISOString().slice(0, 10)}`;
      (service as any).dailyCounts.set(dayKey, 20);
    });

    it('returns daily limit message in English', async () => {
      const result = await service.ask('inst-1', 'Test', [], 'en');
      expect(result.response).toContain('daily limit');
      expect(result.tokensUsed).toBe(0);
    });

    it('returns daily limit message in Spanish', async () => {
      const result = await service.ask('inst-1', 'Prueba', [], 'es');
      expect(result.response).toContain('limite diario');
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ─── ask: successful API call ───────────────────────────

  describe('ask — successful API call', () => {
    let createMock: jest.Mock;

    beforeEach(() => {
      createMock = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Duration gap is 1.5yr.' }],
        usage: { input_tokens: 500, output_tokens: 100 },
      });
      (service as any).anthropic = { messages: { create: createMock } };
    });

    it('returns AI response with token count', async () => {
      const result = await service.ask('inst-1', 'What is my risk?', [], 'en');
      expect(result.response).toContain('Duration gap');
      expect(result.tokensUsed).toBe(600);
    });

    it('increments daily counter after successful call', async () => {
      await service.ask('inst-1', 'Test', [], 'en');
      const dayKey = `inst-1:${new Date().toISOString().slice(0, 10)}`;
      expect((service as any).dailyCounts.get(dayKey)).toBe(1);
    });

    it('passes conversation history to the API', async () => {
      await service.ask(
        'inst-1',
        'Follow-up',
        [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
        ],
        'en',
      );
      const callArgs = createMock.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.messages[0].content).toBe('First question');
      expect(callArgs.messages[2].content).toBe('Follow-up');
    });

    it('handles response with non-text content type', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'image', url: 'http://...' }],
        usage: { input_tokens: 10, output_tokens: 0 },
      });
      const result = await service.ask('inst-1', 'Test', [], 'en');
      expect(result.response).toBe('No response generated.');
    });

    it('handles missing usage gracefully', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'OK' }],
        usage: {},
      });
      const result = await service.ask('inst-1', 'Test', [], 'en');
      expect(result.tokensUsed).toBe(0);
    });

    it('calls persistQuery after success (best-effort)', async () => {
      await service.ask('inst-1', 'Test', [], 'en');
      // persistQuery is fire-and-forget; just verify no error propagates
    });
  });

  // ─── ask: API error ─────────────────────────────────────

  describe('ask — API error', () => {
    beforeEach(() => {
      (service as any).anthropic = {
        messages: {
          create: jest.fn().mockRejectedValue(new Error('API timeout')),
        },
      };
    });

    it('returns error message in English', async () => {
      const result = await service.ask('inst-1', 'Test', [], 'en');
      expect(result.response).toContain('error occurred');
      expect(result.tokensUsed).toBe(0);
    });

    it('returns error message in Spanish', async () => {
      const result = await service.ask('inst-1', 'Consulta', [], 'es');
      expect(result.response).toContain('error al procesar');
      expect(result.tokensUsed).toBe(0);
    });

    it('does not increment daily counter on failure', async () => {
      await service.ask('inst-1', 'Test', [], 'en');
      const dayKey = `inst-1:${new Date().toISOString().slice(0, 10)}`;
      expect((service as any).dailyCounts.get(dayKey)).toBeUndefined();
    });
  });

  describe('ask — OpenAI fallback', () => {
    let createMock: jest.Mock;

    beforeEach(() => {
      createMock = jest.fn().mockResolvedValue({
        choices: [
          { message: { content: 'Liquidity buffer is 15% above minimum.' } },
        ],
        usage: { prompt_tokens: 320, completion_tokens: 80 },
      });
      (service as any).anthropic = null;
      (service as any).openai = {
        chat: {
          completions: {
            create: createMock,
          },
        },
      };
    });

    it('returns OpenAI response with token count', async () => {
      const result = await service.ask('inst-1', 'How is liquidity?', [], 'en');
      expect(result.response).toContain('Liquidity buffer');
      expect(result.tokensUsed).toBe(400);
    });

    it('sends the system prompt and history to OpenAI', async () => {
      await service.ask(
        'inst-1',
        'Follow-up question',
        [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
        ],
        'en',
      );

      const callArgs = createMock.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[1].content).toBe('First question');
      expect(callArgs.messages[3].content).toBe('Follow-up question');
    });

    it('handles OpenAI errors gracefully', async () => {
      createMock.mockRejectedValueOnce(new Error('OpenAI timeout'));
      const result = await service.ask('inst-1', 'Test', [], 'en');
      expect(result.response).toContain('error occurred');
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ─── buildSystemPrompt ──────────────────────────────────

  describe('buildSystemPrompt', () => {
    it('returns fallback ES prompt when data loading fails', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockRejectedValue(new Error('DB'));
      mockAlmEnterprise.getALMSummary.mockRejectedValue(new Error('DB'));
      const prompt = await service.buildSystemPrompt('inst-1', 'es');
      expect(prompt).toContain('Asesor de Riesgo IA');
      expect(prompt).toContain('No se pudieron cargar');
    });

    it('returns fallback EN prompt when data loading fails', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockRejectedValue(new Error('DB'));
      mockAlmEnterprise.getALMSummary.mockRejectedValue(new Error('DB'));
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('AI Risk Advisor');
      expect(prompt).toContain('could not be loaded');
    });

    it('returns fallback when one service returns null', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(null);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({ institution: {} });
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('could not be loaded');
    });

    const fullCossec = {
      examReadinessScore: 85,
      overallStatus: 'GOOD',
      summary: {
        totalAssets: 500,
        nim: 3.5,
        capitalRatio: 10.2,
        loanToShareRatio: 65,
        liquidityRatio: 22,
        earningAssetsYield: 4.5,
        costOfFunds: 1.2,
        largestSectorName: 'Real Estate',
        largestSectorPct: 35,
      },
      ratios: [
        {
          name: 'Capital',
          nameEs: 'Capital',
          value: 10.2,
          unit: '%',
          status: 'pass',
        },
        {
          name: 'Liquidity',
          nameEs: 'Liquidez',
          value: 22,
          unit: '%',
          status: 'info',
        },
      ],
    };

    const fullSummary = {
      institution: { name: 'Test CU', type: 'credit_union' },
      durationGap: {
        durationGap: 1.5,
        assetDuration: 3.2,
        liabilityDuration: 1.7,
        riskProfile: 'moderate',
      },
      niiSensitivity: { baseNII: 12.5, riskRating: 'moderate' },
      liquidity: {
        lcr: 120,
        buffer: 5,
        hqla: 80,
        netOutflows: 60,
        status: 'compliant',
      },
      riskScore: 45,
      topRisks: ['Duration mismatch'],
      recommendations: ['Reduce gap'],
    };

    it('builds English system prompt with institution data', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue(fullSummary);
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('Test CU');
      expect(prompt).toContain('Duration gap');
      expect(prompt).toContain('COSSEC');
      expect(prompt).toContain('500.0');
      expect(prompt).toContain('RULES:');
      expect(prompt).toContain('Reduce gap');
    });

    it('builds Spanish system prompt with institution data', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue(fullSummary);
      const prompt = await service.buildSystemPrompt('inst-1', 'es');
      expect(prompt).toContain('Test CU');
      expect(prompt).toContain('Brecha de duracion');
      expect(prompt).toContain('COSSEC');
      expect(prompt).toContain('REGLAS');
    });

    it('handles compliant LCR status label (en)', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue(fullSummary);
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('compliant');
    });

    it('handles warning LCR status label (es)', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        ...fullSummary,
        liquidity: { ...fullSummary.liquidity, status: 'warning' },
      });
      const prompt = await service.buildSystemPrompt('inst-1', 'es');
      expect(prompt).toContain('advertencia');
    });

    it('handles breach LCR status label (en)', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        ...fullSummary,
        liquidity: { ...fullSummary.liquidity, status: 'breach' },
      });
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('breach');
    });

    it('uses fallback top risk when topRisks is empty', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        ...fullSummary,
        topRisks: [],
      });
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('No significant risks');
    });

    it('uses fallback top risk in Spanish when topRisks is empty', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        ...fullSummary,
        topRisks: [],
      });
      const prompt = await service.buildSystemPrompt('inst-1', 'es');
      expect(prompt).toContain('Sin riesgos significativos');
    });

    it('filters out info-status ratios from summary', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue(fullSummary);
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      // 'Liquidity' ratio has status 'info' and should be filtered out
      expect(prompt).not.toContain('Liquidez');
      expect(prompt).toContain('Capital: 10.2%');
    });

    it('defaults language to es when not specified', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockRejectedValue(new Error('x'));
      mockAlmEnterprise.getALMSummary.mockRejectedValue(new Error('x'));
      const prompt = await service.buildSystemPrompt('inst-1');
      expect(prompt).toContain('Asesor de Riesgo IA');
    });
  });

  // ─── persistQuery ───────────────────────────────────────

  describe('persistQuery (private)', () => {
    it('does not throw when auditLog.create succeeds', async () => {
      mockPrisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
      await expect(
        (service as any).persistQuery('inst-1', 'q', 'r', 100),
      ).resolves.toBeUndefined();
    });

    it('does not throw when auditLog.create fails', async () => {
      mockPrisma.auditLog = {
        create: jest.fn().mockRejectedValue(new Error('table missing')),
      };
      await expect(
        (service as any).persistQuery('inst-1', 'q', 'r', 100),
      ).resolves.toBeUndefined();
    });

    it('does not throw when auditLog is undefined', async () => {
      (service as any).prisma = {};
      await expect(
        (service as any).persistQuery('inst-1', 'q', 'r', 100),
      ).resolves.toBeUndefined();
    });
  });

  describe('buildSystemPrompt — LCR status labels', () => {
    const fullCossec = {
      examReadinessScore: 85,
      overallStatus: 'GOOD',
      summary: {
        totalAssets: 500,
        nim: 3.5,
        capitalRatio: 10.2,
        loanToShareRatio: 65,
        liquidityRatio: 22,
        earningAssetsYield: 4.5,
        costOfFunds: 1.2,
        largestSectorName: 'Real Estate',
        largestSectorPct: 35,
      },
      ratios: [
        {
          name: 'Capital',
          nameEs: 'Capital',
          value: 10.2,
          unit: '%',
          status: 'pass',
        },
      ],
    };
    const fullSummary = {
      institution: { name: 'Test CU', type: 'credit_union' },
      durationGap: {
        durationGap: -0.5,
        assetDuration: 1.5,
        liabilityDuration: 2.0,
        riskProfile: 'low',
      },
      niiSensitivity: { baseNII: 12.5, riskRating: 'moderate' },
      liquidity: {
        lcr: 120,
        buffer: -2,
        hqla: 80,
        netOutflows: 60,
        status: 'warning',
      },
      riskScore: 45,
      topRisks: ['Rate risk'],
      recommendations: ['Increase duration'],
    };

    it('handles negative buffer and negative duration gap in EN prompt', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue(fullSummary);
      const prompt = await service.buildSystemPrompt('inst-1', 'en');
      expect(prompt).toContain('-0.5yr');
      expect(prompt).toContain('warning');
    });

    it('handles breach status label in Spanish', async () => {
      mockAlmEnterprise.getCOSSECCompliance.mockResolvedValue(fullCossec);
      mockAlmEnterprise.getALMSummary.mockResolvedValue({
        ...fullSummary,
        liquidity: { ...fullSummary.liquidity, status: 'breach' },
      });
      const prompt = await service.buildSystemPrompt('inst-1', 'es');
      expect(prompt).toContain('incumplimiento');
    });
  });
});
