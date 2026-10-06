/**
 * COSSEC (Corporación para la Supervisión y Seguro de Cooperativas)
 * Puerto Rico Cooperativa Regulatory Framework
 *
 * 12 ratios matching the getCOSSECCompliance() engine in alm-enterprise.service.ts.
 * Weights sum to 100 for the exam-readiness score.
 */

import {
  IRegulatoryFramework,
  RegulatoryRatio,
} from './regulatory-framework.interface';

const COSSEC_RATIOS: RegulatoryRatio[] = [
  {
    id: 1,
    name: 'Capital Adequacy',
    nameEs: 'Suficiencia de Capital',
    category: 'capital',
    threshold: '>= 8%',
    thresholdDirection: 'gte',
    weight: 20,
  },
  {
    id: 2,
    name: 'Asset Quality (Est.)',
    nameEs: 'Calidad de Activos (Est.)',
    category: 'asset_quality',
    threshold: '<= 3%',
    thresholdDirection: 'lte',
    weight: 15,
  },
  {
    id: 3,
    name: 'Liquidity Ratio',
    nameEs: 'Razón de Liquidez',
    category: 'liquidity',
    threshold: '>= 5%',
    thresholdDirection: 'gte',
    weight: 10,
  },
  {
    id: 4,
    name: 'Loan-to-Deposit Ratio',
    nameEs: 'Razón Préstamos/Depósitos',
    category: 'liquidity',
    threshold: '<= 80%',
    thresholdDirection: 'lte',
    weight: 10,
  },
  {
    id: 5,
    name: 'NII Sensitivity',
    nameEs: 'Sensibilidad NII',
    category: 'sensitivity',
    threshold: '<= 15% per 100bps',
    thresholdDirection: 'info',
    weight: 10,
  },
  {
    id: 6,
    name: 'Duration Gap',
    nameEs: 'Brecha de Duración',
    category: 'sensitivity',
    threshold: '-1yr to +3yr',
    thresholdDirection: 'range',
    weight: 10,
  },
  {
    id: 7,
    name: 'EVE Sensitivity',
    nameEs: 'Sensibilidad EVE',
    category: 'sensitivity',
    threshold: '<= 25%',
    thresholdDirection: 'lte',
    weight: 5,
  },
  {
    id: 8,
    name: 'Concentration Risk',
    nameEs: 'Riesgo de Concentración',
    category: 'asset_quality',
    threshold: '<= 25%',
    thresholdDirection: 'lte',
    weight: 5,
  },
  {
    id: 9,
    name: 'LCR (Basel III)',
    nameEs: 'LCR (Basilea III)',
    category: 'liquidity',
    threshold: '>= 100%',
    thresholdDirection: 'gte',
    weight: 5,
  },
  {
    id: 10,
    name: 'Earning Assets Yield',
    nameEs: 'Rendimiento Activos Productivos',
    category: 'earnings',
    threshold: 'Benchmark',
    thresholdDirection: 'info',
    weight: 0,
  },
  {
    id: 11,
    name: 'Cost of Funds',
    nameEs: 'Costo de Fondos',
    category: 'earnings',
    threshold: 'Benchmark',
    thresholdDirection: 'info',
    weight: 0,
  },
  {
    id: 12,
    name: 'Net Interest Margin',
    nameEs: 'Margen de Interés Neto',
    category: 'earnings',
    threshold: 'Benchmark (>= 2.5%)',
    thresholdDirection: 'gte',
    weight: 10,
  },
];

export const COSSEC_PR_FRAMEWORK: IRegulatoryFramework = {
  id: 'cossec-pr',
  name: 'COSSEC Regulatory Framework',
  nameEs: 'Marco Regulatorio COSSEC',
  regulator: 'COSSEC',
  country: 'PR',
  currency: 'USD',
  ratios: COSSEC_RATIOS,
  examFrequency: 'Annual',
};
