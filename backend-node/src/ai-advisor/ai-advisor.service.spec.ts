import { NotFoundException } from '@nestjs/common';
import { AiAdvisorService } from './ai-advisor.service';
import { ConversationHistoryService } from './conversation-history.service';

// ─── Mocks ──────────────────────────────────────────────────

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '## English\nYour NIM is healthy.\n\n## Espanol\nSu NIM esta saludable.',
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 80 },
      }),
      stream: jest.fn(),
    },
  })),
}));

const mockInstitution = {
  id: 'inst-1',
  name: 'Cooperativa Test',
  type: 'cooperativa',
  totalAssets: { toString: () => '500000000.00' },
  reportingDate: new Date('2026-03-31'),
  regulatoryBody: 'COSSEC',
};

const mockAnalysisRun = {
  results: {
    liquidity: { lcr: 1.25 },
    nim: { current: 3.2, trend: 'stable' },
  },
  createdAt: new Date('2026-03-31'),
};

function buildMockPrisma() {
  return {
    institution: {
      findUnique: jest.fn().mockResolvedValue(mockInstitution),
    },
    analysisRun: {
      findFirst: jest.fn().mockResolvedValue(mockAnalysisRun),
    },
    conversationHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    policyBreachLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    institutionAlert: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function buildMockConversationHistory() {
  return {
    getSessionHistory: jest.fn().mockResolvedValue([]),
    addMessage: jest.fn().mockResolvedValue(undefined),
    listSessions: jest.fn().mockResolvedValue([]),
    deleteSession: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConversationHistoryService;
}

// ─── Tests ──────────────────────────────────────────────────

describe('AiAdvisorService', () => {
  let service: AiAdvisorService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let mockHistory: ReturnType<typeof buildMockConversationHistory>;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    jest.clearAllMocks();
    mockPrisma = buildMockPrisma();
    mockHistory = buildMockConversationHistory();
    service = new AiAdvisorService(mockPrisma, mockHistory);
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  // ─── ask() ────────────────────────────────────────────

  describe('ask()', () => {
    it('returns a bilingual response with institution context', async () => {
      const result = await service.ask({
        institutionId: 'inst-1',
        userId: 'user-1',
        question: 'What is our current NIM?',
        sessionId: 'session-1',
        language: 'both',
      });

      expect(result.content).toContain('NIM');
      expect(result.contentEs).toBeDefined();
      expect(result.contentEs).toContain('NIM');
      expect(result.modelId).toBeDefined();
      expect(result.sessionId).toBe('session-1');
      expect(typeof result.tokenCount).toBe('number');
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('stores both user question and assistant response in history', async () => {
      await service.ask({
        institutionId: 'inst-1',
        userId: 'user-1',
        question: 'Capital adequacy?',
        sessionId: 'session-2',
      });

      // User message
      expect(mockHistory.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'USER',
          content: 'Capital adequacy?',
          sessionId: 'session-2',
        }),
      );

      // Assistant message
      expect(mockHistory.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'ASSISTANT',
          sessionId: 'session-2',
          tokenCount: expect.any(Number),
          modelId: expect.any(String),
        }),
      );

      expect(mockHistory.addMessage).toHaveBeenCalledTimes(2);
    });

    it('tracks token count', async () => {
      const result = await service.ask({
        institutionId: 'inst-1',
        userId: 'user-1',
        question: 'Liquidity position?',
        sessionId: 'session-3',
      });

      // 150 input + 80 output from the mock
      expect(result.tokenCount).toBe(230);
    });

    it('returns fallback when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const svc = new AiAdvisorService(mockPrisma, mockHistory);

      const result = await svc.ask({
        institutionId: 'inst-1',
        userId: 'user-1',
        question: 'Test',
        sessionId: 'session-4',
      });

      expect(result.content).toContain('not available');
      expect(result.contentEs).toContain('no esta disponible');
      expect(result.tokenCount).toBe(0);
      expect(result.modelId).toBe('none');
    });
  });

  // ─── buildSystemPrompt() ──────────────────────────────

  describe('buildSystemPrompt()', () => {
    it('includes institution name and regulatory body', () => {
      const prompt = service.buildSystemPrompt({
        id: 'inst-1',
        name: 'Cooperativa Test',
        type: 'cooperativa',
        totalAssets: '500000000.00',
        reportingDate: '2026-03-31',
        regulatoryBody: 'COSSEC',
      });

      expect(prompt).toContain('Cooperativa Test');
      expect(prompt).toContain('COSSEC');
      expect(prompt).toContain('CERNIQ AI Advisor');
      expect(prompt).toContain('bilingual');
    });

    it('includes latest metrics when provided', () => {
      const prompt = service.buildSystemPrompt({
        id: 'inst-1',
        name: 'Test CU',
        type: 'credit_union',
        totalAssets: '100000000.00',
        reportingDate: '2026-03-31',
        regulatoryBody: 'NCUA',
        latestMetrics: { nim: 3.2, lcr: 1.15 },
      });

      expect(prompt).toContain('nim');
      expect(prompt).toContain('3.2');
      expect(prompt).toContain('NCUA');
    });

    it('configures bilingual response for language=both', () => {
      const prompt = service.buildSystemPrompt(
        {
          id: 'inst-1',
          name: 'Test',
          type: 'cooperativa',
          totalAssets: '1000000.00',
          reportingDate: '2026-01-01',
          regulatoryBody: 'COSSEC',
        },
        'both',
      );

      expect(prompt).toContain('English');
      expect(prompt).toContain('Espanol');
    });

    it('configures Spanish-only for language=es', () => {
      const prompt = service.buildSystemPrompt(
        {
          id: 'inst-1',
          name: 'Test',
          type: 'cooperativa',
          totalAssets: '1000000.00',
          reportingDate: '2026-01-01',
          regulatoryBody: 'COSSEC',
        },
        'es',
      );

      expect(prompt).toContain('Respond entirely in Spanish');
    });
  });

  // ─── getInstitutionContext() ───────────────────────────

  describe('getInstitutionContext()', () => {
    it('returns institution data with latest metrics', async () => {
      const ctx = await service.getInstitutionContext('inst-1');

      expect(ctx.name).toBe('Cooperativa Test');
      expect(ctx.type).toBe('cooperativa');
      expect(ctx.totalAssets).toBe('500000000.00');
      expect(ctx.regulatoryBody).toBe('COSSEC');
      expect(ctx.latestMetrics).toBeDefined();
      expect(ctx.latestMetrics?.liquidity).toEqual({ lcr: 1.25 });
    });

    it('throws NotFoundException for missing institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.getInstitutionContext('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns context without metrics when no analysis run exists', async () => {
      mockPrisma.analysisRun.findFirst.mockResolvedValue(null);

      const ctx = await service.getInstitutionContext('inst-1');

      expect(ctx.name).toBe('Cooperativa Test');
      expect(ctx.latestMetrics).toBeUndefined();
    });
  });
});
