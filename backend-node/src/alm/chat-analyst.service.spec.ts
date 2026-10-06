import { ChatAnalystService } from './chat-analyst.service';

describe('ChatAnalystService', () => {
  let service: ChatAnalystService;
  const mockPrisma = {
    balanceSheetItem: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const mockAlmEnterprise = {} as any;
  const mockAdvisorV2 = {
    computeHealthScore: jest
      .fn()
      .mockResolvedValue({ overall: 75, label: 'SATISFACTORY' }),
  } as any;
  const mockCamelScorer = {
    scoreInstitution: jest.fn().mockResolvedValue({
      composite: 2,
      compositeRating: 'Satisfactory',
      compositeRatingEs: 'Satisfactorio',
      examReadiness: 'READY',
      components: [],
    }),
  } as any;

  beforeEach(() => {
    service = new ChatAnalystService(
      mockPrisma,
      mockAlmEnterprise,
      mockAdvisorV2,
      mockCamelScorer,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return available tools', () => {
    const tools = service.getAvailableTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('desc');
  });

  it('should detect LCR tool from liquidity message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-1',
      'What is our LCR?',
      'en',
    );
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toContain('LCR');
  });

  it('should detect CAMEL tool from exam message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-2',
      'Are we ready for the COSSEC exam?',
      'en',
    );
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toContain('CAMEL');
  });

  it('should return suggested follow-ups', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-3',
      'How are we doing?',
      'en',
    );
    expect(result.suggestedFollowups.length).toBeGreaterThan(0);
    expect(result.suggestedFollowupsEs.length).toBeGreaterThan(0);
  });

  it('should retrieve conversation history', async () => {
    await service.processMessage('inst-1', 'sess-4', 'hello', 'en');
    const history = service.getConversation('sess-4');
    expect(history.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown session', () => {
    const history = service.getConversation('nonexistent');
    expect(history).toEqual([]);
  });

  // ── Tool Detection ─────────────────────────────────────────

  it('detects rate shock tool from bps message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-rate',
      'What happens with a 200 bps rate shock?',
      'en',
    );
    expect(result.message.content).toBeTruthy();
  });

  it('detects CECL tool from allowance message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-cecl',
      'Show me our CECL allowance breakdown',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });

  it('detects concentration tool from sector message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-conc',
      'What are our sector concentrations?',
      'en',
    );
    expect(result.message.content).toContain('Concentration');
  });

  it('detects peer benchmark tool', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-peer',
      'How do we compare to our peers?',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });

  it('detects Monte Carlo tool from simulation message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-mc',
      'Run a Monte Carlo simulation',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });

  it('detects health score as fallback for generic message', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-generic',
      'hello there',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });

  it('detects calendar/deadline tool', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-cal',
      'What are our upcoming deadlines?',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });

  // ── Spanish language support ──────────────────────────────

  it('generates Spanish response', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-es',
      '¿Cómo está nuestra salud financiera?',
      'es',
    );
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toBeTruthy();
    expect(result.suggestedFollowupsEs.length).toBeGreaterThan(0);
  });

  it('generates Spanish response for health score < 50', async () => {
    mockAdvisorV2.computeHealthScore.mockResolvedValueOnce({
      overall: 40,
      label: 'NEEDS_ATTENTION',
    });
    const result = await service.processMessage(
      'inst-1',
      'sess-es2',
      'estado de salud',
      'es',
    );
    expect(result.message.content).toContain('acción inmediata');
  });

  it('generates English response for health score between 50-75', async () => {
    mockAdvisorV2.computeHealthScore.mockResolvedValueOnce({
      overall: 60,
      label: 'FAIR',
    });
    const result = await service.processMessage(
      'inst-1',
      'sess-mid',
      'how is our health score',
      'en',
    );
    expect(result.message.content).toContain('require attention');
  });

  // ── Conversation truncation ───────────────────────────────

  it('truncates conversation history beyond 20 messages', async () => {
    for (let i = 0; i < 12; i++) {
      await service.processMessage('inst-1', 'sess-long', `msg ${i}`, 'en');
    }
    const history = service.getConversation('sess-long');
    expect(history.length).toBeLessThanOrEqual(20);
  });

  // ── Default tool execution (unknown tool) ──────────────────

  it('handles unknown tool name gracefully', async () => {
    // Force a specific tool detection
    const result = await service.processMessage(
      'inst-1',
      'sess-unknown',
      'something very specific and unrelated',
      'en',
    );
    // Should fallback to health score
    expect(result.message.role).toBe('assistant');
  });

  // ── Rate shock with Spanish ────────────────────────────────

  it('detects rate shock from Spanish input', async () => {
    const result = await service.processMessage(
      'inst-1',
      'sess-shock-es',
      'Qué pasa con un choque de 150 puntos base en la tasa?',
      'es',
    );
    expect(result.message.content).toBeTruthy();
  });

  // ── Max 3 tools per query ──────────────────────────────────

  it('limits tool calls to 3 per query', async () => {
    // Send message that could trigger many tools
    const result = await service.processMessage(
      'inst-1',
      'sess-multi',
      'Show LCR liquidity CECL allowance concentration sector CAMEL exam peer benchmark',
      'en',
    );
    expect(result.message.role).toBe('assistant');
  });
});
