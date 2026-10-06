/**
 * COSSEC Named Regulatory Scenarios for Stress Testing
 *
 * These scenarios are specific to Puerto Rico cooperativas and align with
 * COSSEC examination guidelines. The PR Hurricane scenario is unique to
 * CERNIQ — it models the combined rate / deposit / credit shock that
 * cooperativas face during natural disasters.
 */

export interface NamedScenario {
  id: string;
  name: string;
  nameEs: string;
  type: 'parallel' | 'steepening' | 'flattening' | 'pr_specific' | 'macro';
  rateShiftBps: number;
  depositShockPct: number; // e.g., -5 means 5% deposit outflow
  creditShockPct: number; // e.g., +2 means 2% increase in defaults
  /**
   * Loan segment the credit shock targets. Omitted / `'all'` ⇒ applied to the
   * whole loan book (the historical behaviour for every existing scenario).
   * `'consumer'` / `'residential'` / `'commercial'` ⇒ applied only to that
   * segment's balance, so the credit loss reflects where the deterioration
   * actually lands (SIC 2026 hits the consumer book, not mortgages/commercial).
   */
  creditShockSegment?: 'consumer' | 'residential' | 'commercial' | 'all';
  description: string;
  descriptionEs: string;
  regulatoryBasis: string;
}

export interface NamedScenarioResult {
  scenario: NamedScenario;
  niiImpact: number; // $ impact on NII
  niiImpactPct: number; // % change vs base NII
  depositImpact: number; // $ deposit outflow
  creditLoss: number; // $ additional credit losses
  totalImpact: number; // NII + deposit cost + credit loss combined
  totalImpactPct: number; // % of base NII
  passFailStatus: 'pass' | 'warn' | 'fail';
}

export const COSSEC_SCENARIOS: NamedScenario[] = [
  {
    id: 'parallel_up_100',
    name: 'Parallel +100bps',
    nameEs: 'Paralelo +100pbs',
    type: 'parallel',
    rateShiftBps: 100,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Uniform rate increase across all maturities',
    descriptionEs: 'Aumento uniforme de tasas en todos los plazos',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'parallel_up_200',
    name: 'Parallel +200bps',
    nameEs: 'Paralelo +200pbs',
    type: 'parallel',
    rateShiftBps: 200,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Moderate rate increase stress test',
    descriptionEs: 'Prueba de estrés con aumento moderado de tasas',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'parallel_up_300',
    name: 'Parallel +300bps',
    nameEs: 'Paralelo +300pbs',
    type: 'parallel',
    rateShiftBps: 300,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Severe rate increase stress test',
    descriptionEs: 'Prueba de estrés severa con aumento de tasas',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'parallel_down_100',
    name: 'Parallel -100bps',
    nameEs: 'Paralelo -100pbs',
    type: 'parallel',
    rateShiftBps: -100,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Rate decrease scenario',
    descriptionEs: 'Escenario de disminución de tasas',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'steepening',
    name: 'Yield Curve Steepening',
    nameEs: 'Empinamiento de Curva',
    type: 'steepening',
    rateShiftBps: 200, // short +200bps, long +100bps
    depositShockPct: -2,
    creditShockPct: 0,
    description:
      'Short rates +200bps, long rates +100bps — deposit competition',
    descriptionEs:
      'Tasas cortas +200pbs, tasas largas +100pbs — competencia por depósitos',
    regulatoryBasis: 'COSSEC Enhanced Scenario Guidelines',
  },
  {
    id: 'parallel_down_200',
    name: 'Parallel -200bps',
    nameEs: 'Paralelo -200pbs',
    type: 'parallel',
    rateShiftBps: -200,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Moderate rate decrease — margin compression test',
    descriptionEs:
      'Disminución moderada de tasas — prueba de compresión de margen',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'parallel_down_300',
    name: 'Parallel -300bps',
    nameEs: 'Paralelo -300pbs',
    type: 'parallel',
    rateShiftBps: -300,
    depositShockPct: 0,
    creditShockPct: 0,
    description: 'Severe rate decrease — zero-bound proximity test',
    descriptionEs:
      'Disminución severa de tasas — prueba de cercanía al límite cero',
    regulatoryBasis: 'COSSEC Standard Scenario Set',
  },
  {
    id: 'pr_hurricane_stress',
    name: 'PR Hurricane Stress',
    nameEs: 'Estrés Huracán PR',
    type: 'pr_specific',
    rateShiftBps: 150,
    depositShockPct: -5,
    creditShockPct: 2,
    description:
      'Rates +150bps, deposits -5%, loan defaults +2% — hurricane/disaster scenario',
    descriptionEs:
      'Tasas +150pbs, depósitos -5%, morosidad +2% — escenario huracán/desastre',
    regulatoryBasis: 'COSSEC Hurricane Preparedness Guidelines',
  },
  {
    id: 'pr_migration_stress',
    name: 'PR Population Migration Stress',
    nameEs: 'Estrés Migración Poblacional PR',
    type: 'pr_specific',
    rateShiftBps: 0,
    depositShockPct: -8,
    creditShockPct: 1.5,
    description:
      'Deposits -8%, loan defaults +1.5% — sustained out-migration of working-age members (US Census PR trend)',
    descriptionEs:
      'Depósitos -8%, morosidad +1.5% — emigración sostenida de socios en edad laboral (tendencia Censo PR)',
    regulatoryBasis: 'CERNIQ PR Scenario Library — Census Bureau PR estimates',
  },
  {
    id: 'pr_tourism_stress',
    name: 'PR Tourism Revenue Stress',
    nameEs: 'Estrés Ingresos Turismo PR',
    type: 'pr_specific',
    rateShiftBps: -50,
    depositShockPct: -3,
    creditShockPct: 2.5,
    description:
      'Rates -50bps, deposits -3%, defaults +2.5% concentrated in commercial — tourism revenue collapse (recessionary)',
    descriptionEs:
      'Tasas -50pbs, depósitos -3%, morosidad +2.5% concentrada en comercial — caída de ingresos turísticos (recesión)',
    regulatoryBasis: 'CERNIQ PR Scenario Library — tourism dependency analysis',
  },
  {
    // Global macro shock (rate + credit + deposit) — distinct from the curve-shape
    // types and from `pr_specific`. The `macro` type is treated by the engine like a
    // parallel rate move (only `steepening` is special-cased) with the credit/deposit
    // shocks layered on via their own fields.
    id: 'sic_2026_global_restructuring',
    name: 'SIC 2026 — Global Restructuring',
    nameEs: 'SIC 2026 — Reestructuración Global',
    type: 'macro',
    rateShiftBps: 200,
    depositShockPct: -5,
    creditShockPct: 3,
    creditShockSegment: 'consumer',
    description:
      'Combined macro shock — +200bps parallel rate rise, +3% consumer default-rate increase (applied to the consumer loan book), and 5% deposit runoff over 12 months. Models the Strategic Investment Conference 2026 "Global Restructuring" theme.',
    descriptionEs:
      'Choque macro combinado — alza paralela de tasas +200pbs, aumento de morosidad de consumo +3% y fuga de depósitos 5% en 12 meses. Modela el tema "Reestructuración Global" de la Strategic Investment Conference 2026.',
    regulatoryBasis:
      'CERNIQ Macro Scenario Library — Mauldin SIC 2026 (The Global Restructuring)',
  },
];
