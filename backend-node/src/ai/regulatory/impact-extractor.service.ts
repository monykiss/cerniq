import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface RegulatoryImpact {
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  requirements: string[];
  affectedSubcategories: string[];
  deadline: string | null;
  keyQuote: string | null;
}

@Injectable()
export class ImpactExtractorService {
  private readonly logger = new Logger(ImpactExtractorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async extract(publicationId: string): Promise<RegulatoryImpact> {
    const pub = await this.prisma.regulatoryPublication.findUniqueOrThrow({
      where: { id: publicationId },
    });

    // Try Claude API if available
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic();
        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system:
            'Eres un experto en regulación financiera de Puerto Rico. Responde SOLO con JSON válido.',
          messages: [
            {
              role: 'user',
              content: `Analiza esta regulación de ${pub.regulator}: "${pub.title}"\nTexto: ${pub.rawText.slice(0, 15000)}\n\nJSON schema: { "severity":"HIGH"|"MEDIUM"|"LOW", "requirements":string[], "affectedSubcategories":string[], "deadline":string|null, "keyQuote":string }`,
            },
          ],
        });
        const json = JSON.parse(
          response.content[0].type === 'text' ? response.content[0].text : '{}',
        );
        const impact: RegulatoryImpact = {
          severity: json.severity ?? 'MEDIUM',
          requirements: json.requirements ?? [],
          affectedSubcategories: json.affectedSubcategories ?? [],
          deadline: json.deadline ?? null,
          keyQuote: json.keyQuote ?? pub.title,
        };
        await this.prisma.regulatoryPublication.update({
          where: { id: publicationId },
          data: { impactJson: impact as any, processedAt: new Date() },
        });
        return impact;
      } catch (e: any) {
        this.logger.warn(`Claude extraction failed: ${e.message}`);
      }
    }

    // Heuristic fallback
    const impact = this.heuristicExtract(pub);
    await this.prisma.regulatoryPublication.update({
      where: { id: publicationId },
      data: { impactJson: impact as any, processedAt: new Date() },
    });
    return impact;
  }

  private heuristicExtract(pub: any): RegulatoryImpact {
    const text = (pub.rawText ?? pub.title ?? '').toLowerCase();
    const affectedSubcategories: string[] = [];
    if (
      text.includes('liquidez') ||
      text.includes('lcr') ||
      text.includes('liquidity')
    )
      affectedSubcategories.push('liquidity');
    if (
      text.includes('capital') ||
      text.includes('nwr') ||
      text.includes('net worth')
    )
      affectedSubcategories.push('capital');
    if (
      text.includes('tasa') ||
      text.includes('interés') ||
      text.includes('rate')
    )
      affectedSubcategories.push('interest_rate');
    if (
      text.includes('préstamo') ||
      text.includes('loan') ||
      text.includes('crédito')
    )
      affectedSubcategories.push('credit');
    if (text.includes('concentración') || text.includes('concentration'))
      affectedSubcategories.push('concentration');

    const severity =
      text.includes('obligat') ||
      text.includes('mandatory') ||
      text.includes('inmediato')
        ? 'HIGH'
        : text.includes('recomend') || text.includes('guideline')
          ? 'LOW'
          : 'MEDIUM';

    return {
      severity,
      requirements: [`Review: ${pub.title}`],
      affectedSubcategories,
      deadline: null,
      keyQuote: pub.title,
    };
  }
}
