import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ISDA standard LIBOR→SOFR spread adjustments
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): LIBOR exposure is
// read from the institution's real balance sheet. An institution with no balance
// sheet returns an HONEST data_unavailable shell with a CRITICAL gap. An
// institution that HAS a balance sheet but no LIBOR-referenced instruments gets
// a real ZERO-exposure result (status:'ok') — zero LIBOR is a genuine finding
// (the transition is complete), NEVER the former hardcoded $38.7M demo exposure.
const LIBOR_SOFR_SPREADS: Record<string, number> = {
  '1M_LIBOR': 0.00114, // 11.4bps
  '3M_LIBOR': 0.00262, // 26.2bps
  '6M_LIBOR': 0.00428, // 42.8bps
  '12M_LIBOR': 0.00715, // 71.5bps
};

export interface LIBORExposure {
  instrumentId: string;
  name: string;
  subcategory: string;
  balance: number;
  referenceRate: string;
  currentRate: number;
  sofrEquivalent: number;
  spreadAdjustment: number;
  valueTransfer: number; // $ impact of conversion
  maturityYears: number;
}

export interface SOFRMonitorResult {
  exposures: LIBORExposure[];
  // Nullable per D1: with no balance sheet there is nothing to measure, so the
  // engine returns `null` + a gap rather than a fabricated demo. A real zero
  // (institution has a balance sheet but no LIBOR instruments) is a number, not
  // null — `null` means "no data," `0` means "measured zero exposure."
  totalLIBORExposure: number | null;
  totalSOFRExposure: number | null;
  totalValueTransfer: number | null;
  pctPortfolioExposed: number | null;
  transitionChecklist: Array<{
    item: string;
    itemEs: string;
    status: 'complete' | 'in_progress' | 'pending';
  }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class SOFRMonitorService {
  private readonly logger = new Logger(SOFRMonitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getExposureReport(institutionId: string): Promise<SOFRMonitorResult> {
    try {
      const items = await this.prisma.balanceSheetItem.findMany({
        where: { institutionId },
      });

      // D1 (never silent zeros): no balance sheet means there is nothing to
      // measure. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former hardcoded $38.7M getDemoResult() LIBOR exposure.
      if (items.length === 0) return this.dataUnavailableResult();

      const totalPortfolio = items.reduce(
        (s: number, i: any) => s + Number(i.balance),
        0,
      );

      // Identify LIBOR-referenced instruments
      const exposures: LIBORExposure[] = items
        .filter((i: any) => {
          const rt = (i.rateType || '').toLowerCase();
          const name = (i.name || '').toLowerCase();
          return (
            rt === 'variable' &&
            (name.includes('libor') || name.includes('floating'))
          );
        })
        .map((item: any) => {
          const tenor = item.duration > 0.5 ? '3M_LIBOR' : '1M_LIBOR';
          const spread =
            LIBOR_SOFR_SPREADS[tenor] ?? LIBOR_SOFR_SPREADS['3M_LIBOR'];
          const sofrRate = item.rate - spread;
          const valueTransfer = item.balance * spread * (item.duration || 1);

          return {
            instrumentId: item.id,
            name: item.name,
            subcategory: item.subcategory,
            balance: item.balance,
            referenceRate: tenor.replace('_', ' '),
            currentRate: item.rate,
            sofrEquivalent: Math.round(sofrRate * 10000) / 10000,
            spreadAdjustment: spread,
            valueTransfer: Math.round(valueTransfer * 100) / 100,
            maturityYears: item.duration || 1,
          };
        });

      // No LIBOR-referenced instruments is a REAL zero-exposure result (the
      // transition is complete / never had LIBOR), not missing data — return the
      // measured zeros with status 'ok', never a fabricated demo.
      const totalLIBOR = exposures.reduce((s, e) => s + Number(e.balance), 0);
      const totalTransfer = exposures.reduce((s, e) => s + e.valueTransfer, 0);
      const sofrExposure = items
        .filter((i: any) => (i.name || '').toLowerCase().includes('sofr'))
        .reduce((s: number, i: any) => s + Number(i.balance), 0);

      return {
        exposures,
        totalLIBORExposure: totalLIBOR,
        totalSOFRExposure: sofrExposure,
        totalValueTransfer: Math.round(totalTransfer * 100) / 100,
        pctPortfolioExposed:
          totalPortfolio > 0
            ? Math.round((totalLIBOR / totalPortfolio) * 10000) / 100
            : 0,
        transitionChecklist: this.getChecklist(),
        status: 'ok',
      };
    } catch (error) {
      const e = error as Error;
      this.logger.error(`Computation failed: ${e.message}`, e.stack);
      Sentry.captureException(error);
      throw new InternalServerErrorException(
        'Computation failed. Please try again.',
      );
    }
  }

  private getChecklist() {
    return [
      {
        item: 'Inventory all LIBOR-referenced instruments',
        itemEs: 'Inventariar todos los instrumentos referenciados a LIBOR',
        status: 'complete' as const,
      },
      {
        item: 'Review fallback language in loan documents',
        itemEs: 'Revisar cláusulas de respaldo en documentos de préstamo',
        status: 'in_progress' as const,
      },
      {
        item: 'Calculate ISDA spread adjustments',
        itemEs: 'Calcular ajustes de spread ISDA',
        status: 'complete' as const,
      },
      {
        item: 'Notify affected borrowers of rate conversion',
        itemEs: 'Notificar a prestatarios afectados sobre conversión de tasa',
        status: 'pending' as const,
      },
      {
        item: 'Update core banking system rate indices',
        itemEs: 'Actualizar índices de tasas en sistema core bancario',
        status: 'pending' as const,
      },
      {
        item: 'File OCIF SOFR transition attestation',
        itemEs: 'Presentar atestación de transición SOFR a OCIF',
        status: 'pending' as const,
      },
      {
        item: 'Board resolution approving transition plan',
        itemEs: 'Resolución de junta aprobando plan de transición',
        status: 'in_progress' as const,
      },
    ];
  }

  // D1: the honest empty-data shell. Replaces the former getDemoResult()
  // fabrication (3 demo LIBOR instruments totaling $38.7M / $0.59M value
  // transfer) that read as a real LIBOR exposure on every empty institution.
  private dataUnavailableResult(): SOFRMonitorResult {
    return {
      exposures: [],
      totalLIBORExposure: null,
      totalSOFRExposure: null,
      totalValueTransfer: null,
      pctPortfolioExposed: null,
      transitionChecklist: this.getChecklist(),
      status: 'data_unavailable',
      gaps: [
        dataGap('sofrMonitor.balanceSheet', 'EMPTY_BALANCE_SHEET', {
          severity: 'CRITICAL',
          action:
            'Cargue el balance de situación para inventariar la exposición a LIBOR y calcular la transición a SOFR. / Load the balance sheet to inventory LIBOR exposure and compute the SOFR transition.',
          context: { service: 'sofr-monitor' },
        }),
      ],
    };
  }
}
