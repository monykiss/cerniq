import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// Macro Factor Model — GDP/CPI/Unemployment/Housing → ALM Impact
// Maps macroeconomic scenarios to balance sheet outcomes

export interface MacroScenario {
  name: string;
  nameEs: string;
  gdpGrowth: number; // annual %
  cpi: number; // annual %
  unemployment: number; // level %
  housingPriceChange: number; // annual %
  fedFundsRate: number; // level %
}

export interface MacroImpact {
  scenario: MacroScenario;
  niiImpactPct: number;
  nplImpactBps: number;
  lcrImpact: number;
  nwrImpact: number;
  ceclProvisionChange: number;
  depositGrowth: number;
  loanGrowth: number;
  narrativeEs: string;
  narrativeEn: string;
}

export interface MacroFactorResult {
  baselineScenario: MacroScenario;
  scenarios: MacroImpact[];
  currentRegime: string;
  sensitivity: Array<{
    factor: string;
    factorEs: string;
    niiSensitivity: number;
    nplSensitivity: number;
  }>;
}

const PR_MACRO_SCENARIOS: MacroScenario[] = [
  {
    name: 'Baseline',
    nameEs: 'Base',
    gdpGrowth: 0.015,
    cpi: 0.028,
    unemployment: 0.062,
    housingPriceChange: 0.03,
    fedFundsRate: 0.0475,
  },
  {
    name: 'Mild Recession',
    nameEs: 'Recesión Leve',
    gdpGrowth: -0.01,
    cpi: 0.02,
    unemployment: 0.08,
    housingPriceChange: -0.05,
    fedFundsRate: 0.035,
  },
  {
    name: 'Stagflation',
    nameEs: 'Estanflación',
    gdpGrowth: 0.005,
    cpi: 0.055,
    unemployment: 0.075,
    housingPriceChange: -0.02,
    fedFundsRate: 0.065,
  },
  {
    name: 'Strong Growth',
    nameEs: 'Crecimiento Fuerte',
    gdpGrowth: 0.035,
    cpi: 0.03,
    unemployment: 0.045,
    housingPriceChange: 0.08,
    fedFundsRate: 0.05,
  },
  {
    name: 'Hurricane Disruption',
    nameEs: 'Disrupción por Huracán',
    gdpGrowth: -0.06,
    cpi: 0.04,
    unemployment: 0.11,
    housingPriceChange: -0.25,
    fedFundsRate: 0.04,
  },
];

// Factor betas: how each macro variable affects ALM metrics
const FACTOR_BETAS = {
  gdpGrowth: { nii: 0.15, npl: -0.3, lcr: 0.05, deposits: 0.2, loans: 0.25 },
  cpi: { nii: 0.05, npl: 0.1, lcr: -0.02, deposits: -0.05, loans: 0.02 },
  unemployment: {
    nii: -0.1,
    npl: 0.5,
    lcr: -0.08,
    deposits: -0.15,
    loans: -0.2,
  },
  housingPriceChange: {
    nii: 0.02,
    npl: -0.25,
    lcr: 0.03,
    deposits: 0.05,
    loans: 0.15,
  },
  fedFundsRate: { nii: 0.4, npl: 0.05, lcr: 0.1, deposits: -0.1, loans: -0.05 },
};

@Injectable()
export class MacroFactorModelService {
  private readonly logger = new Logger(MacroFactorModelService.name);

  constructor(private readonly prisma: PrismaService) {}

  async computeMacroImpact(_institutionId: string): Promise<MacroFactorResult> {
    const baseline = PR_MACRO_SCENARIOS[0];

    const scenarios: MacroImpact[] = PR_MACRO_SCENARIOS.map((scenario) => {
      // Compute deltas from baseline
      const deltas = {
        gdpGrowth: scenario.gdpGrowth - baseline.gdpGrowth,
        cpi: scenario.cpi - baseline.cpi,
        unemployment: scenario.unemployment - baseline.unemployment,
        housingPriceChange:
          scenario.housingPriceChange - baseline.housingPriceChange,
        fedFundsRate: scenario.fedFundsRate - baseline.fedFundsRate,
      };

      // Apply factor betas
      const niiImpact =
        Object.entries(deltas).reduce(
          (s, [factor, delta]) =>
            s +
            delta *
              (FACTOR_BETAS[factor as keyof typeof FACTOR_BETAS]?.nii ?? 0),
          0,
        ) * 100;

      const nplImpact =
        Object.entries(deltas).reduce(
          (s, [factor, delta]) =>
            s +
            delta *
              (FACTOR_BETAS[factor as keyof typeof FACTOR_BETAS]?.npl ?? 0),
          0,
        ) * 10000;

      const lcrImpact =
        Object.entries(deltas).reduce(
          (s, [factor, delta]) =>
            s +
            delta *
              (FACTOR_BETAS[factor as keyof typeof FACTOR_BETAS]?.lcr ?? 0),
          0,
        ) * 100;

      const depositGrowth = Object.entries(deltas).reduce(
        (s, [factor, delta]) =>
          s +
          delta *
            (FACTOR_BETAS[factor as keyof typeof FACTOR_BETAS]?.deposits ?? 0),
        0,
      );

      const loanGrowth = Object.entries(deltas).reduce(
        (s, [factor, delta]) =>
          s +
          delta *
            (FACTOR_BETAS[factor as keyof typeof FACTOR_BETAS]?.loans ?? 0),
        0,
      );

      const narrativeEn = `Under "${scenario.name}" (GDP ${(scenario.gdpGrowth * 100).toFixed(1)}%, CPI ${(scenario.cpi * 100).toFixed(1)}%, unemployment ${(scenario.unemployment * 100).toFixed(1)}%): NII impact ${niiImpact >= 0 ? '+' : ''}${niiImpact.toFixed(1)}%, NPL change ${nplImpact >= 0 ? '+' : ''}${nplImpact.toFixed(0)}bps, deposit growth ${(depositGrowth * 100).toFixed(1)}%.`;
      const narrativeEs = `Bajo "${scenario.nameEs}" (PIB ${(scenario.gdpGrowth * 100).toFixed(1)}%, IPC ${(scenario.cpi * 100).toFixed(1)}%, desempleo ${(scenario.unemployment * 100).toFixed(1)}%): impacto NII ${niiImpact >= 0 ? '+' : ''}${niiImpact.toFixed(1)}%, cambio NPL ${nplImpact >= 0 ? '+' : ''}${nplImpact.toFixed(0)}bps, crecimiento depósitos ${(depositGrowth * 100).toFixed(1)}%.`;

      return {
        scenario,
        niiImpactPct: +niiImpact.toFixed(2),
        nplImpactBps: +nplImpact.toFixed(0),
        lcrImpact: +lcrImpact.toFixed(1),
        nwrImpact: +(-nplImpact * 0.01).toFixed(2),
        ceclProvisionChange: +(nplImpact * 0.3).toFixed(1),
        depositGrowth: +(depositGrowth * 100).toFixed(1),
        loanGrowth: +(loanGrowth * 100).toFixed(1),
        narrativeEs,
        narrativeEn: narrativeEn,
      };
    });

    // Factor sensitivity table
    const sensitivity = [
      {
        factor: 'GDP Growth (+1%)',
        factorEs: 'Crecimiento PIB (+1%)',
        niiSensitivity: +(FACTOR_BETAS.gdpGrowth.nii * 100).toFixed(1),
        nplSensitivity: +(FACTOR_BETAS.gdpGrowth.npl * 100).toFixed(1),
      },
      {
        factor: 'CPI (+1%)',
        factorEs: 'IPC (+1%)',
        niiSensitivity: +(FACTOR_BETAS.cpi.nii * 100).toFixed(1),
        nplSensitivity: +(FACTOR_BETAS.cpi.npl * 100).toFixed(1),
      },
      {
        factor: 'Unemployment (+1pp)',
        factorEs: 'Desempleo (+1pp)',
        niiSensitivity: +(FACTOR_BETAS.unemployment.nii * 100).toFixed(1),
        nplSensitivity: +(FACTOR_BETAS.unemployment.npl * 100).toFixed(1),
      },
      {
        factor: 'Housing Prices (+1%)',
        factorEs: 'Precios Vivienda (+1%)',
        niiSensitivity: +(FACTOR_BETAS.housingPriceChange.nii * 100).toFixed(1),
        nplSensitivity: +(FACTOR_BETAS.housingPriceChange.npl * 100).toFixed(1),
      },
      {
        factor: 'Fed Funds (+100bps)',
        factorEs: 'Fed Funds (+100bps)',
        niiSensitivity: +(FACTOR_BETAS.fedFundsRate.nii * 100).toFixed(1),
        nplSensitivity: +(FACTOR_BETAS.fedFundsRate.npl * 100).toFixed(1),
      },
    ];

    return {
      baselineScenario: baseline,
      scenarios,
      currentRegime: 'PLATEAU',
      sensitivity,
    };
  }
}
