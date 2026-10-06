import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { ComplianceCalendarService } from './compliance-calendar.service';
import { computePromptVersion } from './analyst/prompt-version';
import {
  extractUsage,
  estimateCostCents,
  type LLMUsage,
} from './analyst/llm-usage';

// ─── Types ───────────────────────────────────────────────────

export interface HealthScore {
  overall: number; // 0–100
  capital: number;
  liquidity: number;
  rateRisk: number;
  credit: number;
  concentration: number;
  label: 'STRONG' | 'SATISFACTORY' | 'FAIR' | 'MARGINAL' | 'UNSATISFACTORY';
  // D1: set when the underlying ALM summary could not be computed. Sub-scores
  // are then a conservative placeholder (0 / UNSATISFACTORY), never a
  // fabricated healthy score; consumers should render "—" and surface the gap.
  dataUnavailable?: boolean;
  gaps?: DataGap[];
}

export interface RiskAlert {
  rank: number;
  domain: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  messageEs: string;
  regulatoryRef: string;
  remediation: string;
  remediationEs: string;
}

export interface RegPulse {
  next30: string;
  next60: string;
  next90: string;
  next30Es: string;
  next60Es: string;
  next90Es: string;
  criticalDeadlines: string[];
}

export interface AdvisorNarrative {
  healthScore: HealthScore;
  alerts: RiskAlert[];
  pulse: RegPulse;
  narrative?: string;
}

// ─── System Prompts ──────────────────────────────────────────

const EN_SYSTEM_PROMPT = `You are CERNIQ Analyst, a senior ALM risk advisor for a Puerto Rico financial institution.
Generate a 3-section executive summary:
1. BALANCE SHEET HEALTH SCORE — interpret the 0-100 composite score and its 5 sub-dimensions
2. TOP RISK ALERTS — for each of the top 3 risks, explain the exposure, cite the regulatory requirement, and recommend a specific remediation action
3. REGULATORY PULSE — summarize the next 90 days of compliance deadlines and their implications

Be specific, data-driven, and cite COSSEC/OCIF regulations by number. Write at CFO level — no jargon definitions needed.
Keep the total response under 400 words. Use markdown headers for each section.`;

const ES_SYSTEM_PROMPT = `Eres CERNIQ Analyst, un asesor senior de riesgo ALM para una institución financiera de Puerto Rico.
Genera un resumen ejecutivo de 3 secciones:
1. PUNTUACIÓN DE SALUD DEL BALANCE — interpreta la puntuación compuesta 0-100 y sus 5 sub-dimensiones
2. PRINCIPALES ALERTAS DE RIESGO — para cada una de las 3 principales alertas, explica la exposición, cita el requisito regulatorio y recomienda una acción correctiva específica
3. PULSO REGULATORIO — resume los próximos 90 días de fechas límite de cumplimiento y sus implicaciones

Sé específico, basado en datos, y cita las regulaciones COSSEC/OCIF por número. Escribe a nivel de CFO — sin definiciones de jerga.
Mantén la respuesta total bajo 400 palabras. Usa encabezados markdown para cada sección.`;

// KLYTICS Rule 9 anchor — single source of truth for the model identifier
// that participates in cost estimation + prompt-version fingerprinting. Keep
// in sync with the `model` arg passed to messages.stream below.
const ADVISOR_V2_MODEL = 'claude-sonnet-4-20250514';

@Injectable()
export class AlmAdvisorV2Service {
  private readonly logger = new Logger(AlmAdvisorV2Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly complianceCalendar: ComplianceCalendarService,
  ) {}

  // ─── Health Score Calculator (AGENT-A) ─────────────────────

  async computeHealthScore(institutionId: string): Promise<HealthScore> {
    let summary: any;
    try {
      summary = await this.almEnterprise.getALMSummary(institutionId);
    } catch (err) {
      // D1 + no-silent-failure: a compute failure must not surface as a
      // healthy score. Log it and return a conservative, flagged shell.
      this.logger.warn(
        `getALMSummary failed for ${institutionId}; returning data_unavailable health score: ${(err as Error).message}`,
      );
      return this.dataUnavailableHealthScore();
    }

    const capital = this.scoreCapital(summary);
    const liquidity = this.scoreLiquidity(summary);
    const rateRisk = this.scoreRateRisk(summary);
    const credit = this.scoreCredit(summary);
    const concentration = this.scoreConcentration(summary);
    const overall = capital + liquidity + rateRisk + credit + concentration;

    return {
      overall,
      capital,
      liquidity,
      rateRisk,
      credit,
      concentration,
      label:
        overall >= 80
          ? 'STRONG'
          : overall >= 60
            ? 'SATISFACTORY'
            : overall >= 40
              ? 'FAIR'
              : overall >= 20
                ? 'MARGINAL'
                : 'UNSATISFACTORY',
    };
  }

  // ─── Risk Alert Ranker (AGENT-B) ───────────────────────────

  rankAlerts(health: HealthScore): RiskAlert[] {
    const alerts: RiskAlert[] = [];

    // Score each domain; lowest score = highest risk
    const domains = [
      {
        domain: 'Interest Rate Risk',
        score: health.rateRisk,
        maxScore: 20,
        regRef: 'COSSEC Examen Art. 7.3 — Riesgo de Tasa',
        enMsg:
          'Interest rate sensitivity exceeds prudent levels. EVE/NII exposure requires hedging action.',
        esMsg:
          'La sensibilidad a tasas de interés excede niveles prudentes. La exposición EVE/NII requiere acción de cobertura.',
        enRem:
          'Consider receive-fixed interest rate swaps or ladder CD maturities to reduce duration gap.',
        esRem:
          'Considere swaps de tasa fija o escalone vencimientos de CDs para reducir la brecha de duración.',
      },
      {
        domain: 'Liquidity',
        score: health.liquidity,
        maxScore: 20,
        regRef: 'COSSEC Reglamento — Liquidez Mínima 15%',
        enMsg:
          'Liquidity buffers are below optimal levels. LCR or NSFR approaching regulatory minimum.',
        esMsg:
          'Los colchones de liquidez están por debajo de niveles óptimos. LCR o NSFR acercándose al mínimo regulatorio.',
        enRem:
          'Increase HQLA holdings by shifting $10-25M from non-liquid assets to Treasury bills.',
        esRem:
          'Aumente tenencias HQLA trasladando $10-25M de activos no líquidos a letras del Tesoro.',
      },
      {
        domain: 'Capital Adequacy',
        score: health.capital,
        maxScore: 20,
        regRef: 'NCUA 12 C.F.R. § 702 — Net Worth Requirements',
        enMsg:
          'Capital ratio trending toward minimum well-capitalized threshold.',
        esMsg:
          'La razón de capital tiende hacia el umbral mínimo de bien capitalizada.',
        enRem:
          'Retain earnings above 85% and evaluate supplemental capital offering if NWR < 8%.',
        esRem:
          'Retenga ganancias por encima del 85% y evalúe oferta de capital suplementario si NWR < 8%.',
      },
      {
        domain: 'Credit Quality',
        score: health.credit,
        maxScore: 20,
        regRef: 'OCIF CC-2023-01 — Calidad de Activos',
        enMsg: 'Credit quality indicators show early deterioration signals.',
        esMsg:
          'Los indicadores de calidad crediticia muestran señales tempranas de deterioro.',
        enRem:
          'Review consumer and CRE loan portfolios for early delinquency trends; increase CECL qualitative factors.',
        esRem:
          'Revise carteras de préstamos de consumo y CRE para tendencias tempranas de morosidad; aumente factores cualitativos CECL.',
      },
      {
        domain: 'Concentration Risk',
        score: health.concentration,
        maxScore: 20,
        regRef: 'COSSEC Examen Art. 8.2 — Límites de Concentración',
        enMsg:
          'Portfolio concentration in one or more sectors approaches policy limits.',
        esMsg:
          'La concentración del portafolio en uno o más sectores se acerca a los límites de política.',
        enRem:
          'Diversify new originations away from concentrated sectors; consider participations or loan sales.',
        esRem:
          'Diversifique nuevas originaciones lejos de sectores concentrados; considere participaciones o ventas de préstamos.',
      },
    ];

    // Sort by score ascending (worst first)
    domains.sort((a, b) => a.score - b.score);

    for (let i = 0; i < Math.min(3, domains.length); i++) {
      const d = domains[i];
      const severity =
        d.score < d.maxScore * 0.3
          ? 'HIGH'
          : d.score < d.maxScore * 0.6
            ? 'MEDIUM'
            : 'LOW';
      alerts.push({
        rank: i + 1,
        domain: d.domain,
        severity,
        message: d.enMsg,
        messageEs: d.esMsg,
        regulatoryRef: d.regRef,
        remediation: d.enRem,
        remediationEs: d.esRem,
      });
    }

    return alerts;
  }

  // ─── Regulatory Pulse Builder (AGENT-C) ────────────────────

  async buildRegPulse(institutionId: string): Promise<RegPulse> {
    let deadlines: any[];
    try {
      const calendarResult =
        await this.complianceCalendar.getUpcomingDeadlines(institutionId);
      deadlines = calendarResult.events;
    } catch {
      deadlines = [];
    }

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in60 = new Date(now.getTime() + 60 * 86400000);
    const in90 = new Date(now.getTime() + 90 * 86400000);

    const next30Items = deadlines.filter(
      (d: any) => new Date(d.deadlineDate) <= in30,
    );
    const next60Items = deadlines.filter(
      (d: any) =>
        new Date(d.deadlineDate) > in30 && new Date(d.deadlineDate) <= in60,
    );
    const next90Items = deadlines.filter(
      (d: any) =>
        new Date(d.deadlineDate) > in60 && new Date(d.deadlineDate) <= in90,
    );

    const formatItems = (items: any[], lang: 'en' | 'es') =>
      items.length === 0
        ? lang === 'es'
          ? 'Sin fechas límite pendientes en este período.'
          : 'No deadlines in this period.'
        : items
            .map(
              (d: any) =>
                `${lang === 'es' ? d.titleEs || d.title : d.title} (${new Date(d.deadlineDate).toLocaleDateString()})`,
            )
            .join('; ');

    const critical = deadlines
      .filter((d: any) => d.urgency === 'CRITICAL' || d.urgency === 'OVERDUE')
      .map((d: any) => d.title);

    return {
      next30: formatItems(next30Items, 'en'),
      next60: formatItems(next60Items, 'en'),
      next90: formatItems(next90Items, 'en'),
      next30Es: formatItems(next30Items, 'es'),
      next60Es: formatItems(next60Items, 'es'),
      next90Es: formatItems(next90Items, 'es'),
      criticalDeadlines: critical,
    };
  }

  // ─── Narrative Synthesizer (AGENT-D) — SSE Streaming ───────

  async *streamNarrative(
    institutionId: string,
    lang: string,
  ): AsyncGenerator<string> {
    const [health, pulse] = await Promise.all([
      this.computeHealthScore(institutionId),
      this.buildRegPulse(institutionId),
    ]);
    const alerts = this.rankAlerts(health);

    // Try Claude/OpenAI API if available
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (apiKey && process.env.ANTHROPIC_API_KEY) {
      yield* this.streamFromAnthropic(health, alerts, pulse, lang);
      return;
    }

    // Fallback: generate structured narrative locally
    yield* this.generateLocalNarrative(health, alerts, pulse, lang);
  }

  async getStaticNarrative(
    institutionId: string,
    lang: string,
  ): Promise<AdvisorNarrative> {
    const health = await this.computeHealthScore(institutionId);
    const alerts = this.rankAlerts(health);
    const pulse = await this.buildRegPulse(institutionId);

    let narrative = '';
    for await (const token of this.generateLocalNarrative(
      health,
      alerts,
      pulse,
      lang,
    )) {
      narrative += token;
    }

    return { healthScore: health, alerts, pulse, narrative };
  }

  // ─── Private: Anthropic Streaming ──────────────────────────

  private async *streamFromAnthropic(
    health: HealthScore,
    alerts: RiskAlert[],
    pulse: RegPulse,
    lang: string,
  ): AsyncGenerator<string> {
    try {
      // Under `module: "nodenext"`, ts-node types `(await import(...)).default`
      // as the whole module namespace rather than the default-exported class,
      // which breaks constructability. We cast the module shape explicitly so
      // both tsc --noEmit and ts-node agree on the construct signature.
      type AnthropicCtor = new (opts?: { apiKey?: string }) => {
        messages: {
          stream: (opts: Record<string, unknown>) => AsyncIterable<{
            type: string;
            delta?: { type: string; text?: string };
          }>;
        };
      };
      const sdk = (await import('@anthropic-ai/sdk')) as unknown as {
        default: AnthropicCtor;
      };
      const client = new sdk.default({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const systemPrompt = lang === 'es' ? ES_SYSTEM_PROMPT : EN_SYSTEM_PROMPT;
      // KLYTICS Rule 9: fingerprint the (model, systemPrompt) tuple before the
      // call so any drift in system-prompt wording or model swap is detectable
      // in the audit log. Mirrors the analyst-panel pattern from d1d42e97.
      const promptVersion = computePromptVersion({
        model: ADVISOR_V2_MODEL,
        systemPrompt,
      });
      const userContent = JSON.stringify({
        healthScore: health,
        riskAlerts: alerts.map((a) => ({
          rank: a.rank,
          domain: a.domain,
          severity: a.severity,
          message: lang === 'es' ? a.messageEs : a.message,
          regulatoryRef: a.regulatoryRef,
        })),
        regulatoryPulse: {
          next30: lang === 'es' ? pulse.next30Es : pulse.next30,
          next60: lang === 'es' ? pulse.next60Es : pulse.next60,
          next90: lang === 'es' ? pulse.next90Es : pulse.next90,
          critical: pulse.criticalDeadlines,
        },
      });

      const stream = client.messages.stream({
        model: ADVISOR_V2_MODEL,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });

      // KLYTICS Rule 9 usage tracking for streaming. Anthropic SSE emits
      // input/cache tokens in `message_start` and final `output_tokens` in
      // `message_delta`; we collect both for an accurate four-class snapshot.
      let initialUsage: LLMUsage | null = null;
      let finalOutputTokens: number | null = null;

      for await (const event of stream) {
        if (event.type === 'message_start') {
          // type-rationale: Anthropic SDK's MessageStreamEvent discriminated union narrows here to RawMessageStartEvent, but the `.message` property's type is not exported as a callable shape compatible with extractUsage's input. Cast to any to access `.message.usage` — extractUsage internally guards against nulls (Rule 1).
          initialUsage = extractUsage((event as any).message);
        } else if (event.type === 'message_delta') {
          // type-rationale: Anthropic SDK's MessageDeltaEvent declares `.usage` as `MessageDeltaUsage` (output_tokens only), but at runtime the SDK sometimes emits it as `null` or with additional fields. Cast to any so the optional-chain access below survives both shapes — runtime guards (`typeof evUsage?.output_tokens === 'number'`) prevent silent-zero.
          const evUsage = (event as any).usage;
          if (typeof evUsage?.output_tokens === 'number') {
            finalOutputTokens = evUsage.output_tokens;
          }
        } else if (
          event.type === 'content_block_delta' &&
          (event as any).delta?.text
        ) {
          // type-rationale: Anthropic SDK's content_block_delta event narrows to RawContentBlockDeltaEvent here, but the `.delta` field's discriminated union (TextDelta | InputJSONDelta | ...) doesn't cleanly project to a single `.text` access without exhaustive narrowing. Cast to any so the chained `.delta.text` works for both text and tool-use variants — runtime guard above gates the yield, mirrors the existing two-event-cast pattern in this loop.
          yield (event as any).delta.text;
        }
      }

      // Compose final usage from message_start (input + cache) + message_delta
      // (final output count). Skip the stamp if no usage was observed — never
      // silent-zero (Rule 1 composes with Rule 9).
      const usage: LLMUsage | null =
        initialUsage && finalOutputTokens !== null
          ? { ...initialUsage, outputTokens: finalOutputTokens }
          : initialUsage;
      const costEstimate = usage
        ? estimateCostCents(ADVISOR_V2_MODEL, usage)
        : null;
      this.logger.log({
        event: 'rule-9-stamp',
        surface: 'alm-advisor-v2.streamFromAnthropic',
        lang,
        model: ADVISOR_V2_MODEL,
        promptVersion,
        usage,
        costCents: costEstimate?.cents ?? null,
        ...(costEstimate && 'pricingVersion' in costEstimate
          ? { pricingVersion: costEstimate.pricingVersion }
          : {
              costMissingReason:
                'reason' in (costEstimate ?? {})
                  ? // type-rationale: estimateCostCents returns a discriminated union — either `{ cents, pricingVersion, model }` (priced) or `{ cents: null, reason, model }` (unknown-model fallback per Rule 1). The `'reason' in ...` narrow above proves we're in the fallback branch, but TS doesn't propagate that narrowing through the conditional spread. Cast to any to read `.reason` cleanly.
                    (costEstimate as any).reason
                  : null,
            }),
      });
    } catch (err) {
      this.logger.warn(
        `Anthropic streaming failed, falling back to local narrative: ${err}`,
      );
      yield* this.generateLocalNarrative(
        health,
        alerts.length > 0 ? ([alerts[0]] as any) : [],
        {} as any,
        lang,
      );
    }
  }

  // ─── Private: Local Narrative Generator ────────────────────

  private async *generateLocalNarrative(
    health: HealthScore,
    alerts: RiskAlert[],
    pulse: RegPulse,
    lang: string,
  ): AsyncGenerator<string> {
    const isEs = lang === 'es';
    const delay = () => new Promise((r) => setTimeout(r, 15)); // Simulate streaming

    // Section 1: Health Score
    const s1Header = isEs
      ? '## Puntuación de Salud del Balance\n\n'
      : '## Balance Sheet Health Score\n\n';
    yield s1Header;
    await delay();

    const scoreLabel = isEs
      ? {
          STRONG: 'Fuerte',
          SATISFACTORY: 'Satisfactorio',
          FAIR: 'Regular',
          MARGINAL: 'Marginal',
          UNSATISFACTORY: 'Insatisfactorio',
        }
      : {
          STRONG: 'Strong',
          SATISFACTORY: 'Satisfactory',
          FAIR: 'Fair',
          MARGINAL: 'Marginal',
          UNSATISFACTORY: 'Unsatisfactory',
        };

    const s1Body = isEs
      ? `La institución presenta una puntuación compuesta de **${health.overall}/100** (${scoreLabel[health.label]}). Capital: ${health.capital}/20, Liquidez: ${health.liquidity}/20, Riesgo de Tasa: ${health.rateRisk}/20, Crédito: ${health.credit}/20, Concentración: ${health.concentration}/20.\n\n`
      : `The institution presents a composite score of **${health.overall}/100** (${scoreLabel[health.label]}). Capital: ${health.capital}/20, Liquidity: ${health.liquidity}/20, Rate Risk: ${health.rateRisk}/20, Credit: ${health.credit}/20, Concentration: ${health.concentration}/20.\n\n`;

    for (const chunk of s1Body.match(/.{1,8}/g) ?? []) {
      yield chunk;
      await delay();
    }

    // Section 2: Risk Alerts
    const s2Header = isEs
      ? '## Principales Alertas de Riesgo\n\n'
      : '## Top Risk Alerts\n\n';
    yield s2Header;
    await delay();

    for (const alert of alerts) {
      const alertText = isEs
        ? `**${alert.rank}. ${alert.domain}** (${alert.severity}) — ${alert.messageEs} _Ref: ${alert.regulatoryRef}._ **Acción:** ${alert.remediationEs}\n\n`
        : `**${alert.rank}. ${alert.domain}** (${alert.severity}) — ${alert.message} _Ref: ${alert.regulatoryRef}._ **Action:** ${alert.remediation}\n\n`;
      for (const chunk of alertText.match(/.{1,10}/g) ?? []) {
        yield chunk;
        await delay();
      }
    }

    // Section 3: Regulatory Pulse
    const s3Header = isEs
      ? '## Pulso Regulatorio — Próximos 90 Días\n\n'
      : '## Regulatory Pulse — Next 90 Days\n\n';
    yield s3Header;
    await delay();

    const s3Body = isEs
      ? `**Próximos 30 días:** ${pulse.next30Es}\n**30–60 días:** ${pulse.next60Es}\n**60–90 días:** ${pulse.next90Es}\n`
      : `**Next 30 days:** ${pulse.next30}\n**30–60 days:** ${pulse.next60}\n**60–90 days:** ${pulse.next90}\n`;

    for (const chunk of s3Body.match(/.{1,10}/g) ?? []) {
      yield chunk;
      await delay();
    }

    if (pulse.criticalDeadlines.length > 0) {
      const criticalText = isEs
        ? `\n⚠️ **Fechas críticas:** ${pulse.criticalDeadlines.join(', ')}\n`
        : `\n⚠️ **Critical deadlines:** ${pulse.criticalDeadlines.join(', ')}\n`;
      yield criticalText;
    }
  }

  // ─── Scoring Sub-Functions (each 0–20) ────────────────────

  private scoreCapital(summary: any): number {
    const nwr =
      (summary?.capitalRatio ?? summary?.riskScore)
        ? ((100 - (summary.riskScore ?? 50)) / 100) * 0.12
        : 0.09;
    if (nwr >= 0.1) return 20;
    if (nwr >= 0.08) return 16;
    if (nwr >= 0.07) return 12;
    if (nwr >= 0.06) return 8;
    if (nwr >= 0.04) return 4;
    return 0;
  }

  private scoreLiquidity(summary: any): number {
    const lcr = summary?.liquidity?.lcr ?? 115;
    if (lcr >= 130) return 20;
    if (lcr >= 115) return 16;
    if (lcr >= 100) return 12;
    if (lcr >= 90) return 8;
    return 4;
  }

  private scoreRateRisk(summary: any): number {
    const durationGap = Math.abs(summary?.durationGap?.durationGap ?? 2.0);
    if (durationGap <= 1.0) return 20;
    if (durationGap <= 2.0) return 16;
    if (durationGap <= 3.0) return 12;
    if (durationGap <= 4.0) return 8;
    return 4;
  }

  private scoreCredit(summary: any): number {
    // Use risk score if available (lower = better quality, confusingly)
    const riskScore = summary?.riskScore ?? 50;
    if (riskScore <= 30) return 20;
    if (riskScore <= 50) return 16;
    if (riskScore <= 65) return 12;
    if (riskScore <= 80) return 8;
    return 4;
  }

  private scoreConcentration(_summary: any): number {
    // Default to moderate if no data
    return 14; // Placeholder — upgraded when ConcentrationService data is available
  }

  // D1 honest shell. Replaces the former getDemoHealthScore() that returned a
  // fabricated 72 / SATISFACTORY when the ALM summary failed to compute —
  // hiding a failure behind a healthy-looking score. Conservative + flagged.
  private dataUnavailableHealthScore(): HealthScore {
    return {
      overall: 0,
      capital: 0,
      liquidity: 0,
      rateRisk: 0,
      credit: 0,
      concentration: 0,
      label: 'UNSATISFACTORY',
      dataUnavailable: true,
      gaps: [
        dataGap('advisor.healthScore', 'CALCULATION_FAILED', {
          severity: 'CRITICAL',
          action:
            'No se pudo calcular el resumen ALM. Verifique que el balance, la liquidez y los segmentos estén cargados.',
          context: { service: 'alm-advisor-v2' },
        }),
      ],
    };
  }
}
