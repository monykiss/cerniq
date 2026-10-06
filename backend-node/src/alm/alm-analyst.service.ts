import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { PeerAnalyticsService } from './peer-analytics.service';
import { computePromptVersion } from './analyst/prompt-version';
import {
  extractUsage,
  mergeUsage,
  estimateCostCents,
  type LLMUsage,
} from './analyst/llm-usage';

const ANALYST_MODEL = 'claude-sonnet-4-20250514';

// ─── Bible Vol2 §9.3: CERNIQ Analyst — 4-tool Claude integration ────────
//
// System prompt injects institution's 12 COSSEC ratios + NIM sensitivity.
// 4 Claude tools: get_ratios, get_nim_sensitivity, get_peer_benchmarks,
//                 get_regulatory_thresholds
// 20-query daily rate limit per institution.
// Spanish-first, bilingual responses.
// SSE streaming token-by-token.

// ─── COSSEC Regulatory Thresholds ───────────────────────────────────────

const COSSEC_THRESHOLDS: Record<
  string,
  { min: number; unit: string; ref: string; nameEs: string }
> = {
  nwr: {
    min: 6,
    unit: '%',
    ref: 'Ley 255-2002 Art. 43',
    nameEs: 'Razón de Capital Neto (NWR)',
  },
  lcr: {
    min: 100,
    unit: '%',
    ref: 'COSSEC Reglamento — Liquidez Mínima',
    nameEs: 'Razón de Cobertura de Liquidez (LCR)',
  },
  nim: {
    min: 2.5,
    unit: '%',
    ref: 'COSSEC Examen Art. 5.2',
    nameEs: 'Margen de Interés Neto (NIM)',
  },
  ncr: {
    min: 0,
    unit: '%',
    ref: 'OCIF CC-2023-01 — Morosidad',
    nameEs: 'Razón de Morosidad (NCR)',
  },
  coverage: {
    min: 100,
    unit: '%',
    ref: 'COSSEC Examen Art. 6.1',
    nameEs: 'Razón de Cobertura de Provisión',
  },
  roa: {
    min: 0.5,
    unit: '%',
    ref: 'COSSEC Examen Art. 4.3',
    nameEs: 'Rendimiento sobre Activos (ROA)',
  },
  concentration: {
    min: 0,
    unit: '%',
    ref: 'COSSEC Examen Art. 8.2',
    nameEs: 'Razón de Concentración',
  },
  durationGap: {
    min: 0,
    unit: 'yrs',
    ref: 'COSSEC Examen Art. 7.3',
    nameEs: 'Brecha de Duración',
  },
  niiSensitivity: {
    min: 0,
    unit: '%',
    ref: 'COSSEC Examen Art. 7.4',
    nameEs: 'Sensibilidad NII (±200bps)',
  },
};

// ─── PR Cooperative Sector Averages (COSSEC Q4 2025) ────────────────────

const SECTOR_AVERAGES: Record<string, number> = {
  nwr: 9.2,
  lcr: 142,
  nim: 3.85,
  ncr: 2.1,
  coverage: 128,
  roa: 0.78,
  concentration: 24,
  durationGap: 1.8,
  niiSensitivity: 5.2,
};

// ─── Claude Tool Definitions ────────────────────────────────────────────

export const ANALYST_CLAUDE_TOOLS = [
  {
    name: 'get_ratios',
    description:
      'Obtiene los indicadores CAMEL actuales de la institución con su valor, umbral COSSEC, y estado.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_nim_sensitivity',
    description:
      'Obtiene la tabla de sensibilidad de NIM bajo diferentes escenarios de tasas (+100, +200, +300, -100, -200 bps).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_peer_benchmarks',
    description:
      'Obtiene promedios del sector cooperativo de PR supervisado por COSSEC para comparación.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_regulatory_thresholds',
    description:
      'Obtiene los umbrales mínimos de COSSEC para cada indicador, incluyendo la referencia legal.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
];

// ─── Types ──────────────────────────────────────────────────────────────

export interface AnalystSSEEvent {
  type: 'token' | 'tool_use' | 'done' | 'error' | 'rate_limited';
  text?: string;
  name?: string;
  message?: string;
  queriesUsed?: number;
  queriesMax?: number;
  /** Set on `done` events from real LLM paths; absent from local fallback. */
  promptVersion?: string;
  /**
   * Accumulated token usage across all LLM calls in this turn (initial +
   * tool-use iterations). Null when no usage block was returned (SDK error,
   * mock). Absent from local-fallback `done` events.
   */
  usage?: LLMUsage | null;
  /**
   * Cost estimate in cents (stringified Decimal, 4 dp). Null when pricing
   * data for the model isn't authoritative — Rule 1 discipline: never
   * silent-zero an unknown cost.
   */
  costCents?: string | null;
  /** Pinning stamp for the pricing table used to compute `costCents`. */
  pricingVersion?: string;
}

export interface RatioSnapshot {
  key: string;
  nameEs: string;
  value: number | null;
  threshold: number;
  unit: string;
  status: 'CUMPLE' | 'ALERTA' | 'INCUMPLE' | 'NO_DISPONIBLE';
  gap: number | null;
  regulatoryRef: string;
  sectorAverage: number;
}

// ─── Service ────────────────────────────────────────────────────────────

@Injectable()
export class AlmAnalystService {
  private readonly logger = new Logger(AlmAnalystService.name);
  private readonly dailyCounts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly peerAnalytics: PeerAnalyticsService,
  ) {}

  // ─── Rate Limit ───────────────────────────────────────────────────────

  private getDailyKey(institutionId: string): string {
    const today = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' })
      .slice(0, 10);
    return `${institutionId}:${today}`;
  }

  checkRateLimit(institutionId: string): {
    allowed: boolean;
    used: number;
    max: number;
  } {
    const key = this.getDailyKey(institutionId);
    const used = this.dailyCounts.get(key) ?? 0;
    return { allowed: used < 20, used, max: 20 };
  }

  private incrementRateLimit(institutionId: string): void {
    const key = this.getDailyKey(institutionId);
    this.dailyCounts.set(key, (this.dailyCounts.get(key) ?? 0) + 1);

    // Prune old keys to prevent memory leak
    const todayPrefix = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' })
      .slice(0, 10);
    for (const k of this.dailyCounts.keys()) {
      if (!k.endsWith(todayPrefix)) this.dailyCounts.delete(k);
    }
  }

  getRateLimitStatus(institutionId: string): {
    used: number;
    max: number;
    remaining: number;
  } {
    const { used, max } = this.checkRateLimit(institutionId);
    return { used, max, remaining: max - used };
  }

  // ─── Tool Handlers ────────────────────────────────────────────────────

  async fetchRatios(institutionId: string): Promise<RatioSnapshot[]> {
    const cossec = await this.almEnterprise.getCOSSECCompliance(institutionId);

    if (cossec.overallStatus === 'data_unavailable') {
      return Object.entries(COSSEC_THRESHOLDS).map(([key, t]) => ({
        key,
        nameEs: t.nameEs,
        value: null,
        threshold: t.min,
        unit: t.unit,
        status: 'NO_DISPONIBLE' as const,
        gap: null,
        regulatoryRef: t.ref,
        sectorAverage: SECTOR_AVERAGES[key] ?? 0,
      }));
    }

    const ratioMap: Record<string, number | null> = {};
    for (const r of cossec.ratios ?? []) {
      ratioMap[this.normalizeRatioKey(r.name)] = r.value;
    }

    return Object.entries(COSSEC_THRESHOLDS).map(([key, t]) => {
      const value = ratioMap[key] ?? null;
      let status: RatioSnapshot['status'] = 'NO_DISPONIBLE';
      let gap: number | null = null;

      if (value !== null) {
        if (key === 'ncr') {
          status = value <= 5 ? 'CUMPLE' : value <= 8 ? 'ALERTA' : 'INCUMPLE';
          gap = value - 5;
        } else {
          status =
            value >= t.min
              ? 'CUMPLE'
              : value >= t.min * 0.85
                ? 'ALERTA'
                : 'INCUMPLE';
          gap = value - t.min;
        }
      }

      return {
        key,
        nameEs: t.nameEs,
        value,
        threshold: t.min,
        unit: t.unit,
        status,
        gap,
        regulatoryRef: t.ref,
        sectorAverage: SECTOR_AVERAGES[key] ?? 0,
      };
    });
  }

  async fetchNIISensitivity(
    institutionId: string,
  ): Promise<Record<string, any>> {
    const summary = await this.almEnterprise.getALMSummary(institutionId);
    const nii = summary.niiSensitivity;
    if (!nii?.scenarios)
      return {
        status: 'data_unavailable',
        message: 'No hay datos de sensibilidad NII.',
      };

    return {
      baseNII: nii.baseNII,
      riskRating: nii.riskRating,
      scenarios: nii.scenarios.map((s: any) => ({
        shiftBps: s.shiftBps,
        niiChange: s.niImpact,
        niiChangePct: s.niImpactPct,
      })),
      bpValue: (() => {
        const s200 = nii.scenarios.find((s: any) => s.shiftBps === 200);
        return s200 ? s200.niImpact / 200 : null;
      })(),
    };
  }

  fetchPeerBenchmarks(): Record<string, any> {
    return {
      source: 'COSSEC Q4 2025 — Sector Cooperativo PR',
      benchmarks: Object.entries(SECTOR_AVERAGES).map(([key, value]) => ({
        indicator: COSSEC_THRESHOLDS[key]?.nameEs ?? key,
        sectorAverage: value,
        unit: COSSEC_THRESHOLDS[key]?.unit ?? '',
      })),
    };
  }

  fetchRegulatoryThresholds(): Record<string, any> {
    return {
      source: 'COSSEC Reglamento + Ley 255-2002',
      thresholds: Object.entries(COSSEC_THRESHOLDS).map(([key, t]) => ({
        indicator: t.nameEs,
        minimum: t.min,
        unit: t.unit,
        regulatoryReference: t.ref,
      })),
    };
  }

  // ─── Tool Dispatcher ──────────────────────────────────────────────────

  async executeTool(institutionId: string, toolName: string): Promise<string> {
    switch (toolName) {
      case 'get_ratios':
        return JSON.stringify(await this.fetchRatios(institutionId), null, 2);
      case 'get_nim_sensitivity':
        return JSON.stringify(
          await this.fetchNIISensitivity(institutionId),
          null,
          2,
        );
      case 'get_peer_benchmarks':
        return JSON.stringify(this.fetchPeerBenchmarks(), null, 2);
      case 'get_regulatory_thresholds':
        return JSON.stringify(this.fetchRegulatoryThresholds(), null, 2);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  }

  // ─── System Prompt ────────────────────────────────────────────────────

  async buildSystemPrompt(institutionId: string): Promise<string> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    const ratios = await this.fetchRatios(institutionId);

    const instName = institution?.name ?? 'Institución';
    const today = new Date().toLocaleDateString('es-PR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Puerto_Rico',
    });

    const ratioBlock = ratios
      .map(
        (r) =>
          `- ${r.nameEs}: ${r.value !== null ? `${r.value}${r.unit}` : 'NO DISPONIBLE'} ` +
          `(mínimo: ${r.threshold}${r.unit}, sector: ${r.sectorAverage}${r.unit}, estado: ${r.status})`,
      )
      .join('\n');

    const failRatios = ratios.filter((r) => r.status === 'INCUMPLE');
    const failBlock =
      failRatios.length > 0
        ? failRatios
            .map(
              (r) =>
                `⚠ ${r.nameEs}: ${r.value}${r.unit} — incumple ${r.threshold}${r.unit} por ${Math.abs(r.gap ?? 0).toFixed(2)}${r.unit}. ${r.regulatoryRef}`,
            )
            .join('\n')
        : 'Todos los indicadores cumplen.';

    return `Eres CERNIQ Analyst, asesor senior de riesgo ALM para instituciones de Puerto Rico supervisadas por COSSEC.

INSTITUCIÓN: ${instName}
FECHA: ${today}

INDICADORES ACTUALES:
${ratioBlock}

INCUMPLIMIENTOS:
${failBlock}

REGLAS:
- SIEMPRE cita la regulación exacta de COSSEC u OCIF.
- NUNCA especules sin datos.
- SIEMPRE da una recomendación accionable al final.
- Responde en español a menos que el usuario escriba en inglés.
- Usa los datos reales, no inventes números.
- Sé específico y conciso. Nivel CFO.`;
  }

  // ─── Main SSE Streaming Handler ───────────────────────────────────────

  async *processMessage(
    institutionId: string,
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }> = [],
  ): AsyncGenerator<AnalystSSEEvent> {
    const rl = this.checkRateLimit(institutionId);
    if (!rl.allowed) {
      yield {
        type: 'rate_limited',
        message:
          'Ha alcanzado el límite de 20 consultas diarias. El límite se restablece a medianoche hora de Puerto Rico.',
        queriesUsed: rl.used,
        queriesMax: rl.max,
      };
      return;
    }

    this.incrementRateLimit(institutionId);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      yield* this.localFallback(institutionId, userMessage);
      return;
    }

    try {
      const systemPrompt = await this.buildSystemPrompt(institutionId);
      const promptVersion = computePromptVersion({
        model: ANALYST_MODEL,
        systemPrompt,
        tools: ANALYST_CLAUDE_TOOLS,
      });
      type AnthropicCtor = new (opts?: { apiKey?: string }) => {
        messages: { create: (opts: Record<string, unknown>) => Promise<any> };
      };
      const sdk = (await import('@anthropic-ai/sdk')) as unknown as {
        default: AnthropicCtor;
      };
      const client = new sdk.default({ apiKey });

      const messages: Array<{ role: string; content: any }> = [];
      for (const msg of conversationHistory.slice(-18)) {
        messages.push({ role: msg.role, content: msg.content });
      }
      messages.push({ role: 'user', content: userMessage });

      let response = await (client.messages.create as any)({
        model: ANALYST_MODEL,
        max_tokens: 1000,
        system: systemPrompt,
        tools: ANALYST_CLAUDE_TOOLS,
        messages,
      });
      let totalUsage: LLMUsage | null = extractUsage(response);

      for (let toolIter = 0; toolIter < 3; toolIter++) {
        if (response.stop_reason !== 'tool_use') break;

        for (const block of response.content) {
          if (block.type === 'text' && block.text) {
            yield { type: 'token', text: block.text };
          }
        }

        const toolUseBlocks = response.content.filter(
          (b: any) => b.type === 'tool_use',
        );
        const toolResults: any[] = [];
        for (const toolBlock of toolUseBlocks) {
          yield { type: 'tool_use', name: toolBlock.name };
          const result = await this.executeTool(institutionId, toolBlock.name);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        response = await (client.messages.create as any)({
          model: ANALYST_MODEL,
          max_tokens: 1000,
          system: systemPrompt,
          tools: ANALYST_CLAUDE_TOOLS,
          messages,
        });
        totalUsage = mergeUsage(totalUsage, extractUsage(response));
      }

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          const chunks = block.text.match(/.{1,12}/gs) ?? [block.text];
          for (const chunk of chunks) {
            yield { type: 'token', text: chunk };
          }
        }
      }

      const costEstimate = totalUsage
        ? estimateCostCents(ANALYST_MODEL, totalUsage)
        : null;
      yield {
        type: 'done',
        queriesUsed: this.checkRateLimit(institutionId).used,
        queriesMax: 20,
        promptVersion,
        usage: totalUsage,
        costCents: costEstimate?.cents ?? null,
        ...(costEstimate && 'pricingVersion' in costEstimate
          ? { pricingVersion: costEstimate.pricingVersion }
          : {}),
      };
    } catch (err: any) {
      this.logger.error(`Analyst streaming failed: ${err.message}`, err.stack);
      yield { type: 'error', message: err.message };
    }
  }

  // ─── Local Fallback (no Anthropic key) ────────────────────────────────

  private async *localFallback(
    institutionId: string,
    userMessage: string,
  ): AsyncGenerator<AnalystSSEEvent> {
    const ratios = await this.fetchRatios(institutionId);
    const nii = await this.fetchNIISensitivity(institutionId);

    const failRatios = ratios.filter((r) => r.status === 'INCUMPLE');
    const warnRatios = ratios.filter((r) => r.status === 'ALERTA');

    let text = '';
    const isRateQuestion = /tasa|rate|bps|punto/i.test(userMessage);

    if (isRateQuestion && nii.scenarios) {
      const s200 = nii.scenarios.find((s: any) => s.shiftBps === 200);
      text = `Bajo un escenario de **+200bps**, el NII cambiaría **$${s200?.niiChange?.toFixed(2) ?? '?'}M** (${s200?.niiChangePct?.toFixed(2) ?? '?'}%).`;
      if (nii.bpValue) {
        text += ` Cada bp = **$${nii.bpValue.toFixed(0)}** en NII anual.`;
      }
      text += `\n\n*Ref: ${COSSEC_THRESHOLDS.niiSensitivity.ref}*`;
    } else if (failRatios.length > 0) {
      text = `**Indicadores en incumplimiento:**\n\n`;
      for (const r of failRatios) {
        text += `- **${r.nameEs}**: ${r.value}${r.unit} (mín: ${r.threshold}${r.unit}). *${r.regulatoryRef}*\n`;
      }
      text += `\n**Recomendación:** Corrija antes de la próxima revisión COSSEC.`;
    } else {
      text = `Indicadores principales:\n\n`;
      for (const r of ratios.slice(0, 6)) {
        text += `- **${r.nameEs}**: ${r.value !== null ? `${r.value}${r.unit}` : 'No disponible'} — ${r.status}\n`;
      }
      if (warnRatios.length > 0) {
        text += `\n⚠ ${warnRatios.length} indicador(es) en alerta.`;
      }
    }

    const chunks = text.match(/.{1,12}/gs) ?? [text];
    for (const chunk of chunks) {
      yield { type: 'token', text: chunk };
    }
    yield {
      type: 'done',
      queriesUsed: this.checkRateLimit(institutionId).used,
      queriesMax: 20,
    };
  }

  // ─── Save Insight ─────────────────────────────────────────────────────

  async saveInsight(
    institutionId: string,
    message: string,
    savedBy: string,
    tags: string[] = [],
    promptVersion?: string,
    usage?: LLMUsage | null,
    costCents?: string | null,
    pricingVersion?: string,
  ): Promise<{ id: string }> {
    const metadata: Record<string, unknown> = {
      source: 'cerniq_analyst',
      savedAt: new Date().toISOString(),
    };
    if (promptVersion !== undefined) {
      metadata.promptVersion = promptVersion;
    }
    if (usage !== undefined) {
      metadata.usage = usage;
    }
    if (costCents !== undefined) {
      metadata.costCents = costCents;
    }
    if (pricingVersion !== undefined) {
      metadata.pricingVersion = pricingVersion;
    }
    const log = await this.prisma.auditLog.create({
      data: {
        userId: savedBy,
        institutionId,
        action: 'analyst_insight_saved',
        resource: 'analyst_insight',
        outcome: 'success',
        changes: { message, tags },
        metadata,
      },
    });
    return { id: log.id };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private normalizeRatioKey(name: string): string {
    const n = name.toLowerCase().replace(/[^a-z]/g, '');
    if (n.includes('networth') || n.includes('nwr') || n.includes('capital'))
      return 'nwr';
    if (n.includes('lcr') || n.includes('liquidity')) return 'lcr';
    if (n.includes('nim') || n.includes('margin')) return 'nim';
    if (n.includes('noncurrent') || n.includes('ncr') || n.includes('delinq'))
      return 'ncr';
    if (n.includes('coverage') || n.includes('provision')) return 'coverage';
    if (n.includes('roa') || n.includes('returnasset')) return 'roa';
    if (n.includes('concentration') || n.includes('concentra'))
      return 'concentration';
    if (n.includes('duration') || n.includes('duracion')) return 'durationGap';
    if (n.includes('nii') || n.includes('sensitivity')) return 'niiSensitivity';
    return n;
  }
}
