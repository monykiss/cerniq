import { LlmService } from './llm.service';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Test response',
                function_call: {
                  name: 'extract_data',
                  arguments: JSON.stringify({ category: 'utilities' }),
                },
              },
            },
          ],
        }),
      },
    },
  }));
});

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(() => {
    service = new LlmService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('analyzeImage returns a string response', async () => {
    const result = await service.analyzeImage(
      'https://example.com/image.jpg',
      'Describe this image',
    );
    expect(typeof result).toBe('string');
    expect(result).toBe('Test response');
  });

  it('generateStructured returns parsed JSON from function call', async () => {
    const schema = {
      type: 'object',
      properties: { category: { type: 'string' } },
    };
    const result = await service.generateStructured<{ category: string }>(
      'Categorize this expense',
      schema,
    );
    expect(result.category).toBe('utilities');
  });

  it('categorize returns a category string', async () => {
    const result = await service.categorize('Electric bill payment', [
      'utilities',
      'telecom',
      'insurance',
    ]);
    expect(typeof result).toBe('string');
  });

  it('generateStockInsight returns insight text', async () => {
    const result = await service.generateStockInsight('AAPL', 150, 2.5);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // Coverage: line 73 — no function call in response
  it('generateStructured throws when no function call in response', async () => {
    // Access the private openai instance to override its mock
    const openai = (service as any).openai;
    openai.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'text', function_call: null } }],
    });

    await expect(
      service.generateStructured('prompt', { type: 'object', properties: {} }),
    ).rejects.toThrow('No function call in response');
  });

  // Coverage: lines 135-136 — error in generateStockInsight
  it('generateStockInsight returns fallback on API error', async () => {
    const openai = (service as any).openai;
    openai.chat.completions.create.mockRejectedValueOnce(new Error('API down'));

    const result = await service.generateStockInsight('AAPL', 150, 2.5);
    expect(result).toBe('Unable to generate insight at this time.');
  });
});
