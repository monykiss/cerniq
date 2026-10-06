import { Injectable, Logger } from '@nestjs/common';

// ─── USVI FSC Regulatory Framework ──────────────────────────

const USVI_COMPLIANCE_CALENDAR = [
  {
    event: 'FSC Annual Examination',
    eventEs: 'Examen Anual FSC',
    frequency: 'annual',
    regulatoryRef: 'USVI FSC §4-201',
  },
  {
    event: 'NCUA 5300 Call Report (Federal CUs)',
    eventEs: 'Informe 5300 NCUA (CU Federales)',
    frequency: 'quarterly',
    regulatoryRef: 'NCUA §741.6',
  },
  {
    event: 'BSA/AML Compliance Review',
    eventEs: 'Revisión Cumplimiento BSA/AML',
    frequency: 'annual',
    regulatoryRef: 'FinCEN 31 CFR 1020',
  },
  {
    event: 'VI Legislature Budget Cycle Filing',
    eventEs: 'Radicación Ciclo Presupuestario Legislatura VI',
    frequency: 'annual',
    regulatoryRef: 'USVI Budget Act',
  },
];

const USVI_ECONOMIC_PARAMS = {
  tourismSeasonalityPeak: [11, 12, 1, 2, 3], // November–March
  tourismSeasonalityTrough: [7, 8, 9], // Summer slow
  hurricaneSeasonMonths: [6, 7, 8, 9, 10],
  avgHurricaneCPRSpike: 0.35, // higher than PR 0.30
  dominantSector: 'tourism',
  populationEstimate: 87146,
  creditUnionCount: 6, // approximate federally-chartered USVI CUs
};

const USVI_PEER_BENCHMARKS = {
  nim: { p25: 2.6, p50: 3.2, p75: 3.8 },
  lcr: { p25: 95, p50: 112, p75: 135 },
  nwr: { p25: 7.5, p50: 9.0, p75: 11.2 },
  loanToShare: { p25: 55, p50: 65, p75: 78 },
};

export interface USVIComplianceItem {
  event: string;
  eventEs: string;
  frequency: string;
  regulatoryRef: string;
  nextDueDate: string;
}

export interface USVIExpansionResult {
  jurisdiction: 'USVI';
  regulator: 'USVI Financial Services Commission (FSC)';
  complianceCalendar: USVIComplianceItem[];
  economicParams: typeof USVI_ECONOMIC_PARAMS;
  peerBenchmarks: typeof USVI_PEER_BENCHMARKS;
  differences: Array<{ area: string; pr: string; usvi: string }>;
}

@Injectable()
export class USVIExpansionService {
  private readonly logger = new Logger(USVIExpansionService.name);

  getUSVIFramework(): USVIExpansionResult {
    const now = new Date();

    const complianceCalendar: USVIComplianceItem[] =
      USVI_COMPLIANCE_CALENDAR.map((item) => {
        let nextDue: Date;
        if (item.frequency === 'quarterly') {
          const currentQ = Math.ceil((now.getMonth() + 1) / 3);
          const nextQ = currentQ === 4 ? 1 : currentQ + 1;
          const nextYear =
            currentQ === 4 ? now.getFullYear() + 1 : now.getFullYear();
          nextDue = new Date(nextYear, (nextQ - 1) * 3 + 1, 15); // 45 days after quarter end
        } else {
          nextDue = new Date(now.getFullYear() + 1, 2, 31); // annual = March 31
        }
        return { ...item, nextDueDate: nextDue.toISOString().split('T')[0] };
      });

    return {
      jurisdiction: 'USVI',
      regulator: 'USVI Financial Services Commission (FSC)',
      complianceCalendar,
      economicParams: USVI_ECONOMIC_PARAMS,
      peerBenchmarks: USVI_PEER_BENCHMARKS,
      differences: [
        { area: 'Primary Regulator', pr: 'COSSEC', usvi: 'USVI FSC' },
        {
          area: 'Federal Supervisor',
          pr: 'NCUA (all)',
          usvi: 'NCUA (federal charter) / FSC (state charter)',
        },
        {
          area: 'Exam Frequency',
          pr: 'Every 12-18 months',
          usvi: 'Annual for state-chartered',
        },
        { area: 'Primary Language', pr: 'Spanish', usvi: 'English' },
        {
          area: 'Economic Driver',
          pr: 'Pharma + tourism + government',
          usvi: 'Tourism (dominant)',
        },
        {
          area: 'Hurricane Exposure',
          pr: 'High (Cat 3-5)',
          usvi: 'Very High (Cat 4-5 more frequent)',
        },
        {
          area: 'Tax Environment',
          pr: 'PR income tax',
          usvi: 'No income tax (USVI mirror code)',
        },
        {
          area: 'Credit Union Count',
          pr: '94 cooperativas',
          usvi: '~6 credit unions',
        },
      ],
    };
  }
}
