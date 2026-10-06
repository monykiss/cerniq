import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataGap, dataGap } from './reports/data-gap';
import * as Sentry from '@sentry/nestjs';

// ─── Types ───────────────────────────────────────────────────
//
// D1 (never silent zeros, SESSION_HANDOFF §1 / 2026-04-07): the peer-network
// view is built from the real cooperativa population. With no institutions it
// returns an HONEST data_unavailable shell. With real institutions it reports
// only what is computable from loaded data (counts, total assets, the
// institution list, average NWR, real NWR outliers); the indicators that need
// per-institution CAMEL/NIM/LCR scoring or a systemic/contagion model that are
// NOT yet wired are returned `null` with a disclosed gap — NEVER the former
// hardcoded avgCAMEL 2.1 / systemicRiskScore 35 / PREPA-bond contagion demo.

export interface NetworkInstitution {
  id: string;
  name: string;
  totalAssets: number;
  type: string;
  camelComposite: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  topRisk: string;
}

export interface NetworkAggregates {
  totalInstitutions: number;
  totalSystemAssets: number;
  // Nullable per D1: these need per-institution CAMEL/NIM/LCR scoring or a
  // systemic-risk model that are not yet wired — `null` + a gap, never a
  // hardcoded constant a regulator would read as a measured network average.
  avgCAMEL: number | null;
  avgNIM: number | null;
  avgLCR: number | null;
  avgNWR: number | null;
  systemicRiskScore: number | null; // 0-100
  riskDistribution: {
    rating1: number;
    rating2: number;
    rating3: number;
    rating4: number;
    rating5: number;
  } | null;
}

export interface NetworkIntelligenceResult {
  aggregates: NetworkAggregates;
  institutions: NetworkInstitution[];
  outliers: Array<{
    institution: string;
    metric: string;
    value: number;
    peerMedian: number;
    deviation: string;
  }>;
  contagionRisks: Array<{
    risk: string;
    riskEs: string;
    affectedInstitutions: number;
    severity: string;
  }>;
  status: 'ok' | 'data_unavailable';
  gaps?: DataGap[];
}

@Injectable()
export class NetworkIntelligenceService {
  private readonly logger = new Logger(NetworkIntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getNetworkOverview(): Promise<NetworkIntelligenceResult> {
    try {
      const institutions = await this.prisma.institution.findMany({
        include: { balanceSheetItems: true },
        orderBy: { totalAssets: 'desc' },
        take: 100,
      });

      // D1 (never silent zeros): no institutions means there is nothing to
      // analyze. Return an honest data_unavailable shell with a CRITICAL gap —
      // NEVER the former 15-cooperativa / 94-institution demo network.
      if (institutions.length === 0) return this.dataUnavailableResult();

      // Per-institution NWR (the one metric computable from loaded balance
      // sheets). `null` when an institution has no asset data.
      const perInst: Array<{
        inst: (typeof institutions)[number];
        nwr: number | null;
      }> = institutions.map((inst: (typeof institutions)[number]) => {
        const assets = inst.balanceSheetItems.filter(
          (i: (typeof inst.balanceSheetItems)[number]) =>
            i.category === 'asset',
        );
        const liabilities = inst.balanceSheetItems.filter(
          (i: (typeof inst.balanceSheetItems)[number]) =>
            i.category === 'liability',
        );
        const totalA =
          assets.reduce(
            (s: number, i: (typeof assets)[number]) => s + Number(i.balance),
            0,
          ) || inst.totalAssets;
        const totalL = liabilities.reduce(
          (s: number, i: (typeof liabilities)[number]) => s + Number(i.balance),
          0,
        );
        const nwr = totalA > 0 ? ((totalA - totalL) / totalA) * 100 : null;
        return { inst, nwr };
      });

      const networkInstitutions: NetworkInstitution[] = perInst.map(
        ({ inst, nwr }) => {
          const n = nwr ?? 9;
          return {
            id: inst.id,
            name: inst.name,
            totalAssets: inst.totalAssets,
            type: inst.type,
            camelComposite: null, // CAMEL not computed per institution (not wired)
            riskLevel:
              n >= 8
                ? ('low' as const)
                : n >= 6
                  ? ('medium' as const)
                  : ('high' as const),
            topRisk: n < 7 ? 'Capital adequacy' : 'Interest rate sensitivity',
          };
        },
      );

      const totalSystemAssets = networkInstitutions.reduce(
        (s, i) => s + Number(i.totalAssets),
        0,
      );

      // avgNWR + NWR outliers from the real per-institution values.
      const nwrValues = perInst
        .map((p) => p.nwr)
        .filter((n): n is number => n !== null);
      const avgNWR =
        nwrValues.length > 0
          ? +(nwrValues.reduce((s, n) => s + n, 0) / nwrValues.length).toFixed(
              1,
            )
          : null;
      const sortedNwr = [...nwrValues].sort((a, b) => a - b);
      const medianNwr = sortedNwr.length
        ? sortedNwr[Math.floor(sortedNwr.length / 2)]
        : null;
      const outliers =
        medianNwr !== null
          ? perInst
              .filter((p) => p.nwr !== null && p.nwr < medianNwr - 1.5)
              .map((p) => ({
                institution: p.inst.name,
                metric: 'NWR',
                value: +p.nwr!.toFixed(1),
                peerMedian: +medianNwr.toFixed(1),
                deviation: `${(p.nwr! - medianNwr).toFixed(1)}pp vs median`,
              }))
          : [];

      // D1: disclose the network indicators that are NOT computable from loaded
      // data (vs. silently emitting hardcoded constants).
      const gaps: DataGap[] = [
        dataGap('networkIntelligence.aggregates', 'INDICATOR_NOT_WIRED', {
          severity: 'WARNING',
          action:
            'Los promedios de red CAMEL/NIM/LCR, el puntaje de riesgo sistémico y la distribución por calificación requieren puntuación CAMEL/NIM/LCR por institución que aún no está cableada — se reportan como null. / Network CAMEL/NIM/LCR averages, the systemic-risk score and the rating distribution require per-institution CAMEL/NIM/LCR scoring that is not yet wired — reported as null.',
        }),
        dataGap('networkIntelligence.contagionRisks', 'INDICATOR_NOT_WIRED', {
          severity: 'WARNING',
          action:
            'El análisis de contagio (exposiciones compartidas entre cooperativas) requiere un modelo de red que aún no está cableado. / Contagion analysis (shared exposures across cooperativas) requires a network model that is not yet wired.',
        }),
      ];

      return {
        aggregates: {
          totalInstitutions: networkInstitutions.length,
          totalSystemAssets,
          avgCAMEL: null,
          avgNIM: null,
          avgLCR: null,
          avgNWR,
          systemicRiskScore: null,
          riskDistribution: null,
        },
        institutions: networkInstitutions,
        outliers,
        contagionRisks: [],
        status: 'ok',
        gaps,
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

  // D1: the honest empty-data shell. Replaces the former getDemoResult() — a
  // fabricated 15-cooperativa network with a 94-institution count, hardcoded
  // PREPA-bond / pharma-employer contagion risks, and demo CAMEL/NIM/LCR
  // averages — that read as a real systemic view on an empty database.
  private dataUnavailableResult(): NetworkIntelligenceResult {
    return {
      aggregates: {
        totalInstitutions: 0,
        totalSystemAssets: 0,
        avgCAMEL: null,
        avgNIM: null,
        avgLCR: null,
        avgNWR: null,
        systemicRiskScore: null,
        riskDistribution: null,
      },
      institutions: [],
      outliers: [],
      contagionRisks: [],
      status: 'data_unavailable',
      gaps: [
        dataGap('networkIntelligence.institutions', 'MISSING_INSTITUTION', {
          severity: 'CRITICAL',
          action:
            'No hay instituciones cargadas para el análisis de red de cooperativas. Cargue instituciones con sus balances. / No institutions are loaded for the cooperativa network analysis. Load institutions with their balance sheets.',
          context: { service: 'network-intelligence' },
        }),
      ],
    };
  }
}
