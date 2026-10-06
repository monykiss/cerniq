/**
 * ALM KPI / parameter / column label dictionary — bilingual (EN/ES).
 *
 * Backend responses speak in camelCase / snake_case identifiers (`nim`, `lcr`,
 * `lambda_0`, `loanToShare`). This file maps them to display labels so module
 * pages never render raw TypeScript identifiers to end users.
 *
 * Adding a new key:
 *   1. Add it to LABELS with both en and es spellings
 *   2. Add `unit` if numeric so NumberCell formats correctly
 *   3. Optionally add `description` for tooltips and `regulatoryRef` for audit
 *
 * Calling code MUST go through `label(key, locale)` — never render keys directly.
 * scripts/verify-alm-labels.mjs grep-fails on `{key}` patterns inside JSX under
 * app/alm/, so the rule is enforced at CI time.
 */

import type { Locale } from '@/lib/i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LabelUnit = '%' | 'bps' | 'USD' | 'USD_M' | 'USD_K' | 'x' | 'days' | 'years' | 'count' | 'ratio';

export interface Label {
  readonly en: string;
  readonly es: string;
  /** Display unit for NumberCell formatting */
  readonly unit?: LabelUnit;
  /** Long-form description for tooltips */
  readonly description?: { readonly en: string; readonly es: string };
  /** Citation if this metric satisfies a regulatory requirement */
  readonly regulatoryRef?: string;
  /** Number of decimal places when rendered (overrides unit default) */
  readonly precision?: number;
}

// ─── Dictionary ──────────────────────────────────────────────────────────────

export const LABELS: Readonly<Record<string, Label>> = {
  // ── Profitability KPIs ─────────────────────────────────────────────────────
  nim:               { en: 'Net Interest Margin',         es: 'Margen de Interés Neto',           unit: '%',     description: { en: 'Net interest income / earning assets', es: 'Ingreso neto de interés / activos productivos' } },
  nii:               { en: 'Net Interest Income',         es: 'Ingreso de Interés Neto',          unit: 'USD_M' },
  roa:               { en: 'Return on Assets',            es: 'Retorno sobre Activos',            unit: '%' },
  roe:               { en: 'Return on Equity',            es: 'Retorno sobre Patrimonio',         unit: '%' },
  efficiency_ratio:  { en: 'Efficiency Ratio',            es: 'Ratio de Eficiencia',              unit: '%' },
  cost_of_funds:     { en: 'Cost of Funds',               es: 'Costo de Fondos',                  unit: '%' },
  yield_on_assets:   { en: 'Yield on Assets',             es: 'Rendimiento de Activos',           unit: '%' },
  net_income:        { en: 'Net Income',                  es: 'Ingreso Neto',                     unit: 'USD_M' },
  noninterest_income:{ en: 'Non-Interest Income',         es: 'Ingreso No por Interés',           unit: 'USD_M' },
  noninterest_expense:{ en: 'Non-Interest Expense',       es: 'Gasto No por Interés',             unit: 'USD_M' },
  pnl:               { en: 'P&L',                         es: 'P&G',                              unit: 'USD_M' },
  daily_pnl:         { en: 'Daily P&L',                   es: 'P&G Diario',                       unit: 'USD_M' },
  portfolio_value:   { en: 'Portfolio Value',             es: 'Valor del Portafolio',             unit: 'USD_M' },
  total_balance:     { en: 'Total Balance',               es: 'Balance Total',                    unit: 'USD_M' },
  total_allowance:   { en: 'Total Allowance',             es: 'Provisión Total',                  unit: 'USD_M' },
  allowance_required:{ en: 'Allowance Required',          es: 'Provisión Requerida',              unit: 'USD_M' },
  provision_12m:     { en: '12M Provision',               es: 'Provisión 12M',                    unit: 'USD_M' },
  segment_count:     { en: 'Segments',                    es: 'Segmentos',                        unit: 'count' },
  methodology:       { en: 'Methodology',                 es: 'Metodología' },

  // ── Liquidity KPIs ─────────────────────────────────────────────────────────
  lcr:               { en: 'Liquidity Coverage Ratio',    es: 'Ratio de Cobertura de Liquidez',   unit: '%',     regulatoryRef: 'Basel III LCR' },
  nsfr:              { en: 'Net Stable Funding Ratio',    es: 'Ratio de Financiamiento Estable', unit: '%',     regulatoryRef: 'Basel III NSFR' },
  hqla:              { en: 'High Quality Liquid Assets',  es: 'Activos Líquidos de Alta Calidad', unit: 'USD_M' },
  loan_to_deposit:   { en: 'Loan-to-Deposit',             es: 'Préstamo / Depósito',              unit: '%' },
  loanShare:         { en: 'Loan Share',                  es: 'Cuota de Préstamos',               unit: '%' },
  loanToShare:       { en: 'Loan-to-Share',               es: 'Préstamo / Aportación',            unit: '%' },
  cash_ratio:        { en: 'Cash Ratio',                  es: 'Ratio de Efectivo',                unit: '%' },
  liquidity_ratio:   { en: 'Liquidity Ratio',             es: 'Ratio de Liquidez',                unit: '%' },
  runoff_rate:       { en: 'Runoff Rate',                 es: 'Tasa de Decaimiento',              unit: '%' },

  // ── Capital / Solvency KPIs ────────────────────────────────────────────────
  nwr:               { en: 'Net Worth Ratio',             es: 'Ratio de Patrimonio Neto',         unit: '%',     regulatoryRef: 'NCUA RBC2' },
  car:               { en: 'Capital Adequacy Ratio',      es: 'Ratio de Adecuación de Capital',   unit: '%',     regulatoryRef: 'Basel III' },
  tier1:             { en: 'Tier 1 Capital',              es: 'Capital Tier 1',                   unit: 'USD_M' },
  tier1_ratio:       { en: 'Tier 1 Ratio',                es: 'Ratio Tier 1',                     unit: '%' },
  tier2:             { en: 'Tier 2 Capital',              es: 'Capital Tier 2',                   unit: 'USD_M' },
  total_capital:     { en: 'Total Capital',               es: 'Capital Total',                    unit: 'USD_M' },
  rwa:               { en: 'Risk-Weighted Assets',        es: 'Activos Ponderados por Riesgo',    unit: 'USD_M' },
  leverage_ratio:    { en: 'Leverage Ratio',              es: 'Ratio de Apalancamiento',          unit: '%' },
  rbc:               { en: 'Risk-Based Capital',          es: 'Capital Basado en Riesgo',         unit: '%' },
  cet1:              { en: 'CET1 Capital',                es: 'Capital CET1',                     unit: 'USD_M' },

  // ── Asset Quality / Credit KPIs ────────────────────────────────────────────
  npl:               { en: 'Non-Performing Loans',        es: 'Préstamos Morosos',                unit: '%' },
  npl_ratio:         { en: 'NPL Ratio',                   es: 'Ratio de Morosidad',               unit: '%' },
  nplr:              { en: 'NPL Ratio',                   es: 'Ratio de Morosidad',               unit: '%' },
  cecl:              { en: 'CECL Reserve',                es: 'Reserva CECL',                     unit: '%',     regulatoryRef: 'CECL ASC 326' },
  alll:              { en: 'ALLL',                        es: 'ALLL',                             unit: 'USD_M' },
  net_charge_offs:   { en: 'Net Charge-Offs',             es: 'Castigos Netos',                   unit: '%' },
  net_outflows:      { en: 'Net Cash Outflows',           es: 'Salidas de Efectivo Netas',        unit: 'USD_M' },
  buffer:            { en: 'Buffer',                      es: 'Búfer',                            unit: '%' },
  scenario_count:    { en: 'Scenarios',                   es: 'Escenarios',                       unit: 'count' },
  min_nwr:           { en: 'Min Net Worth Ratio',         es: 'NWR Mínimo',                       unit: '%' },
  min_lcr:           { en: 'Min LCR',                     es: 'LCR Mínimo',                       unit: '%' },
  cum_nii_loss:      { en: 'Cumulative NII Loss',         es: 'Pérdida NII Acumulada',            unit: 'USD_M' },
  adequate_count:    { en: 'Capital Adequate',            es: 'Capital Adecuado',                 unit: 'count' },
  nim_prior:         { en: 'NIM Prior',                   es: 'NIM Previo',                       unit: '%' },
  nim_current:       { en: 'NIM Current',                 es: 'NIM Actual',                       unit: '%' },
  nim_delta:         { en: 'NIM Change',                  es: 'Cambio NIM',                       unit: 'bps' },
  explained_bps:     { en: 'Explained',                   es: 'Explicado',                        unit: 'bps' },
  residual_bps:      { en: 'Residual',                    es: 'Residual',                         unit: 'bps' },
  expected_return:   { en: 'Expected Return',             es: 'Retorno Esperado',                 unit: 'ratio' },
  risk_budget:       { en: 'Risk Budget',                 es: 'Presupuesto de Riesgo',            unit: 'ratio' },
  view_count:        { en: 'Active Views',                es: 'Opiniones Activas',                unit: 'count' },
  asset_count:       { en: 'Asset Classes',               es: 'Clases de Activo',                 unit: 'count' },
  current_vol:       { en: 'Current Volatility',          es: 'Volatilidad Actual',               unit: '%' },
  long_run_vol:      { en: 'Long-Run Volatility',         es: 'Volatilidad Largo Plazo',          unit: '%' },
  ljung_box:         { en: 'Ljung-Box p-Value',           es: 'p-Valor Ljung-Box',                unit: 'x' },
  initial_rate:      { en: 'Initial Rate',                es: 'Tasa Inicial',                     unit: 'ratio' },
  terminal_rate:     { en: 'Terminal Rate',               es: 'Tasa Terminal',                    unit: 'ratio' },
  range_bps:         { en: 'Range (bps)',                 es: 'Rango (bps)',                      unit: 'bps' },
  theta_points:      { en: 'θ Points',                    es: 'Puntos θ',                         unit: 'count' },
  aic:               { en: 'AIC',                         es: 'AIC',                              unit: 'x' },
  total_checks:      { en: 'Total Checks',                es: 'Chequeos Totales',                 unit: 'count' },
  breach_count:      { en: 'Breaches',                    es: 'Incumplimientos',                  unit: 'count' },
  warning_count:     { en: 'Warnings',                    es: 'Advertencias',                     unit: 'count' },
  watch_count:       { en: 'Watches',                     es: 'Vigilancia',                       unit: 'count' },
  compliant:         { en: 'Compliant',                   es: 'Cumple',                           unit: 'count' },
  readiness_score:   { en: 'Exam Readiness',              es: 'Preparación para Examen',          unit: '%' },
  camel_composite:   { en: 'CAMEL Composite',             es: 'CAMEL Compuesto',                  unit: 'x' },
  open_findings:     { en: 'Open Findings',               es: 'Hallazgos Abiertos',               unit: 'count' },
  total_findings:    { en: 'Total Findings',              es: 'Hallazgos Totales',                unit: 'count' },
  ready_docs:        { en: 'Documents Ready',             es: 'Documentos Listos',                unit: 'count' },
  missing_docs:      { en: 'Documents Missing',           es: 'Documentos Faltantes',             unit: 'count' },
  paths:             { en: 'Paths',                       es: 'Senderos',                         unit: 'count' },
  mean_nii:          { en: 'Expected NII',                es: 'NII Esperado',                     unit: 'USD_M' },
  std_nii:           { en: 'Std Deviation NII',           es: 'Desv. Estándar NII',               unit: 'USD_M' },
  cvar_99:           { en: 'CVaR 99%',                    es: 'CVaR 99%',                         unit: 'USD_M' },
  portfolio_dd:      { en: 'Portfolio Distance-to-Default',es: 'DD del Portafolio',                unit: 'x' },
  portfolio_edf:     { en: 'Portfolio EDF',                es: 'EDF del Portafolio',               unit: 'ratio' },
  obligor_count:     { en: 'Obligors',                     es: 'Obligados',                        unit: 'count' },
  gaussian_var:      { en: 'Gaussian VaR',                 es: 'VaR Gaussiano',                    unit: 'USD_M' },
  t_copula_var:      { en: 't-Copula VaR',                 es: 'VaR t-Cópula',                     unit: 'USD_M' },
  tail_dependence:   { en: 'Tail Dependence',              es: 'Dependencia de Cola',              unit: 'ratio' },
  excess_ratio:      { en: 'Excess Ratio',                 es: 'Ratio de Exceso',                  unit: 'x' },
  optimal_return:    { en: 'Optimal Return',               es: 'Retorno Óptimo',                   unit: 'ratio' },
  optimal_cvar:      { en: 'Optimal CVaR',                 es: 'CVaR Óptimo',                      unit: 'ratio' },
  optimal_sharpe:    { en: 'Optimal Sharpe',               es: 'Sharpe Óptimo',                    unit: 'x' },
  svensson_rmse:     { en: 'Svensson RMSE',                es: 'RMSE Svensson',                    unit: 'bps' },
  ns_rmse:           { en: 'Nelson-Siegel RMSE',           es: 'RMSE Nelson-Siegel',               unit: 'bps' },
  improvement:       { en: 'Improvement',                  es: 'Mejora',                           unit: '%' },
  tenor_points:      { en: 'Tenor Points',                 es: 'Puntos de Tenor',                  unit: 'count' },
  credit_unions:     { en: 'Credit Unions',                es: 'Cooperativas',                     unit: 'count' },
  population:        { en: 'Population',                   es: 'Población',                        unit: 'count' },
  hurricane_cpr:     { en: 'Hurricane CPR Spike',          es: 'Spike CPR Huracán',                unit: 'ratio' },
  compliance_events: { en: 'Compliance Events',            es: 'Eventos de Cumplimiento',          unit: 'count' },
  rbc2_ratio:        { en: 'RBC2 Ratio',                   es: 'Ratio RBC2',                       unit: 'ratio' },
  net_worth:         { en: 'Net Worth',                    es: 'Patrimonio Neto',                  unit: 'USD_M' },
  total_rwa:         { en: 'Total Risk-Weighted Assets',   es: 'Activos Ponderados por Riesgo',    unit: 'USD_M' },
  well_cap_thresh:   { en: 'Well-Cap Threshold',           es: 'Umbral Bien Capitalizado',         unit: 'ratio' },
  adequate_thresh:   { en: 'Adequate Threshold',           es: 'Umbral Adecuado',                  unit: 'ratio' },
  component_count:   { en: 'Components',                   es: 'Componentes',                      unit: 'count' },
  shock_count:       { en: 'Shock Scenarios',              es: 'Escenarios de Choque',             unit: 'count' },
  coverage_ratio:    { en: 'Coverage Ratio',              es: 'Ratio de Cobertura',               unit: '%' },
  pd:                { en: 'Probability of Default',      es: 'Probabilidad de Incumplimiento',   unit: '%' },
  lgd:               { en: 'Loss Given Default',          es: 'Pérdida Dado Incumplimiento',      unit: '%' },
  ead:               { en: 'Exposure at Default',         es: 'Exposición al Incumplimiento',     unit: 'USD_M' },
  el:                { en: 'Expected Loss',               es: 'Pérdida Esperada',                 unit: 'USD_M' },
  ul:                { en: 'Unexpected Loss',             es: 'Pérdida Inesperada',               unit: 'USD_M' },
  recovery_rate:     { en: 'Recovery Rate',               es: 'Tasa de Recuperación',             unit: '%' },
  hhi:               { en: 'HHI Concentration',           es: 'Concentración HHI',                unit: 'count' },

  // ── Risk KPIs ──────────────────────────────────────────────────────────────
  eve:               { en: 'Economic Value of Equity',    es: 'Valor Económico del Patrimonio',   unit: '%',     description: { en: 'EVE under ±200bp parallel shock', es: 'EVE bajo choque paralelo ±200bp' } },
  ear:               { en: 'Earnings at Risk',            es: 'Ganancias en Riesgo',              unit: 'USD_M' },
  var:               { en: 'Value at Risk',               es: 'Valor en Riesgo',                  unit: 'USD_M' },
  var95:             { en: 'VaR 95%',                     es: 'VaR 95%',                          unit: 'USD_M' },
  var99:             { en: 'VaR 99%',                     es: 'VaR 99%',                          unit: 'USD_M' },
  cvar:              { en: 'CVaR / Expected Shortfall',   es: 'CVaR / Déficit Esperado',          unit: 'USD_M' },
  es95:              { en: 'Expected Shortfall 95%',      es: 'Déficit Esperado 95%',             unit: 'USD_M' },
  es99:              { en: 'Expected Shortfall 99%',      es: 'Déficit Esperado 99%',             unit: 'USD_M' },
  duration:          { en: 'Duration',                    es: 'Duración',                         unit: 'years' },
  modified_duration: { en: 'Modified Duration',           es: 'Duración Modificada',              unit: 'years' },
  convexity:         { en: 'Convexity',                   es: 'Convexidad',                       unit: 'x' },
  dv01:              { en: 'DV01',                        es: 'DV01',                             unit: 'USD_K' },
  krd01:             { en: 'KRD01',                       es: 'KRD01',                            unit: 'USD_K' },
  sharpe:            { en: 'Sharpe Ratio',                es: 'Ratio Sharpe',                     unit: 'x' },
  sortino:           { en: 'Sortino Ratio',               es: 'Ratio Sortino',                    unit: 'x' },

  // ── Yield Curve Parameters (Nelson-Siegel / Svensson) ──────────────────────
  beta:              { en: 'β (Slope)',                   es: 'β (Pendiente)' },
  beta0:             { en: 'β₀ (Long-Run Level)',         es: 'β₀ (Nivel Largo Plazo)' },
  beta1:             { en: 'β₁ (Slope)',                  es: 'β₁ (Pendiente)' },
  beta2:             { en: 'β₂ (Curvature)',              es: 'β₂ (Curvatura)' },
  beta3:             { en: 'β₃ (Second Hump)',            es: 'β₃ (Segunda Joroba)' },
  lambda:            { en: 'λ (Decay)',                   es: 'λ (Decaimiento)' },
  lambda_0:          { en: 'λ₀ (Decay 1)',                es: 'λ₀ (Decaimiento 1)' },
  lambda_1:          { en: 'λ₁ (Decay 2)',                es: 'λ₁ (Decaimiento 2)' },
  lambda2:           { en: 'λ₂ (Second Decay)',           es: 'λ₂ (Segundo Decaimiento)' },
  tau:               { en: 'τ (Mean Reversion)',          es: 'τ (Reversión a la Media)' },
  tau1:              { en: 'τ₁',                          es: 'τ₁' },
  tau2:              { en: 'τ₂',                          es: 'τ₂' },

  // ── Hull-White / CIR / Vasicek parameters ──────────────────────────────────
  kappa:             { en: 'κ (Mean Reversion Speed)',    es: 'κ (Velocidad Reversión)' },
  theta:             { en: 'θ (Long-Term Mean)',          es: 'θ (Media Largo Plazo)' },
  sigma:             { en: 'σ (Volatility)',              es: 'σ (Volatilidad)' },
  sigmaE:            { en: 'σₑ (Equity Volatility)',      es: 'σₑ (Volatilidad Patrimonio)' },
  rho:               { en: 'ρ (Correlation)',             es: 'ρ (Correlación)' },
  alpha:             { en: 'α',                           es: 'α' },
  omega:             { en: 'ω',                           es: 'ω' },

  // ── GARCH parameters ───────────────────────────────────────────────────────
  garch_alpha:       { en: 'α (ARCH)',                    es: 'α (ARCH)' },
  garch_beta:        { en: 'β (GARCH)',                   es: 'β (GARCH)' },
  garch_omega:       { en: 'ω (Constant)',                es: 'ω (Constante)' },
  persistence:       { en: 'Persistence (α+β)',           es: 'Persistencia (α+β)' },
  half_life:         { en: 'Half-Life',                   es: 'Vida Media',                       unit: 'days' },

  // ── Misc structural ────────────────────────────────────────────────────────
  distance_to_default:{ en: 'Distance to Default',        es: 'Distancia al Incumplimiento',      unit: 'x' },
  asset_value:       { en: 'Asset Value',                 es: 'Valor de Activos',                 unit: 'USD_M' },
  asset_volatility:  { en: 'Asset Volatility',            es: 'Volatilidad de Activos',           unit: '%' },
  default_barrier:   { en: 'Default Barrier',             es: 'Barrera de Incumplimiento',        unit: 'USD_M' },

  // ── Backtest / diagnostics ─────────────────────────────────────────────────
  exceptions:        { en: 'Exceptions',                  es: 'Excepciones',                      unit: 'count' },
  exception_rate:    { en: 'Exception Rate',              es: 'Tasa de Excepciones',              unit: '%' },
  expected_exceptions:{ en: 'Expected Exceptions',        es: 'Excepciones Esperadas',            unit: 'count' },
  kupiec_lr:         { en: 'Kupiec LR',                   es: 'LR de Kupiec',                     unit: 'x' },
  kupiec_p_value:    { en: 'Kupiec p-Value',              es: 'p-Valor Kupiec',                   unit: 'x' },
  rmse:              { en: 'RMSE',                        es: 'RMSE',                             unit: 'bps' },

  // ── Identity / metadata ────────────────────────────────────────────────────
  count:             { en: 'Count',                       es: 'Cantidad',                         unit: 'count' },
  total:             { en: 'Total',                       es: 'Total' },
  average:           { en: 'Average',                     es: 'Promedio' },
  median:            { en: 'Median',                      es: 'Mediana' },
  min:               { en: 'Min',                         es: 'Mín' },
  max:               { en: 'Max',                         es: 'Máx' },
  p25:               { en: '25th Percentile',             es: 'Percentil 25' },
  p50:               { en: '50th Percentile',             es: 'Percentil 50' },
  p75:               { en: '75th Percentile',             es: 'Percentil 75' },
  p95:               { en: '95th Percentile',             es: 'Percentil 95' },
  p99:               { en: '99th Percentile',             es: 'Percentil 99' },

  // ── Member 360 (Wave 3 / Layer 3) ──────────────────────────────────────────
  memberNumber:              { en: 'Member #',              es: 'Núm. de Socio' },
  fullName:                  { en: 'Name',                  es: 'Nombre' },
  memberSince:               { en: 'Member Since',          es: 'Socio Desde' },
  lifecycleStage:            { en: 'Lifecycle Stage',       es: 'Etapa del Ciclo' },
  riskScore:                 { en: 'Risk Score',            es: 'Puntaje de Riesgo',     unit: 'count' },
  totalDeposits:             { en: 'Deposits',              es: 'Depósitos',             unit: 'USD' },
  totalShares:               { en: 'Shares',                es: 'Aportaciones',          unit: 'USD' },
  totalLoans:                { en: 'Loans',                 es: 'Préstamos',             unit: 'USD' },
  activeLoanBalance:         { en: 'Active Loan Balance',   es: 'Balance Préstamo Activo', unit: 'USD' },
  loanToDepositRatio:        { en: 'Loan-to-Deposit',       es: 'Préstamo / Depósito',   unit: 'ratio' },
  ceclStage:                 { en: 'CECL Stage',            es: 'Etapa CECL',            unit: 'count' },
  worstCossecClassification: { en: 'COSSEC Classification', es: 'Clasificación COSSEC' },
  delinquencyDays:           { en: 'Days Past Due',         es: 'Días de Mora',          unit: 'days' },
  interestRate:              { en: 'Rate',                  es: 'Tasa',                  unit: '%' },
  productType:               { en: 'Product',               es: 'Producto' },
  openedDate:                { en: 'Opened',                es: 'Apertura' },
  maturityDate:              { en: 'Maturity',              es: 'Vencimiento' },
  balance:                   { en: 'Balance',               es: 'Balance',               unit: 'USD' },
} as const;

export type KnownLabelKey = keyof typeof LABELS;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HUMANIZE_CACHE = new Map<string, string>();
const WARNED_KEYS = new Set<string>();

/**
 * Humanize an unknown identifier as a last-resort fallback.
 *   'loanToShare' → 'Loan To Share'
 *   'lambda_0'    → 'Lambda 0'
 *   'rate-shock'  → 'Rate Shock'
 *
 * Cached because the same key may be rendered hundreds of times per second.
 */
export function humanize(key: string): string {
  const cached = HUMANIZE_CACHE.get(key);
  if (cached !== undefined) return cached;

  const out = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase boundary
    .replace(/[_-]+/g, ' ')                    // snake/kebab → space
    .replace(/\s+/g, ' ')                      // collapse spaces
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()); // Title Case

  HUMANIZE_CACHE.set(key, out);
  return out;
}

/**
 * Resolve a backend identifier to a localized display label.
 *
 * Lookup order:
 *   1. Exact match in LABELS dictionary
 *   2. Lowercase match in LABELS dictionary
 *   3. humanize() fallback (with one-shot dev console warning)
 *
 * NEVER returns the raw key — even if completely unknown, you get Title Case.
 */
export function label(key: string, locale: Locale): string {
  const direct = LABELS[key];
  if (direct) return direct[locale];

  const lower = LABELS[key.toLowerCase()];
  if (lower) return lower[locale];

  if (process.env.NODE_ENV !== 'production' && !WARNED_KEYS.has(key)) {
    WARNED_KEYS.add(key);
    console.warn(
      `[alm/labels] missing entry for key "${key}" — falling back to humanize(). ` +
      `Add it to lib/alm/labels.ts to make this label first-class bilingual.`,
    );
  }

  return humanize(key);
}

/** Resolve the unit for a key (e.g. for NumberCell formatting). */
export function labelUnit(key: string): LabelUnit | undefined {
  return LABELS[key]?.unit ?? LABELS[key.toLowerCase()]?.unit;
}

/** Resolve the full Label record (for tooltips, regulatory refs, etc). */
export function labelMeta(key: string): Label | undefined {
  return LABELS[key] ?? LABELS[key.toLowerCase()];
}

/** True if the key is a first-class registered label (not a humanize fallback). */
export function isKnownLabel(key: string): boolean {
  return key in LABELS || key.toLowerCase() in LABELS;
}
