import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface NLIngestResult {
  itemsCreated: number;
  warnings: string[];
  extractedCategories: { assets: number; liabilities: number };
}

@Injectable()
export class NLIngestService {
  private readonly logger = new Logger(NLIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestDocument(
    institutionId: string,
    fileName: string,
    content: Buffer | string,
    mimeType: string,
  ): Promise<NLIngestResult> {
    // Step 1: Extract text from document
    let text: string;
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(
          Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64'),
        );
        text = data.text.slice(0, 60000);
      } catch {
        text = Buffer.isBuffer(content)
          ? content.toString('utf-8').slice(0, 60000)
          : content.slice(0, 60000);
      }
    } else {
      text = (
        typeof content === 'string' ? content : content.toString('utf-8')
      ).slice(0, 60000);
    }

    // Step 2: Extract balance sheet items via Claude API or heuristic
    let items: any[];
    if (process.env.ANTHROPIC_API_KEY) {
      items = await this.extractWithClaude(text, fileName);
    } else {
      items = this.extractHeuristic(text);
    }

    if (items.length === 0) {
      return {
        itemsCreated: 0,
        warnings: ['No balance sheet items detected in document.'],
        extractedCategories: { assets: 0, liabilities: 0 },
      };
    }

    // Step 3: Validate and save
    const validItems = items.filter(
      (i) => i.name && i.balance > 0 && i.category,
    );
    await this.prisma.balanceSheetItem.deleteMany({ where: { institutionId } });
    const created = await this.prisma.balanceSheetItem.createMany({
      data: validItems.map((i) => ({
        institutionId,
        name: i.name,
        category: i.category,
        subcategory:
          i.subcategory ??
          (i.category === 'asset' ? 'other_assets' : 'other_borrowings'),
        balance: i.balance,
        rate: i.rate ?? 0,
        duration: i.duration ?? 1,
        rateType: i.rateType ?? 'fixed',
      })),
    });

    const assetCount = validItems.filter((i) => i.category === 'asset').length;
    const liabCount = validItems.filter(
      (i) => i.category === 'liability',
    ).length;
    this.logger.log(
      `NL ingest: ${created.count} items from "${fileName}" (${assetCount} assets, ${liabCount} liabilities)`,
    );

    return {
      itemsCreated: created.count,
      warnings:
        validItems.length < items.length
          ? [`${items.length - validItems.length} items skipped (validation)`]
          : [],
      extractedCategories: { assets: assetCount, liabilities: liabCount },
    };
  }

  private async extractWithClaude(
    text: string,
    fileName: string,
  ): Promise<any[]> {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system:
          'Extract balance sheet items from financial documents. Respond ONLY with a JSON array.',
        messages: [
          {
            role: 'user',
            content: `Extract balance sheet items from "${fileName}":\n${text.slice(0, 20000)}\n\nRespond with JSON array: [{ "name":string, "category":"asset"|"liability", "subcategory":string, "balance":number, "rate":number, "duration":number, "rateType":"fixed"|"variable" }]`,
          },
        ],
      });
      const cleaned = (response.content[0] as any).text
        .replace(/```json|```/g, '')
        .trim();
      return JSON.parse(cleaned);
    } catch (e: any) {
      this.logger.warn(`Claude extraction failed: ${e.message}`);
      return this.extractHeuristic(text);
    }
  }

  private extractHeuristic(text: string): any[] {
    // Simple pattern matching for common financial document formats
    const items: any[] = [];
    const lines = text.split('\n');
    const amountRegex = /\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:M|million|mil)?/i;

    for (const line of lines) {
      const match = line.match(amountRegex);
      if (!match) continue;
      // D23: NL-extraction heuristic — intentionally lenient parseFloat
      // (allows trailing non-numeric noise from prose surrounding a
      // monetary token, e.g. "$1,234 (approx)"). The [0.1, 100000]
      // range bound below catches the major silent-accept cases.
      // Tightening to parseFinancialField would reject legitimate
      // "$1,234 (approx)" style extractions.
      const amount = parseFloat(match[1].replace(/,/g, '')); // heuristic
      if (amount < 0.1 || amount > 100000) continue;

      const lower = line.toLowerCase();
      const isLiability =
        lower.includes('deposit') ||
        lower.includes('borrow') ||
        lower.includes('share') ||
        lower.includes('pasivo');
      const category = isLiability ? 'liability' : 'asset';

      items.push({
        name: line.replace(amountRegex, '').trim().slice(0, 100) || `Item`,
        category,
        subcategory: category === 'asset' ? 'other_assets' : 'other_borrowings',
        balance: amount,
        rate: 0,
        duration: 1,
        rateType: 'fixed',
      });
    }
    return items.slice(0, 30);
  }
}
