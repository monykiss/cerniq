import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── COSSEC 5 Standard Scenarios ─────────────────────────────
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): each scenario's
// liquidity outcome is computed from the institution's real balance sheet +
// liquidity position. An institution with no balance-sheet data returns the 5
// COSSEC scenarios (a fixed regulatory catalog) each marked data_unavailable —
// computed fields null + a CRITICAL gap — NEVER a fabricated demo result.
// (Formerly returned 5 hardcoded demo scenario outcomes.)

const COSSEC_SCENARIOS = [
  {
    id: 'SCEN-1',
    name: '72-Hour Acute Stress',
    nameEs: 'Estrés Agudo 72 Horas',
    description:
      '5% demand deposit runoff per day for 3 days. Wholesale funding freeze. HQLA sell-down 50%.',
    descriptionEs:
      'Fuga de depósitos a la vista 5%/día por 3 días. Congelamiento de fondeo mayorista. Liquidación HQLA 50%.',
    params: {
      dailyRunoffPct: 0.05,
      runoffDays: 3,
      wholesaleFreeze: true,
      hqlaSelldown: 0.5,
      loanCommitmentsDrawn: 0,
    },
  },
  {
    id: 'SCEN-2',
    name: '30-Day Prolonged Stress',
    nameEs: 'Estrés Prolongado 30 Días',
    description:
      'Institutional funding freeze. 15% retail deposit runoff over 30 days. All loan commitments drawn.',
    descriptionEs:
      'Congelamiento de fondeo institucional. 15% fuga de depósitos minoristas en 30 días. Todas las líneas de crédito utilizadas.',
    params: {
      dailyRunoffPct: 0.005,
      runoffDays: 30,
      wholesaleFreeze: true,
      hqlaSelldown: 0,
      loanCommitmentsDrawn: 1.0,
    },
  },
  {
    id: 'SCEN-3',
    name: 'Seasonal Outflow',
    nameEs: 'Salida Estacional',
    description:
      'January salary seasonality + Christmas bonus drain. 8% total share outflow. Recovery in 6 weeks.',
    descriptionEs:
      'Estacionalidad salarial de enero + drenaje de bonos navideños. 8% salida total de acciones. Recuperación en 6 semanas.',
    params: {
      dailyRunoffPct: 0.004,
      runoffDays: 20,
      wholesaleFreeze: false,
      hqlaSelldown: 0,
      loanCommitmentsDrawn: 0,
    },
  },
  {
    id: 'SCEN-4',
    name: 'Member Concentration',
    nameEs: 'Concentración de Socios',
    description:
      'Top 10 members withdraw 100%. Next 10 withdraw 50%. No new funding available.',
    descriptionEs:
      'Los 10 socios principales retiran 100%. Los siguientes 10 retiran 50%. Sin fondeo nuevo disponible.',
    params: {
      dailyRunoffPct: 0,
      runoffDays: 1,
      wholesaleFreeze: true,
      hqlaSelldown: 0,
      loanCommitmentsDrawn: 0,
      topMemberWithdrawal: true,
    },
  },
  {
    id: 'SCEN-5',
    name: 'Hurricane/Disaster',
    nameEs: 'Huracán/Desastre',
    description:
      '30% asset impairment (RE collateral loss). 40% member withdrawal over 30 days. Operational cost spike +20%.',
    descriptionEs:
      'Deterioro de activos 30% (pérdida de colateral inmobiliario). 40% retiro de socios en 30 días. Aumento costos operativos +20%.',
    params: {
      dailyRunoffPct: 0.013,
      runoffDays: 30,
      wholesaleFreeze: true,
      hqlaSelldown: 0.3,
      loanCommitmentsDrawn: 0.5,
      assetImpairmentPct: 0.3,
    },
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface StressPackResult {
  scenarioId: string;
  scenarioName: string;
  scenarioNameEs: string;
  // Nullable per D1: with no balance sheet there is nothing to compute, so each
  // scenario returns `null` + a gap rather than a fabricated demo outcome.
  daysOfLiquidity: number | null;
  lcr: number | null;
  hqlaCoverage: number | null;
  availableLiquid: number | null;
  netOutflow: number | null;
  surplus: number | null;
  regulatoryStatus: 'PASS' | 'WATCH' | 'FAIL' | null;
  narrative: string | null;
  narrativeEs: string | null;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class LiquidityStressPackService {
  private readonly logger = new Logger(LiquidityStressPackService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runAllScenarios(institutionId: string): Promise<StressPackResult[]> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });
      const liquidityPos = await this.prisma.liquidityPosition.findFirst({
        where: { institutionId },
        orderBy: { date: 'desc' },
      });

      // D1 (never silent zeros): no balance sheet means there is nothing to
      // stress. Return the COSSEC scenario catalog with each result marked
      // data_unavailable — NEVER the former hardcoded getDemoResults().
      if (items.length === 0) return this.dataUnavailableResults();

      const totalAssets = items
        .filter((i: any) => i.category === 'asset')
        .reduce((s: number, i: any) => s + Number(i.balance), 0);
      const totalDeposits = items
        .filter((i: any) => i.category === 'liability')
        .reduce((s: number, i: any) => s + Number(i.balance), 0);
      const hqla =
        (liquidityPos?.hqlaLevel1 ?? 0) + (liquidityPos?.hqlaLevel2 ?? 0) ||
        totalAssets * 0.15;
      const topMemberConcentration = totalDeposits * 0.15; // approximate top 10 = 15%

      return COSSEC_SCENARIOS.map((scenario) =>
        this.runSingleScenario(
          scenario,
          totalAssets,
          totalDeposits,
          hqla,
          topMemberConcentration,
        ),
      );
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  async runScenario(
    institutionId: string,
    scenarioId: string,
  ): Promise<StressPackResult> {
    const all = await this.runAllScenarios(institutionId);
    const found = all.find((r) => r.scenarioId === scenarioId);
    if (!found) return all[0];
    return found;
  }

  private runSingleScenario(
    scenario: (typeof COSSEC_SCENARIOS)[0],
    totalAssets: number,
    totalDeposits: number,
    hqla: number,
    topMemberConcentration: number,
  ): StressPackResult {
    const { params } = scenario;
    let totalOutflow = 0;

    if (params.topMemberWithdrawal) {
      totalOutflow =
        topMemberConcentration * 1.0 + topMemberConcentration * 0.5;
    } else {
      totalOutflow = totalDeposits * params.dailyRunoffPct * params.runoffDays;
    }

    if (params.loanCommitmentsDrawn > 0) {
      totalOutflow += totalAssets * 0.05 * params.loanCommitmentsDrawn; // 5% of assets as commitments
    }

    const availableHQLA = hqla * (1 - params.hqlaSelldown);
    const netOutflow = totalOutflow;
    const surplus = availableHQLA - netOutflow;
    const stressedLCR =
      netOutflow > 0 ? (availableHQLA / netOutflow) * 100 : 999;
    const hqlaCoverage =
      netOutflow > 0 ? (availableHQLA / netOutflow) * 100 : 999;

    // Days of liquidity: how many days of the daily runoff rate can HQLA cover
    const dailyOutflow =
      params.dailyRunoffPct > 0
        ? totalDeposits * params.dailyRunoffPct
        : netOutflow; // for one-shot scenarios
    const daysOfLiquidity =
      dailyOutflow > 0 ? Math.floor(availableHQLA / dailyOutflow) : 999;

    const status =
      surplus >= 0
        ? 'PASS'
        : daysOfLiquidity >= Math.ceil(params.runoffDays * 0.5)
          ? 'WATCH'
          : 'FAIL';

    const narrative = `Under ${scenario.name}, the institution would experience $${netOutflow.toFixed(1)}M in outflows over ${params.runoffDays} day(s). Available liquid assets of $${availableHQLA.toFixed(1)}M provide ${daysOfLiquidity} days of coverage. Status: ${status}.`;
    const narrativeEs = `Bajo ${scenario.nameEs}, la institución experimentaría $${netOutflow.toFixed(1)}M en salidas durante ${params.runoffDays} día(s). Los activos líquidos disponibles de $${availableHQLA.toFixed(1)}M proporcionan ${daysOfLiquidity} días de cobertura. Estado: ${status}.`;

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      scenarioNameEs: scenario.nameEs,
      daysOfLiquidity,
      lcr: Math.round(stressedLCR * 10) / 10,
      hqlaCoverage: Math.round(hqlaCoverage * 10) / 10,
      availableLiquid: Math.round(availableHQLA * 10) / 10,
      netOutflow: Math.round(netOutflow * 10) / 10,
      surplus: Math.round(surplus * 10) / 10,
      regulatoryStatus: status,
      narrative,
      narrativeEs,
      status: 'ok',
    };
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResults()
  // fabrication (5 hardcoded scenario outcomes with demo LCRs/surpluses) that
  // read as a real liquidity stress pack on every empty institution. The 5
  // COSSEC scenarios are a fixed regulatory catalog (their id/name/nameEs are
  // reference data, not fabricated); every COMPUTED field is null + a CRITICAL
  // gap so the report renders explicit DATA UNAVAILABLE markers.
  private dataUnavailableResults(): StressPackResult[] {
    return COSSEC_SCENARIOS.map((s) => ({
      scenarioId: s.id,
      scenarioName: s.name,
      scenarioNameEs: s.nameEs,
      daysOfLiquidity: null,
      lcr: null,
      hqlaCoverage: null,
      availableLiquid: null,
      netOutflow: null,
      surplus: null,
      regulatoryStatus: null,
      narrative: null,
      narrativeEs: null,
      status: 'data_unavailable' as const,
      gaps: [
        dataGap('liquidityStressPack.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación y la posición de liquidez para correr los 5 escenarios de estrés COSSEC. / Load the balance sheet and liquidity position to run the 5 COSSEC liquidity stress scenarios.',
          context: { service: 'liquidity-stress-pack', scenarioId: s.id },
        }),
      ],
    }));
  }
}
