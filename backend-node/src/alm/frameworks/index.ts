/**
 * Regulatory Framework Registry
 *
 * Maps institution.primaryRegulator to the corresponding framework
 * definition. Defaults to COSSEC when no match is found.
 */

export type {
  IRegulatoryFramework,
  RegulatoryRatio,
} from './regulatory-framework.interface';
export { COSSEC_PR_FRAMEWORK } from './cossec-pr.framework';
export { NCUA_US_FRAMEWORK } from './ncua-us.framework';
export type {
  CaelFramework,
  CaelRatio,
  CaelVariant,
  CaelLossBasis,
} from './cael-pr.framework';
export {
  CAEL_PR_7790_FRAMEWORK,
  CAEL_PR_CECL_FRAMEWORK,
  CAEL_PR_PILOTO_FRAMEWORK,
  CAEL_PR_FRAMEWORKS,
  getCaelFramework,
} from './cael-pr.framework';

import { IRegulatoryFramework } from './regulatory-framework.interface';
import { COSSEC_PR_FRAMEWORK } from './cossec-pr.framework';
import { NCUA_US_FRAMEWORK } from './ncua-us.framework';
import { CAEL_PR_7790_FRAMEWORK } from './cael-pr.framework';

/**
 * Resolve the regulatory framework for a given regulator identifier.
 *
 * @param regulatorId  Value from Institution.primaryRegulator, e.g. "NCUA", "COSSEC"
 * @returns The matching IRegulatoryFramework (defaults to COSSEC)
 */
export function getFramework(regulatorId: string): IRegulatoryFramework {
  switch (regulatorId?.toUpperCase()) {
    case 'NCUA':
      return NCUA_US_FRAMEWORK;
    // CAEL is a COSSEC filing variant, not a separate regulator. The base
    // (Reglamento 7790) variant is the sensible default for an institution
    // whose primaryRegulator is recorded as 'CAEL'; the CECL and Piloto
    // variants are accessed explicitly via getCaelFramework(variant).
    case 'CAEL':
      return CAEL_PR_7790_FRAMEWORK;
    case 'COSSEC':
    default:
      return COSSEC_PR_FRAMEWORK;
  }
}
