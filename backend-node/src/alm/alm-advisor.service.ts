import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from './alm-enterprise.service';

interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AdvisorResponse {
  response: string;
  tokensUsed: number;
}

/**
 * AI Risk Advisor — natural-language ALM intelligence powered by Claude.
 *
 * Injects the institution's *actual* balance-sheet metrics into a system
 * prompt so that every answer is grounded in real data. Falls back to a
 * polite degradation message when the ANTHROPIC_API_KEY env var is absent.
 */
@Injectable()
export class AlmAdvisorService {
  private readonly logger = new Logger(AlmAdvisorService.name);
  private anthropic: any;
  private openai: OpenAI | null = null;
  private readonly anthropicModel =
    (process.env.AI_ADVISOR_ANTHROPIC_MODEL || '').trim() ||
    'claude-sonnet-4-20250514';
  private readonly openaiModel =
    (process.env.AI_ADVISOR_OPENAI_MODEL || '').trim() || 'gpt-4.1-mini';

  /** In-memory daily-limit tracker: key = "institutionId:YYYY-MM-DD" */
  private readonly dailyCounts = new Map<string, number>();
  private readonly DAILY_LIMIT = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
  ) {
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (anthropicKey) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.anthropic = new Anthropic({ apiKey: anthropicKey });
        this.logger.log('Anthropic SDK initialised for AI Advisor');
      } catch (err) {
        this.logger.warn(
          'Failed to initialise Anthropic SDK — AI Advisor will be unavailable',
          err,
        );
      }
    }

    if (!this.anthropic && openaiKey) {
      try {
        this.openai = new OpenAI({ apiKey: openaiKey });
        this.logger.log('OpenAI SDK initialised for AI Advisor fallback');
      } catch (err) {
        this.logger.warn(
          'Failed to initialise OpenAI SDK — AI Advisor fallback unavailable',
          err,
        );
      }
    }

    if (!this.anthropic && !this.openai) {
      this.logger.warn(
        'ANTHROPIC_API_KEY and OPENAI_API_KEY not set — AI Advisor disabled',
      );
    }
  }

  // ─── Public API ──────────────────────────────────────────────

  async ask(
    institutionId: string,
    message: string,
    history: AdvisorMessage[] = [],
    language: string = 'es',
  ): Promise<AdvisorResponse> {
    // ── Gate: SDK availability ──
    if (!this.anthropic && !this.openai) {
      const msg =
        language === 'es'
          ? 'El asesor IA no esta disponible. Configure ANTHROPIC_API_KEY u OPENAI_API_KEY en las variables de entorno.'
          : 'The AI Advisor is not available. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment variables.';
      return { response: msg, tokensUsed: 0 };
    }

    // ── Gate: daily limit ──
    const today = new Date().toISOString().slice(0, 10);
    const limitKey = `${institutionId}:${today}`;
    const currentCount = this.dailyCounts.get(limitKey) || 0;
    if (currentCount >= this.DAILY_LIMIT) {
      const msg =
        language === 'es'
          ? `Has alcanzado el limite diario de ${this.DAILY_LIMIT} consultas para esta institucion. Intenta de nuevo manana.`
          : `You have reached the daily limit of ${this.DAILY_LIMIT} queries for this institution. Please try again tomorrow.`;
      return { response: msg, tokensUsed: 0 };
    }

    // ── Build context ──
    const systemPrompt = await this.buildSystemPrompt(institutionId, language);

    // ── Construct messages array ──
    const messages = [
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    try {
      const { response, tokensUsed } = this.anthropic
        ? await this.askWithAnthropic(systemPrompt, messages)
        : await this.askWithOpenAI(systemPrompt, messages);

      // ── Increment counter ──
      this.dailyCounts.set(limitKey, currentCount + 1);

      // ── Persist query (best-effort) ──
      this.persistQuery(institutionId, message, response, tokensUsed).catch(
        (err) => this.logger.warn('Failed to persist advisor query', err),
      );

      return { response, tokensUsed };
    } catch (err: any) {
      this.logger.error('AI Advisor provider call failed', err?.message || err);
      const msg =
        language === 'es'
          ? 'Ocurrio un error al procesar tu consulta. Por favor intenta de nuevo.'
          : 'An error occurred while processing your query. Please try again.';
      return { response: msg, tokensUsed: 0 };
    }
  }

  // ─── System Prompt Builder ───────────────────────────────────

  private async askWithAnthropic(
    systemPrompt: string,
    messages: AdvisorMessage[],
  ): Promise<AdvisorResponse> {
    const completion = await this.anthropic.messages.create({
      model: this.anthropicModel,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    return {
      response:
        completion.content?.[0]?.type === 'text'
          ? completion.content[0].text
          : 'No response generated.',
      tokensUsed:
        (completion.usage?.input_tokens || 0) +
        (completion.usage?.output_tokens || 0),
    };
  }

  private async askWithOpenAI(
    systemPrompt: string,
    messages: AdvisorMessage[],
  ): Promise<AdvisorResponse> {
    if (!this.openai) {
      throw new Error('OpenAI client is not initialised');
    }

    const completion = await this.openai.chat.completions.create({
      model: this.openaiModel,
      max_tokens: 2048,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    });

    const content = completion.choices[0]?.message?.content;
    const responseText = Array.isArray(content)
      ? content
          .map((item) =>
            typeof item === 'object' && item && 'text' in item
              ? String(item.text)
              : '',
          )
          .join('')
      : content || 'No response generated.';

    return {
      response: responseText,
      tokensUsed:
        (completion.usage?.prompt_tokens || 0) +
        (completion.usage?.completion_tokens || 0),
    };
  }

  async buildSystemPrompt(
    institutionId: string,
    language: string = 'es',
  ): Promise<string> {
    let cossec: any = null;
    let summary: any = null;

    try {
      [cossec, summary] = await Promise.all([
        this.almEnterprise.getCOSSECCompliance(institutionId),
        this.almEnterprise.getALMSummary(institutionId),
      ]);
    } catch (err) {
      this.logger.warn(
        'Failed to fetch institution data for system prompt',
        err,
      );
    }

    // Fallback when data is missing
    if (!cossec || !summary) {
      return language === 'es'
        ? `Eres el Asesor de Riesgo IA de CERNIQ. No se pudieron cargar los datos de la institucion. Responde con informacion general sobre ALM y gestion de riesgo.`
        : `You are CERNIQ's AI Risk Advisor. Institution data could not be loaded. Respond with general ALM and risk management guidance.`;
    }

    const inst = summary.institution;
    const dg = summary.durationGap;
    const nii = summary.niiSensitivity;
    const liq = summary.liquidity;
    const s = cossec.summary;

    const lcrStatusLabel =
      liq.status === 'compliant'
        ? language === 'es'
          ? 'cumple'
          : 'compliant'
        : liq.status === 'warning'
          ? language === 'es'
            ? 'advertencia'
            : 'warning'
          : language === 'es'
            ? 'incumplimiento'
            : 'breach';

    const topRisk =
      summary.topRisks?.[0] ||
      (language === 'es'
        ? 'Sin riesgos significativos'
        : 'No significant risks');

    const ratiosSummary = cossec.ratios
      .filter((r: any) => r.status !== 'info')
      .map(
        (r: any) =>
          `  - ${language === 'es' ? r.nameEs : r.name}: ${r.value}${r.unit} (${r.status})`,
      )
      .join('\n');

    const recommendationsList = summary.recommendations
      .map((rec: string, i: number) => `  ${i + 1}. ${rec}`)
      .join('\n');

    if (language === 'es') {
      return `Eres el Asesor de Riesgo IA de CERNIQ, asignado exclusivamente a ${inst.name}.

Datos actuales de la institucion (${inst.type.replace(/_/g, ' ')}):
- Activos totales: $${s.totalAssets.toFixed(1)}M
- Preparacion COSSEC: ${cossec.examReadinessScore}/100 (${cossec.overallStatus})
- Brecha de duracion: ${dg.durationGap > 0 ? '+' : ''}${dg.durationGap}yr (${dg.riskProfile})
- Duracion activos: ${dg.assetDuration}yr | Duracion pasivos: ${dg.liabilityDuration}yr
- LCR: ${liq.lcr}% (${lcrStatusLabel}) | Buffer: ${liq.buffer > 0 ? '+' : ''}${liq.buffer}%
- HQLA: $${liq.hqla}M | Flujos netos: $${liq.netOutflows}M
- NIM: ${s.nim}%
- Suficiencia de capital: ${s.capitalRatio}%
- Prestamos/depositos: ${s.loanToShareRatio}%
- NII base: $${nii.baseNII}M (riesgo: ${nii.riskRating})
- Liquidez: ${s.liquidityRatio}%
- Rendimiento activos productivos: ${s.earningAssetsYield}%
- Costo de fondos: ${s.costOfFunds}%
- Concentracion mayor sector: ${s.largestSectorName} (${s.largestSectorPct}%)
- Puntaje de riesgo compuesto: ${summary.riskScore}/100
- Principal riesgo: ${topRisk}

Ratios COSSEC:
${ratiosSummary}

Recomendaciones actuales:
${recommendationsList}

REGLAS:
1. SIEMPRE usa los datos especificos de esta institucion — nunca inventes numeros.
2. Cita al menos UN valor numerico en cada parrafo de tu respuesta.
3. Usa terminologia profesional de ALM institucional (duracion, NII, EVE, LCR, NSFR, BPV).
4. Responde en espanol profesional.
5. Si no sabes algo o los datos son insuficientes, dilo claramente.
6. Cuando te pregunten sobre escenarios de tasas, usa los datos de sensibilidad NII y EVE disponibles.
7. Siempre enmarca tus respuestas en el contexto regulatorio de COSSEC para cooperativas de Puerto Rico.
8. Cuando compares con el sector, menciona las medianas de COSSEC donde sea relevante.`;
    }

    return `You are CERNIQ's AI Risk Advisor, assigned exclusively to ${inst.name}.

Current institution data (${inst.type.replace(/_/g, ' ')}):
- Total assets: $${s.totalAssets.toFixed(1)}M
- COSSEC exam readiness: ${cossec.examReadinessScore}/100 (${cossec.overallStatus})
- Duration gap: ${dg.durationGap > 0 ? '+' : ''}${dg.durationGap}yr (${dg.riskProfile})
- Asset duration: ${dg.assetDuration}yr | Liability duration: ${dg.liabilityDuration}yr
- LCR: ${liq.lcr}% (${lcrStatusLabel}) | Buffer: ${liq.buffer > 0 ? '+' : ''}${liq.buffer}%
- HQLA: $${liq.hqla}M | Net outflows: $${liq.netOutflows}M
- NIM: ${s.nim}%
- Capital adequacy: ${s.capitalRatio}%
- Loan-to-deposit ratio: ${s.loanToShareRatio}%
- Base NII: $${nii.baseNII}M (risk rating: ${nii.riskRating})
- Liquidity ratio: ${s.liquidityRatio}%
- Earning assets yield: ${s.earningAssetsYield}%
- Cost of funds: ${s.costOfFunds}%
- Largest sector concentration: ${s.largestSectorName} (${s.largestSectorPct}%)
- Composite risk score: ${summary.riskScore}/100
- Top risk: ${topRisk}

COSSEC Ratios:
${ratiosSummary}

Current recommendations:
${recommendationsList}

RULES:
1. ALWAYS use this institution's specific data — never fabricate numbers.
2. Cite at least ONE numeric value in every paragraph of your response.
3. Use professional ALM terminology (duration, NII, EVE, LCR, NSFR, BPV).
4. Respond in professional English.
5. If you don't know something or data is insufficient, say so clearly.
6. When asked about rate scenarios, use the available NII and EVE sensitivity data.
7. Always frame your responses in the COSSEC regulatory context for Puerto Rico cooperativas.
8. When comparing to the sector, mention COSSEC medians where relevant.`;
  }

  // ─── Persistence ─────────────────────────────────────────────

  /**
   * Best-effort persistence of advisor queries. Uses the AuditLog table
   * if it exists; silently skips otherwise.
   */
  private async persistQuery(
    institutionId: string,
    question: string,
    response: string,
    tokensUsed: number,
  ): Promise<void> {
    try {
      await (this.prisma as any).auditLog?.create?.({
        data: {
          action: 'AI_ADVISOR_QUERY',
          entityType: 'institution',
          entityId: institutionId,
          metadata: {
            question: question.slice(0, 500),
            responsePreview: response.slice(0, 200),
            tokensUsed,
          },
        },
      });
    } catch {
      // AuditLog table may not exist — that's fine, the in-memory counter
      // still enforces daily limits.
    }
  }
}
