import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';

export interface ParsedReceipt {
  merchantName: string;
  merchantAddress?: string;
  transactionDate: string;
  amount: number;
  currency: string;
  items?: Array<{
    description: string;
    quantity?: number;
    price: number;
  }>;
  tax?: number;
  tip?: number;
  paymentMethod?: string;
  category: string;
  confidence: number;
}

const EXPENSE_CATEGORIES = [
  'Meals & Entertainment',
  'Transportation',
  'Office Supplies',
  'Software & Subscriptions',
  'Travel & Lodging',
  'Marketing & Advertising',
  'Professional Services',
  'Equipment',
  'Utilities',
  'Other',
];

@Injectable()
export class ReceiptParserService {
  private readonly logger = new Logger(ReceiptParserService.name);

  constructor(private llmService: LlmService) {}

  /**
   * Parse receipt image and extract structured data
   */
  async parseReceipt(receiptUrl: string): Promise<ParsedReceipt> {
    const prompt = `Analyze this receipt image and extract the following information in JSON format:
{
  "merchantName": "Name of the merchant/business",
  "merchantAddress": "Address if visible",
  "transactionDate": "Date in ISO format (YYYY-MM-DD)",
  "amount": "Total amount as a number",
  "currency": "Currency code (default USD)",
  "items": [
    {
      "description": "Item description",
      "quantity": "Quantity if visible",
      "price": "Item price"
    }
  ],
  "tax": "Tax amount if visible",
  "tip": "Tip amount if visible",
  "paymentMethod": "Payment method if visible",
  "confidence": "Your confidence in the extraction (0-1)"
}

If any field is not clearly visible, omit it or use null. Be precise with numbers.`;

    try {
      const response = await this.llmService.analyzeImage(receiptUrl, prompt);

      // Parse the JSON response
      // GPT-4 Vision might wrap the JSON in markdown code blocks
      const jsonMatch =
        response.match(/```json\n?([\s\S]*?)\n?```/) ||
        response.match(/{[\s\S]*}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from LLM response');
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      // Categorize the expense based on merchant and items
      const categoryContext = `Merchant: ${parsed.merchantName}\nItems: ${
        parsed.items?.map((i: any) => i.description).join(', ') || 'N/A'
      }`;

      const category = await this.llmService.categorize(
        categoryContext,
        EXPENSE_CATEGORIES,
      );

      return {
        ...parsed,
        category,
        confidence: parsed.confidence || 0.8,
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Receipt parsing error');
      throw new Error(`Failed to parse receipt: ${error.message}`);
    }
  }

  /**
   * Check for potential policy violations
   */
  async checkPolicyViolations(parsedReceipt: ParsedReceipt): Promise<string[]> {
    const violations: string[] = [];

    // Example policy checks
    if (parsedReceipt.amount > 1000) {
      violations.push(
        'Expense exceeds $1,000 limit - requires manager approval',
      );
    }

    if (
      parsedReceipt.category === 'Meals & Entertainment' &&
      parsedReceipt.amount > 100
    ) {
      violations.push('Meal expense exceeds $100 per person policy');
    }

    // Check for alcohol using LLM
    if (parsedReceipt.items && parsedReceipt.items.length > 0) {
      const itemsList = parsedReceipt.items
        .map((i) => i.description)
        .join(', ');
      const prompt = `Does this list contain alcoholic beverages? Answer only YES or NO.\n\nItems: ${itemsList}`;

      const response = await this.llmService.categorize(prompt, ['YES', 'NO']);
      if (response === 'YES') {
        violations.push('Receipt contains alcohol - may not be reimbursable');
      }
    }

    return violations;
  }

  /**
   * Detect potential duplicate expenses
   */
  async checkDuplicate(
    newReceipt: ParsedReceipt,
    existingReceipts: ParsedReceipt[],
  ): Promise<boolean> {
    // Simple duplicate check based on merchant, date, and amount
    return existingReceipts.some(
      (existing) =>
        existing.merchantName.toLowerCase() ===
          newReceipt.merchantName.toLowerCase() &&
        existing.transactionDate === newReceipt.transactionDate &&
        Math.abs(existing.amount - newReceipt.amount) < 0.01,
    );
  }
}
