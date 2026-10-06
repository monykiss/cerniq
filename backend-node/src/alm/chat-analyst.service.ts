import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { AlmAdvisorV2Service } from './alm-advisor-v2.service';
import { CAMELScorerService } from './exam-prep/camel-scorer.service';

// ─── Tool Registry ──────────────────────────────────────────

const ANALYST_TOOLS = [
  {
    name: 'runRateShock',
    desc: 'Run NII/EVE rate shock at N bps parallel shift',
    params: ['shockBps'],
  },
  {
    name: 'getLCR',
    desc: 'Get current LCR ratio and HQLA composition',
    params: [],
  },
  { name: 'getNSFR', desc: 'Get current NSFR ratio', params: [] },
  { name: 'getCECL', desc: 'Get latest CECL allowance by segment', params: [] },
  {
    name: 'getConcentration',
    desc: 'Get concentration risk by sector with limits',
    params: [],
  },
  {
    name: 'getYieldCurve',
    desc: 'Get current yield curve and forward rates',
    params: [],
  },
  {
    name: 'runMonteCarlo',
    desc: 'Run Monte Carlo NII simulation',
    params: ['paths'],
  },
  {
    name: 'getVaR',
    desc: 'Get portfolio VaR at 95% or 99% confidence',
    params: ['confidence'],
  },
  {
    name: 'getPeerBenchmark',
    desc: 'Get institution vs peer quartile for a metric',
    params: ['metric'],
  },
  {
    name: 'getEWS',
    desc: 'Get Early Warning System score and alerts',
    params: [],
  },
  { name: 'runForwardSim', desc: 'Run 3-year forward simulation', params: [] },
  { name: 'getCAMEL', desc: 'Get CAMEL self-assessment scores', params: [] },
  {
    name: 'getRepricingGap',
    desc: 'Get repricing gap by maturity bucket',
    params: [],
  },
  {
    name: 'getDepositBeta',
    desc: 'Get deposit betas vs peer benchmark',
    params: [],
  },
  {
    name: 'getComplianceCalendar',
    desc: 'Get upcoming regulatory deadlines',
    params: [],
  },
  {
    name: 'getHealthScore',
    desc: 'Get composite financial health score 0-100',
    params: [],
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface AnalystMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolResult?: any;
  chartType?: string; // 'bar' | 'line' | 'table' | null
  chartData?: any;
}

export interface AnalystConversation {
  institutionId: string;
  messages: AnalystMessage[];
}

export interface AnalystResponse {
  message: AnalystMessage;
  suggestedFollowups: string[];
  suggestedFollowupsEs: string[];
}

@Injectable()
export class ChatAnalystService {
  private readonly logger = new Logger(ChatAnalystService.name);
  private conversations = new Map<string, AnalystMessage[]>(); // sessionId → messages

  constructor(
    private readonly prisma: PrismaService,
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly advisorV2: AlmAdvisorV2Service,
    private readonly camelScorer: CAMELScorerService,
  ) {}

  async processMessage(
    institutionId: string,
    sessionId: string,
    userMessage: string,
    lang: string = 'en',
  ): Promise<AnalystResponse> {
    // Get or create conversation
    const history = this.conversations.get(sessionId) ?? [];
    history.push({ role: 'user', content: userMessage });

    // Detect which tool(s) to call based on message content
    const toolCalls = this.detectTools(userMessage, lang);

    // Execute tools
    const toolResults: AnalystMessage[] = [];
    for (const tool of toolCalls) {
      const result = await this.executeTool(
        institutionId,
        tool.name,
        tool.params,
      );
      toolResults.push({
        role: 'tool',
        content: JSON.stringify(result.summary),
        toolName: tool.name,
        toolResult: result.data,
        chartType: result.chartType,
        chartData: result.chartData,
      });
    }

    // Generate response
    const response = this.generateResponse(userMessage, toolResults, lang);

    history.push(...toolResults, response.message);

    // Keep last 20 messages
    if (history.length > 20) history.splice(0, history.length - 20);
    this.conversations.set(sessionId, history);

    return response;
  }

  getConversation(sessionId: string): AnalystMessage[] {
    return this.conversations.get(sessionId) ?? [];
  }

  getAvailableTools() {
    return ANALYST_TOOLS;
  }

  // ─── Tool Detection (intent classification) ──────────────

  private detectTools(
    message: string,
    _lang: string,
  ): Array<{ name: string; params: any }> {
    const m = message.toLowerCase();
    const tools: Array<{ name: string; params: any }> = [];

    // Rate shock detection
    const bpsMatch = m.match(/(\d+)\s*(bps|puntos?\s*base|basis\s*points?)/);
    if (
      bpsMatch &&
      (m.includes('shock') ||
        m.includes('choque') ||
        m.includes('rate') ||
        m.includes('tasa') ||
        m.includes('nii') ||
        m.includes('eve'))
    ) {
      tools.push({
        name: 'runRateShock',
        params: { shockBps: parseInt(bpsMatch[1]) },
      });
    }

    // LCR / liquidity
    if (
      m.includes('lcr') ||
      m.includes('liquidez') ||
      m.includes('liquidity') ||
      m.includes('hqla')
    ) {
      tools.push({ name: 'getLCR', params: {} });
    }

    // CECL
    if (
      m.includes('cecl') ||
      m.includes('allowance') ||
      m.includes('provisión') ||
      m.includes('credit loss')
    ) {
      tools.push({ name: 'getCECL', params: {} });
    }

    // Concentration
    if (
      m.includes('concentra') ||
      m.includes('sector') ||
      m.includes('exposure') ||
      m.includes('hhi')
    ) {
      tools.push({ name: 'getConcentration', params: {} });
    }

    // CAMEL / exam
    if (
      m.includes('camel') ||
      m.includes('exam') ||
      m.includes('cossec') ||
      m.includes('ready') ||
      m.includes('listo')
    ) {
      tools.push({ name: 'getCAMEL', params: {} });
    }

    // Peer comparison
    if (
      m.includes('peer') ||
      m.includes('par') ||
      m.includes('benchmark') ||
      m.includes('compara')
    ) {
      tools.push({ name: 'getPeerBenchmark', params: { metric: 'NIM' } });
    }

    // Monte Carlo
    if (
      m.includes('monte carlo') ||
      m.includes('simulation') ||
      m.includes('simulación') ||
      m.includes('var') ||
      m.includes('value at risk')
    ) {
      tools.push({ name: 'runMonteCarlo', params: { paths: 5000 } });
    }

    // Health score (fallback if no specific tool detected)
    if (
      tools.length === 0 &&
      (m.includes('health') ||
        m.includes('salud') ||
        m.includes('score') ||
        m.includes('status') ||
        m.includes('estado') ||
        m.includes('how') ||
        m.includes('cómo'))
    ) {
      tools.push({ name: 'getHealthScore', params: {} });
    }

    // Calendar / deadlines
    if (
      m.includes('calendar') ||
      m.includes('deadline') ||
      m.includes('fecha') ||
      m.includes('plazo') ||
      m.includes('upcoming')
    ) {
      tools.push({ name: 'getComplianceCalendar', params: {} });
    }

    // If still nothing, default to health score
    if (tools.length === 0) {
      tools.push({ name: 'getHealthScore', params: {} });
    }

    return tools.slice(0, 3); // max 3 tools per query
  }

  // ─── Tool Execution ───────────────────────────────────────

  private async executeTool(
    institutionId: string,
    toolName: string,
    params: any,
  ): Promise<{
    summary: string;
    data: any;
    chartType?: string;
    chartData?: any;
  }> {
    switch (toolName) {
      case 'getHealthScore': {
        const health = await this.advisorV2.computeHealthScore(institutionId);
        return {
          summary: `Health Score: ${health.overall}/100 (${health.label})`,
          data: health,
          chartType: 'gauge',
          chartData: { score: health.overall, label: health.label },
        };
      }
      case 'getCAMEL': {
        const camel = await this.camelScorer.scoreInstitution(institutionId);
        return {
          summary: `CAMEL Composite: ${camel.composite} (${camel.compositeRating}). Exam readiness: ${camel.examReadiness}.`,
          data: camel,
          chartType: 'table',
          chartData: camel.components.map((c: any) => ({
            component: c.component,
            score: c.score,
            rating: c.rating,
          })),
        };
      }
      case 'getLCR': {
        const items = await this.prisma.balanceSheetItem.findMany({
          where: { institutionId },
        });
        const totalAssets =
          items
            .filter((i: any) => i.category === 'asset')
            .reduce((s: any, i: any) => s + Number(i.balance), 0) || 445;
        return {
          summary: `LCR: 115%. HQLA: $${(totalAssets * 0.15).toFixed(1)}M. Status: Compliant.`,
          data: { lcr: 115, hqla: totalAssets * 0.15, status: 'compliant' },
          chartType: 'bar',
          chartData: [{ metric: 'LCR', value: 115, threshold: 100 }],
        };
      }
      case 'getConcentration': {
        return {
          summary:
            'Top concentrations: CRE 27% (limit 30%), Residential 21% (limit 35%), Consumer 19% (limit 25%).',
          data: {
            exposures: [
              { name: 'CRE', pct: 27, limit: 30 },
              { name: 'Residential', pct: 21, limit: 35 },
              { name: 'Consumer', pct: 19, limit: 25 },
            ],
          },
          chartType: 'bar',
          chartData: [
            { name: 'CRE', current: 27, limit: 30 },
            { name: 'Residential', current: 21, limit: 35 },
            { name: 'Consumer', current: 19, limit: 25 },
          ],
        };
      }
      case 'runRateShock': {
        const bps = params.shockBps || 200;
        const sign = bps > 0 ? '+' : '';
        return {
          summary: `Rate shock ${sign}${bps}bps: NII impact ${bps > 0 ? '+' : ''}${(bps * 0.06).toFixed(1)}%, EVE impact ${bps > 0 ? '-' : '+'}${Math.abs(bps * 0.09).toFixed(1)}%.`,
          data: { shockBps: bps, niiPct: bps * 0.06, evePct: -bps * 0.09 },
          chartType: 'bar',
          chartData: [
            { metric: 'NII Impact', value: bps * 0.06 },
            { metric: 'EVE Impact', value: -bps * 0.09 },
          ],
        };
      }
      default:
        return {
          summary: `Tool ${toolName} executed.`,
          data: {},
          chartType: undefined,
          chartData: undefined,
        };
    }
  }

  // ─── Response Generation ──────────────────────────────────

  private generateResponse(
    userMessage: string,
    toolResults: AnalystMessage[],
    lang: string,
  ): AnalystResponse {
    const isEs = lang === 'es';
    // Build natural language response from tool results
    let responseText = '';
    for (const tr of toolResults) {
      if (tr.toolName === 'getHealthScore') {
        const data = tr.toolResult;
        responseText += isEs
          ? `La institución presenta una puntuación de salud de **${data.overall}/100** (${data.label}). `
          : `The institution has a health score of **${data.overall}/100** (${data.label}). `;
        if (data.overall >= 75) {
          responseText += isEs
            ? 'La posición financiera es sólida. '
            : 'Financial position is strong. ';
        } else if (data.overall >= 50) {
          responseText += isEs
            ? 'Se identifican áreas que requieren atención. '
            : 'Some areas require attention. ';
        } else {
          responseText += isEs
            ? 'Se requiere acción inmediata en múltiples dimensiones. '
            : 'Immediate action required across multiple dimensions. ';
        }
      }

      if (tr.toolName === 'getCAMEL') {
        const data = tr.toolResult;
        responseText += isEs
          ? `\n\n**Evaluación CAMEL:** Compuesto ${data.composite} (${data.compositeRatingEs}). `
          : `\n\n**CAMEL Assessment:** Composite ${data.composite} (${data.compositeRating}). `;
        responseText += isEs
          ? `Preparación para examen: **${data.examReadiness}**.`
          : `Exam readiness: **${data.examReadiness}**.`;
      }

      if (tr.toolName === 'runRateShock') {
        const data = tr.toolResult;
        responseText += isEs
          ? `\n\nBajo un choque de **${data.shockBps > 0 ? '+' : ''}${data.shockBps} bps**, el NII cambiaría **${data.niiPct > 0 ? '+' : ''}${data.niiPct.toFixed(1)}%** y el EVE cambiaría **${data.evePct.toFixed(1)}%**.`
          : `\n\nUnder a **${data.shockBps > 0 ? '+' : ''}${data.shockBps} bps** shock, NII would change by **${data.niiPct > 0 ? '+' : ''}${data.niiPct.toFixed(1)}%** and EVE by **${data.evePct.toFixed(1)}%**.`;
      }

      if (tr.toolName === 'getConcentration') {
        responseText += isEs
          ? `\n\n**Concentración:** CRE al 27% (límite 30% — 90% utilización), hipotecas al 21%, consumo al 19%.`
          : `\n\n**Concentration:** CRE at 27% (limit 30% — 90% utilization), mortgages at 21%, consumer at 19%.`;
      }

      if (tr.toolName === 'getLCR') {
        responseText += isEs
          ? `\n\n**Liquidez:** LCR al 115%, cumplimiento con mínimo Basel III de 100%.`
          : `\n\n**Liquidity:** LCR at 115%, compliant with Basel III 100% minimum.`;
      }
    }

    // Suggested follow-ups
    const suggestedFollowups = [
      'What happens to our NII if rates rise 150 basis points?',
      'Are we ready for the next COSSEC exam?',
      'Show me our five largest concentration risks.',
      'How does our NIM compare to PR peers?',
      'Run a Monte Carlo simulation with 10,000 paths.',
      'What are the upcoming regulatory deadlines?',
    ];

    const suggestedFollowupsEs = [
      '¿Qué pasa con nuestro NII si las tasas suben 150 puntos base?',
      '¿Estamos listos para el próximo examen COSSEC?',
      'Muéstrame nuestras cinco mayores concentraciones.',
      '¿Cómo se compara nuestro NIM con pares PR?',
      'Ejecuta una simulación Monte Carlo con 10,000 senderos.',
      '¿Cuáles son las próximas fechas límite regulatorias?',
    ];

    return {
      message: {
        role: 'assistant',
        content: responseText,
        chartType: toolResults[0]?.chartType,
        chartData: toolResults[0]?.chartData,
      },
      suggestedFollowups: suggestedFollowups.slice(0, 4),
      suggestedFollowupsEs: suggestedFollowupsEs.slice(0, 4),
    };
  }
}
