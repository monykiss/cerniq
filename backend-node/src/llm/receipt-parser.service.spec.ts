import { ReceiptParserService, ParsedReceipt } from './receipt-parser.service';

describe('ReceiptParserService', () => {
  let service: ReceiptParserService;

  const mockLlmService = {
    analyzeImage: jest.fn(),
    categorize: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReceiptParserService(mockLlmService as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseReceipt', () => {
    it('should parse a receipt from LLM JSON response', async () => {
      mockLlmService.analyzeImage.mockResolvedValue(
        '```json\n{"merchantName":"Starbucks","transactionDate":"2024-06-15","amount":12.50,"currency":"USD","confidence":0.95}\n```',
      );
      mockLlmService.categorize.mockResolvedValue('Meals & Entertainment');

      const result = await service.parseReceipt(
        'https://example.com/receipt.jpg',
      );
      expect(result.merchantName).toBe('Starbucks');
      expect(result.amount).toBe(12.5);
      expect(result.category).toBe('Meals & Entertainment');
    });

    it('should throw when LLM returns unparseable response', async () => {
      mockLlmService.analyzeImage.mockResolvedValue(
        'I cannot process this image',
      );

      await expect(
        service.parseReceipt('https://example.com/bad.jpg'),
      ).rejects.toThrow('Failed to parse receipt');
    });
  });

  describe('checkPolicyViolations', () => {
    it('should flag expense over $1000', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Expensive Restaurant',
        transactionDate: '2024-06-15',
        amount: 1500,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      mockLlmService.categorize.mockResolvedValue('NO');
      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).toContain(
        'Expense exceeds $1,000 limit - requires manager approval',
      );
    });

    it('should flag meal expense over $100', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Fancy Bistro',
        transactionDate: '2024-06-15',
        amount: 250,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      mockLlmService.categorize.mockResolvedValue('NO');
      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).toContain(
        'Meal expense exceeds $100 per person policy',
      );
    });

    it('should return no violations for small office supply', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Office Depot',
        transactionDate: '2024-06-15',
        amount: 25,
        currency: 'USD',
        category: 'Office Supplies',
        confidence: 0.95,
      };

      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).toHaveLength(0);
    });
  });

  describe('checkDuplicate', () => {
    it('should detect duplicate receipt', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Starbucks',
        transactionDate: '2024-06-15',
        amount: 12.5,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      const existing: ParsedReceipt[] = [
        {
          merchantName: 'Starbucks',
          transactionDate: '2024-06-15',
          amount: 12.5,
          currency: 'USD',
          category: 'Meals & Entertainment',
          confidence: 0.9,
        },
      ];

      const isDuplicate = await service.checkDuplicate(receipt, existing);
      expect(isDuplicate).toBe(true);
    });

    it('should not flag different receipts as duplicates', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Starbucks',
        transactionDate: '2024-06-16',
        amount: 15.0,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      const existing: ParsedReceipt[] = [
        {
          merchantName: 'Starbucks',
          transactionDate: '2024-06-15',
          amount: 12.5,
          currency: 'USD',
          category: 'Meals & Entertainment',
          confidence: 0.9,
        },
      ];

      const isDuplicate = await service.checkDuplicate(receipt, existing);
      expect(isDuplicate).toBe(false);
    });

    it('is case-insensitive for merchant name', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'STARBUCKS',
        transactionDate: '2024-06-15',
        amount: 12.5,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      const existing: ParsedReceipt[] = [
        {
          merchantName: 'starbucks',
          transactionDate: '2024-06-15',
          amount: 12.5,
          currency: 'USD',
          category: 'Meals & Entertainment',
          confidence: 0.9,
        },
      ];

      const isDuplicate = await service.checkDuplicate(receipt, existing);
      expect(isDuplicate).toBe(true);
    });

    it('returns false for empty existing list', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Starbucks',
        transactionDate: '2024-06-15',
        amount: 12.5,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      const isDuplicate = await service.checkDuplicate(receipt, []);
      expect(isDuplicate).toBe(false);
    });
  });

  describe('parseReceipt — edge cases', () => {
    it('parses receipt from raw JSON (no markdown)', async () => {
      mockLlmService.analyzeImage.mockResolvedValue(
        '{"merchantName":"Walgreens","transactionDate":"2024-07-20","amount":45.99,"currency":"USD"}',
      );
      mockLlmService.categorize.mockResolvedValue('Office Supplies');

      const result = await service.parseReceipt('https://example.com/r2.jpg');
      expect(result.merchantName).toBe('Walgreens');
      expect(result.amount).toBe(45.99);
      expect(result.confidence).toBe(0.8); // default when not in response
    });

    it('throws when LLM returns empty response', async () => {
      mockLlmService.analyzeImage.mockResolvedValue('');

      await expect(
        service.parseReceipt('https://example.com/empty.jpg'),
      ).rejects.toThrow('Failed to parse receipt');
    });

    it('uses default confidence when not provided by LLM', async () => {
      mockLlmService.analyzeImage.mockResolvedValue(
        '```json\n{"merchantName":"Target","transactionDate":"2024-08-01","amount":29.99,"currency":"USD"}\n```',
      );
      mockLlmService.categorize.mockResolvedValue('Office Supplies');

      const result = await service.parseReceipt('https://example.com/r3.jpg');
      expect(result.confidence).toBe(0.8);
    });

    it('includes items in categorization context', async () => {
      mockLlmService.analyzeImage.mockResolvedValue(
        '```json\n{"merchantName":"Restaurant","transactionDate":"2024-08-01","amount":85.00,"currency":"USD","items":[{"description":"Steak dinner","price":45},{"description":"Wine","price":30}]}\n```',
      );
      mockLlmService.categorize.mockResolvedValue('Meals & Entertainment');

      const result = await service.parseReceipt('https://example.com/meal.jpg');
      expect(result.items).toHaveLength(2);
      expect(mockLlmService.categorize).toHaveBeenCalledWith(
        expect.stringContaining('Steak dinner'),
        expect.any(Array),
      );
    });
  });

  describe('checkPolicyViolations — alcohol detection', () => {
    it('flags alcohol when items contain beverages', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Bar & Grill',
        transactionDate: '2024-06-15',
        amount: 80,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
        items: [
          { description: 'Beer', price: 8 },
          { description: 'Wings', price: 12 },
        ],
      };

      mockLlmService.categorize.mockResolvedValue('YES');
      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).toContain(
        'Receipt contains alcohol - may not be reimbursable',
      );
    });

    it('does not flag alcohol when LLM says NO', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Pizza Place',
        transactionDate: '2024-06-15',
        amount: 30,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
        items: [{ description: 'Pepperoni Pizza', price: 15 }],
      };

      mockLlmService.categorize.mockResolvedValue('NO');
      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).not.toContain(
        'Receipt contains alcohol - may not be reimbursable',
      );
    });

    it('skips alcohol check when no items', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Gas Station',
        transactionDate: '2024-06-15',
        amount: 50,
        currency: 'USD',
        category: 'Transportation',
        confidence: 0.9,
      };

      const violations = await service.checkPolicyViolations(receipt);
      expect(mockLlmService.categorize).not.toHaveBeenCalled();
    });

    it('flags both >$1000 and meal >$100 for large meal receipt', async () => {
      const receipt: ParsedReceipt = {
        merchantName: 'Fancy Restaurant',
        transactionDate: '2024-06-15',
        amount: 1500,
        currency: 'USD',
        category: 'Meals & Entertainment',
        confidence: 0.9,
      };

      const violations = await service.checkPolicyViolations(receipt);
      expect(violations).toContain(
        'Expense exceeds $1,000 limit - requires manager approval',
      );
      expect(violations).toContain(
        'Meal expense exceeds $100 per person policy',
      );
    });
  });
});
