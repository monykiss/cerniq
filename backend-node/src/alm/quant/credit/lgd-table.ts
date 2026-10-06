// ─── Puerto Rico LGD Table — Proprietary Data Moat ──────────────
//
// LGD (Loss Given Default) for PR cooperativas differs from mainland CUs:
//
// 1. CRIM property registry: Puerto Rico's Centro de Recaudacion de Ingresos
//    Municipales assesses property at 60-80% of market value. This means
//    collateral recovery is systematically lower than NCUA assumptions.
//
// 2. Hurricane Maria (2017): Coastal and flood-zone properties sustained
//    15-30% permanent value reduction. Insurance recovery was partial.
//    This adjustment is unique to PR and is not in Abrigo's model.
//
// 3. Asset correlation: Basel III recommends 0.12-0.24 for retail.
//    PR cooperativas have higher intra-island correlation due to
//    concentrated geographic exposure and single-regulator dependence.
//
// Calibration source: FDIC Loss Share data (2009-2024), CRIM assessments
// (2018-2025), FEMA IA data (2017-2019), COSSEC quarterly reports.

import { LGDConfig, LoanType } from './types';

/**
 * PR-specific LGD table.
 *
 * baseLGD: Expected loss given default WITHOUT adjustments.
 * hurricaneAdjustment: ADDED to baseLGD for properties in hurricane-affected zones.
 *   Negative sign = increases loss (counter-intuitive naming follows industry convention
 *   where "adjustment" means change to recovery, not to loss).
 * crimDiscount: Reduction in collateral recovery due to CRIM assessment gap.
 */
export const PR_LGD_TABLE: Record<LoanType, LGDConfig> = {
  RESIDENTIAL_MORTGAGE: {
    baseLGD: 0.25,
    hurricaneAdjustment: 0.1, // +10% LGD in hurricane zones
    crimDiscount: 0.2, // CRIM assesses at 80% of market → 20% discount on recovery
    description:
      'Residential mortgage — PR CRIM assessment gap + Maria exposure',
    descriptionEs:
      'Hipoteca residencial — brecha de tasacion CRIM + exposicion Maria',
  },
  COMMERCIAL_REAL_ESTATE: {
    baseLGD: 0.35,
    hurricaneAdjustment: 0.15, // commercial RE hit harder by hurricane
    crimDiscount: 0.2,
    description:
      'Commercial real estate — higher hurricane damage, CRIM discount',
    descriptionEs:
      'Bienes raices comerciales — mayor dano por huracan, descuento CRIM',
  },
  CONSUMER_UNSECURED: {
    baseLGD: 0.65,
    hurricaneAdjustment: 0, // no collateral → no hurricane adjustment
    crimDiscount: 0,
    description: 'Consumer unsecured — no collateral, high base LGD',
    descriptionEs: 'Consumo sin garantia — sin colateral, LGD base alta',
  },
  AUTO_LOAN: {
    baseLGD: 0.4,
    hurricaneAdjustment: 0, // vehicles are mobile → minimal hurricane effect
    crimDiscount: 0,
    description: 'Auto loan — standard depreciation-driven LGD',
    descriptionEs: 'Prestamo auto — LGD por depreciacion estandar',
  },
  COMMERCIAL_BUSINESS: {
    baseLGD: 0.45,
    hurricaneAdjustment: 0.05, // partial real estate collateral
    crimDiscount: 0.1, // mixed collateral, partial CRIM exposure
    description:
      'Commercial business — mixed collateral, partial CRIM exposure',
    descriptionEs:
      'Comercial empresarial — colateral mixto, exposicion parcial CRIM',
  },
};

/**
 * PR-specific asset correlation by loan type.
 *
 * Basel III IRB recommends:
 * - Residential: 0.15 (individual mortgages)
 * - Commercial RE: 0.20 (correlated local market)
 * - Consumer: 0.04-0.10 (granular, low correlation)
 * - Auto: 0.08-0.12
 * - Commercial business: 0.12-0.24
 *
 * PR adjustments: slightly HIGHER than Basel due to:
 * - Geographic concentration (single island economy)
 * - Single-regulator dependency (COSSEC)
 * - Common macro exposure (PROMESA, hurricane risk, population decline)
 */
export const PR_ASSET_CORRELATION: Record<LoanType, number> = {
  RESIDENTIAL_MORTGAGE: 0.18, // Basel 0.15 + 0.03 PR concentration
  COMMERCIAL_REAL_ESTATE: 0.22, // Basel 0.20 + 0.02 local market
  CONSUMER_UNSECURED: 0.12, // Basel 0.08 + 0.04 island economy
  AUTO_LOAN: 0.12, // Basel 0.10 + 0.02
  COMMERCIAL_BUSINESS: 0.2, // Basel 0.18 + 0.02
};

/**
 * Compute effective LGD for a loan type, including PR-specific adjustments.
 *
 * @param loanType - Loan category
 * @param hurricaneZone - Whether the collateral is in a hurricane-affected zone
 * @returns Effective LGD (0–1), clamped to [0, 1]
 */
export function computeEffectiveLGD(
  loanType: LoanType,
  hurricaneZone: boolean = false,
): number {
  const config = PR_LGD_TABLE[loanType];
  let lgd = config.baseLGD + config.crimDiscount;
  if (hurricaneZone) {
    lgd += config.hurricaneAdjustment;
  }
  return Math.max(0, Math.min(1, lgd));
}
