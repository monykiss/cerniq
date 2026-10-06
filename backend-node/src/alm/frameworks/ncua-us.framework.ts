/**
 * NCUA (National Credit Union Administration)
 * US Credit Union CAMEL Framework
 *
 * 7 core ratios derived from NCUA examination guidelines.
 * Maps to the same balance-sheet data model used by COSSEC,
 * enabling a unified ALM engine.
 *
 * CAMEL = Capital adequacy, Asset quality, Management,
 *         Earnings, Liquidity/Asset-Liability management
 *
 * Weights sum to 100.
 */

import {
  IRegulatoryFramework,
  RegulatoryRatio,
} from './regulatory-framework.interface';

const NCUA_RATIOS: RegulatoryRatio[] = [
  {
    id: 1,
    name: 'Net Worth Ratio',
    nameEs: 'Razón de Capital Neto',
    category: 'capital',
    threshold: '>= 7%',
    thresholdDirection: 'gte',
    weight: 25,
  },
  {
    id: 2,
    name: 'Delinquency Ratio',
    nameEs: 'Razón de Morosidad',
    category: 'asset_quality',
    threshold: '<= 1.5%',
    thresholdDirection: 'lte',
    weight: 15,
  },
  {
    id: 3,
    name: 'Return on Assets',
    nameEs: 'Retorno sobre Activos',
    category: 'earnings',
    threshold: '>= 0.5%',
    thresholdDirection: 'gte',
    weight: 15,
  },
  {
    id: 4,
    name: 'Operating Expense Ratio',
    nameEs: 'Razón de Gastos Operativos',
    category: 'earnings',
    threshold: '<= 75%',
    thresholdDirection: 'lte',
    weight: 10,
  },
  {
    id: 5,
    name: 'Liquidity Ratio',
    nameEs: 'Razón de Liquidez',
    category: 'liquidity',
    threshold: '>= 10%',
    thresholdDirection: 'gte',
    weight: 15,
  },
  {
    id: 6,
    name: 'Loan-to-Share Ratio',
    nameEs: 'Razón Préstamos/Depósitos',
    category: 'liquidity',
    threshold: '<= 90%',
    thresholdDirection: 'lte',
    weight: 10,
  },
  {
    id: 7,
    name: 'Net Interest Margin',
    nameEs: 'Margen de Interés Neto',
    category: 'earnings',
    threshold: '>= 2.0%',
    thresholdDirection: 'gte',
    weight: 10,
  },
];

export const NCUA_US_FRAMEWORK: IRegulatoryFramework = {
  id: 'ncua-us',
  name: 'NCUA CAMEL Framework',
  nameEs: 'Marco CAMEL de NCUA',
  regulator: 'NCUA',
  country: 'US',
  currency: 'USD',
  ratios: NCUA_RATIOS,
  examFrequency: '12-18 months',
};
