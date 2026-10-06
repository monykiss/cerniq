import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma.service';
import {
  ConversationHistoryService,
  ConversationMessage,
} from './conversation-history.service';

// ─── Configuration ──────────────────────────────────────────

const AI_ADVISOR_MODEL = process.env.AI_ADVISOR_MODEL || 'claude-sonnet-4-6';

const MAX_RESPONSE_TOKENS = 4096;

// ─── Interfaces ─────────────────────────────────────────────

export interface AskParams {
  institutionId: string;
  userId: string;
  question: string;
  sessionId: string;
  language?: 'es' | 'en' | 'both';
}

export interface AiAdvisorResponse {
  content: string;
  contentEs?: string;
  modelId: string;
  tokenCount: number;
  almModulesReferenced: string[];
  sessionId: string;
}

export interface AiAdvisorChunk {
  type: 'text' | 'tool_use' | 'done';
  content?: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface InstitutionContext {
  id: string;
  name: string;
  type: string;
  totalAssets: string;
  reportingDate: string;
  regulatoryBody: string;
  latestMetrics?: Record<string, unknown>;
}

// ─── Tool Definitions ───────────────────────────────────────

const ADVISOR_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'queryAlmModule',
    description:
      'Query the ALM engine for specific institutional metrics such as NIM, duration gap, liquidity ratios, capital adequacy, or concentration risk. Returns the latest computed values.',
    input_schema: {
      type: 'object' as const,
      properties: {
        module: {
          type: 'string',
          enum: [
            'liquidity',
            'interest_rate_risk',
            'capital_adequacy',
            'credit_risk',
            'concentration',
            'nim',
            'duration',
            'deposit_beta',
          ],
          description: 'The ALM module to query',
        },
        institutionId: {
          type: 'string',
          description: 'Institution ID',
        },
      },
      required: ['module', 'institutionId'],
    },
  },
  {
    name: 'getComplianceStatus',
    description:
      'Retrieve the current COSSEC/NCUA regulatory compliance status including any policy breaches, upcoming deadlines, and exam readiness scores.',
    input_schema: {
      type: 'object' as const,
      properties: {
        institutionId: {
          type: 'string',
          description: 'Institution ID',
        },
      },
      required: ['institutionId'],
    },
  },
  {
    name: 'getRiskSummary',
    description:
      'Get a comprehensive risk summary including top risk alerts, health scores across all dimensions (capital, liquidity, rate risk, credit, concentration), and peer benchmarks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        institutionId: {
          type: 'string',
          description: 'Institution ID',
        },
      },
      required: ['institutionId'],
    },
  },
];

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class AiAdvisorService {
  private readonly logger = new Logger(AiAdvisorService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationHistory: ConversationHistoryService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  // ─── Main entry point ───────────────────────────────────

  async ask(params: AskParams): Promise<AiAdvisorResponse> {
    const {
      institutionId,
      userId,
      question,
      sessionId,
      language = 'both',
    } = params;

    if (!this.client) {
      return {
        content:
          'AI Advisor is not available — ANTHROPIC_API_KEY is not configured. Please contact your administrator.',
        contentEs:
          'El Asesor IA no esta disponible — ANTHROPIC_API_KEY no esta configurado. Por favor contacte a su administrador.',
        modelId: 'none',
        tokenCount: 0,
        almModulesReferenced: [],
        sessionId,
      };
    }

    const startMs = Date.now();

    // 1. Load institution context
    const institution = await this.getInstitutionContext(institutionId);

    // 2. Retrieve conversation history for context — scoped to *this* user
    //    so the LLM never sees another user's prior messages even if two
    //    users in the same institution converge on the same sessionId.
    const history = await this.conversationHistory.getSessionHistory(
      institutionId,
      sessionId,
      10,
      userId,
    );

    // 3. Build system prompt
    const systemPrompt = this.buildSystemPrompt(institution, language);

    // 4. Build messages array from history + new question
    const messages = this.buildMessages(history, question);

    // 5. Store user question
    await this.conversationHistory.addMessage({
      institutionId,
      userId,
      sessionId,
      role: 'USER',
      content: question,
    });

    // 6. Call the LLM with tool-use enabled
    const almModulesReferenced: string[] = [];
    let finalText = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Tool-use loop: the model may request tools before producing a final answer.
    let currentMessages: Anthropic.Messages.MessageParam[] = [...messages];
    const maxToolRounds = 5;

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await this.client.messages.create({
        model: AI_ADVISOR_MODEL,
        max_tokens: MAX_RESPONSE_TOKENS,
        temperature: 0.3,
        system: systemPrompt,
        tools: ADVISOR_TOOLS,
        messages: currentMessages,
      });

      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

      // Process content blocks
      const assistantContent: Array<
        Anthropic.Messages.TextBlock | Anthropic.Messages.ToolUseBlock
      > = [];
      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
      }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          finalText += block.text;
          assistantContent.push(block);
        } else if (block.type === 'tool_use') {
          assistantContent.push(block);
          const toolResult = await this.executeTool(
            block.name,
            block.input as Record<string, unknown>,
          );
          almModulesReferenced.push(block.name);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              typeof toolResult === 'string'
                ? toolResult
                : JSON.stringify(toolResult),
          });
        }
      }

      // If the model did not invoke any tools, we are done.
      if (response.stop_reason === 'end_turn' || toolResults.length === 0) {
        break;
      }

      // Append assistant turn + tool results and loop.
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: assistantContent as any },
        { role: 'user' as const, content: toolResults as any },
      ];

      // Reset finalText for next iteration — the model will produce a new
      // synthesis that incorporates tool results.
      finalText = '';
    }

    const latencyMs = Date.now() - startMs;
    const tokenCount = totalInputTokens + totalOutputTokens;

    // 7. Extract ES content if bilingual mode
    const contentEs =
      language === 'both' || language === 'es'
        ? this.extractSpanishSection(finalText)
        : undefined;

    // 8. Store assistant response
    await this.conversationHistory.addMessage({
      institutionId,
      userId,
      sessionId,
      role: 'ASSISTANT',
      content: finalText,
      contentEs,
      tokenCount,
      modelId: AI_ADVISOR_MODEL,
      latencyMs,
      almModulesReferenced,
    });

    this.logger.log(
      `AI Advisor responded for ${institution.name} in ${latencyMs}ms (${tokenCount} tokens, ${almModulesReferenced.length} tools used)`,
    );

    return {
      content: finalText,
      contentEs,
      modelId: AI_ADVISOR_MODEL,
      tokenCount,
      almModulesReferenced: [...new Set(almModulesReferenced)],
      sessionId,
    };
  }

  // ─── Streaming version for WebSocket ────────────────────

  async *streamAsk(params: AskParams): AsyncGenerator<AiAdvisorChunk> {
    const {
      institutionId,
      userId,
      question,
      sessionId,
      language = 'both',
    } = params;

    if (!this.client) {
      yield {
        type: 'text',
        content:
          'AI Advisor is not available — ANTHROPIC_API_KEY is not configured.',
      };
      yield { type: 'done' };
      return;
    }

    const institution = await this.getInstitutionContext(institutionId);
    // History scoped to this user — same privacy guarantee as ask().
    const history = await this.conversationHistory.getSessionHistory(
      institutionId,
      sessionId,
      10,
      userId,
    );
    const systemPrompt = this.buildSystemPrompt(institution, language);
    const messages = this.buildMessages(history, question);

    // Store user question
    await this.conversationHistory.addMessage({
      institutionId,
      userId,
      sessionId,
      role: 'USER',
      content: question,
    });

    const startMs = Date.now();
    let fullText = '';
    let totalTokens = 0;
    const almModulesReferenced: string[] = [];

    const stream = this.client.messages.stream({
      model: AI_ADVISOR_MODEL,
      max_tokens: MAX_RESPONSE_TOKENS,
      temperature: 0.3,
      system: systemPrompt,
      tools: ADVISOR_TOOLS,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullText += event.delta.text;
        yield { type: 'text', content: event.delta.text };
      } else if (
        event.type === 'content_block_start' &&
        event.content_block.type === 'tool_use'
      ) {
        almModulesReferenced.push(event.content_block.name);
        yield {
          type: 'tool_use',
          toolName: event.content_block.name,
          toolInput: undefined,
        };
      } else if (event.type === 'message_stop') {
        const finalMsg = await stream.finalMessage();
        totalTokens =
          (finalMsg.usage?.input_tokens ?? 0) +
          (finalMsg.usage?.output_tokens ?? 0);
      }
    }

    const latencyMs = Date.now() - startMs;
    const contentEs =
      language === 'both' || language === 'es'
        ? this.extractSpanishSection(fullText)
        : undefined;

    // Persist the assistant response
    await this.conversationHistory.addMessage({
      institutionId,
      userId,
      sessionId,
      role: 'ASSISTANT',
      content: fullText,
      contentEs,
      tokenCount: totalTokens,
      modelId: AI_ADVISOR_MODEL,
      latencyMs,
      almModulesReferenced,
    });

    yield { type: 'done' };
  }

  // ─── System prompt builder ──────────────────────────────

  buildSystemPrompt(
    institution: InstitutionContext,
    language: 'es' | 'en' | 'both' = 'both',
  ): string {
    const languageInstruction =
      language === 'both'
        ? `Respond in BOTH English and Spanish. Structure your response with:
## English
(English response here)

## Espanol
(Spanish response here)`
        : language === 'es'
          ? 'Respond entirely in Spanish (Espanol). Use financial terminology appropriate for Puerto Rico cooperativas.'
          : 'Respond entirely in English.';

    return `You are CERNIQ AI Advisor, a bilingual ALM expert for Puerto Rico cooperativas and financial institutions.

## Institution Context
- Name: ${institution.name}
- Type: ${institution.type}
- Total Assets: ${institution.totalAssets}
- Reporting Date: ${institution.reportingDate}
- Regulatory Body: ${institution.regulatoryBody}
${institution.latestMetrics ? `- Latest Metrics: ${JSON.stringify(institution.latestMetrics)}` : ''}

## Your Role
You are a senior Asset-Liability Management advisor. You provide data-driven analysis and recommendations tailored to ${institution.name}'s specific risk profile, regulatory requirements, and strategic objectives.

## Rules
1. NEVER fabricate ALM numbers. Always use the provided tools to query actual institutional data before citing any metrics, ratios, or financial figures.
2. When referencing regulations, cite specific COSSEC or OCIF regulation numbers (e.g., "Ley 255-2002 Art. 43" for net worth requirements).
3. Provide actionable recommendations, not generic advice.
4. If data is unavailable for a specific query, state so clearly rather than guessing.
5. Keep responses focused and CFO/Risk-Manager-level — no jargon definitions needed.
6. ${languageInstruction}

## Available Tools
You have access to ALM data tools. Use them proactively when answering questions about:
- Liquidity, interest rate risk, capital adequacy, credit risk, concentration
- NIM analysis, duration gap, deposit beta calibration
- Regulatory compliance status and exam readiness
- Risk summaries and peer benchmarks`;
  }

  // ─── Institution context loader ─────────────────────────

  async getInstitutionContext(
    institutionId: string,
  ): Promise<InstitutionContext> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: {
        id: true,
        name: true,
        type: true,
        totalAssets: true,
        reportingDate: true,
        regulatoryBody: true,
      },
    });

    if (!institution) {
      throw new NotFoundException(`Institution ${institutionId} not found`);
    }

    // Fetch latest analysis run metrics if available
    let latestMetrics: Record<string, unknown> | undefined;
    try {
      const latestRun = await this.prisma.analysisRun.findFirst({
        where: { institutionId },
        orderBy: { createdAt: 'desc' },
        select: { results: true },
      });
      if (latestRun?.results) {
        latestMetrics = latestRun.results as Record<string, unknown>;
      }
    } catch {
      // Analysis runs may not exist yet — non-fatal.
    }

    return {
      id: institution.id,
      name: institution.name,
      type: institution.type,
      totalAssets: institution.totalAssets.toString(),
      reportingDate: institution.reportingDate.toISOString().slice(0, 10),
      regulatoryBody: institution.regulatoryBody,
      latestMetrics,
    };
  }

  // ─── Private helpers ────────────────────────────────────

  private buildMessages(
    history: ConversationMessage[],
    question: string,
  ): Anthropic.Messages.MessageParam[] {
    const messages: Anthropic.Messages.MessageParam[] = [];

    for (const msg of history) {
      messages.push({
        role: msg.role === 'USER' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    messages.push({ role: 'user', content: question });
    return messages;
  }

  /**
   * Execute a tool call from the LLM. Returns a JSON-serialisable result
   * that gets fed back as a tool_result message.
   */
  private async executeTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const institutionId = (input.institutionId as string) || '';

    switch (toolName) {
      case 'queryAlmModule': {
        const module = input.module as string;
        return this.queryAlmModule(institutionId, module);
      }
      case 'getComplianceStatus':
        return this.getComplianceStatus(institutionId);
      case 'getRiskSummary':
        return this.getRiskSummary(institutionId);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  /**
   * Query ALM module data from the latest analysis run.
   */
  private async queryAlmModule(
    institutionId: string,
    module: string,
  ): Promise<unknown> {
    try {
      const latestRun = await this.prisma.analysisRun.findFirst({
        where: { institutionId },
        orderBy: { createdAt: 'desc' },
        select: { results: true, createdAt: true },
      });

      if (!latestRun?.results) {
        return {
          status: 'no_data',
          message: `No analysis data available for module "${module}". An analysis run must be executed first.`,
        };
      }

      const results = latestRun.results as Record<string, unknown>;
      return {
        module,
        data: results[module] ?? null,
        asOf: latestRun.createdAt.toISOString(),
        status: results[module] ? 'ok' : 'module_not_computed',
      };
    } catch (error) {
      this.logger.error(
        `Error querying ALM module ${module} for ${institutionId}`,
        error,
      );
      return { status: 'error', message: 'Failed to retrieve ALM data.' };
    }
  }

  /**
   * Retrieve compliance status from policy breach logs and institution alerts.
   */
  private async getComplianceStatus(institutionId: string): Promise<unknown> {
    try {
      const [breaches, alerts] = await Promise.all([
        this.prisma.policyBreachLog.findMany({
          where: { institutionId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            metric: true,
            currentValue: true,
            limitValue: true,
            direction: true,
            severity: true,
            createdAt: true,
          },
        }),
        this.prisma.institutionAlert.findMany({
          where: { institutionId, resolvedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            type: true,
            severity: true,
            title: true,
            description: true,
            createdAt: true,
          },
        }),
      ]);

      return {
        activePolicyBreaches: breaches.map(
          (b: {
            metric: string;
            currentValue: { toString(): string } | null;
            limitValue: { toString(): string } | null;
            direction: string;
            severity: string;
            createdAt: Date;
          }) => ({
            metric: b.metric,
            currentValue: b.currentValue?.toString(),
            limitValue: b.limitValue?.toString(),
            direction: b.direction,
            severity: b.severity,
            detectedAt: b.createdAt.toISOString(),
          }),
        ),
        activeAlerts: alerts.map(
          (a: {
            type: string;
            severity: string;
            title: string;
            description: string | null;
            createdAt: Date;
          }) => ({
            type: a.type,
            severity: a.severity,
            title: a.title,
            description: a.description,
            createdAt: a.createdAt.toISOString(),
          }),
        ),
        status: 'ok',
      };
    } catch (error) {
      this.logger.error(
        `Error fetching compliance status for ${institutionId}`,
        error,
      );
      return {
        status: 'error',
        message: 'Failed to retrieve compliance status.',
      };
    }
  }

  /**
   * Get a comprehensive risk summary from the latest analysis run.
   */
  private async getRiskSummary(institutionId: string): Promise<unknown> {
    try {
      const [latestRun, institution] = await Promise.all([
        this.prisma.analysisRun.findFirst({
          where: { institutionId },
          orderBy: { createdAt: 'desc' },
          select: { results: true, createdAt: true },
        }),
        this.prisma.institution.findUnique({
          where: { id: institutionId },
          select: { name: true, type: true, totalAssets: true },
        }),
      ]);

      if (!latestRun?.results) {
        return {
          status: 'no_data',
          message:
            'No analysis data available. An analysis run must be executed first.',
        };
      }

      return {
        institution: {
          name: institution?.name,
          type: institution?.type,
          totalAssets: institution?.totalAssets?.toString(),
        },
        analysisDate: latestRun.createdAt.toISOString(),
        results: latestRun.results,
        status: 'ok',
      };
    } catch (error) {
      this.logger.error(
        `Error fetching risk summary for ${institutionId}`,
        error,
      );
      return { status: 'error', message: 'Failed to retrieve risk summary.' };
    }
  }

  /**
   * Extract the Spanish section from a bilingual response.
   * Looks for "## Espanol" or "## Espa\u00f1ol" header and returns everything after it.
   */
  private extractSpanishSection(text: string): string | undefined {
    const pattern = /##\s*Espa[nñ]ol\s*\n/i;
    const match = pattern.exec(text);
    if (!match) return undefined;
    return text.slice(match.index + match[0].length).trim();
  }
}
