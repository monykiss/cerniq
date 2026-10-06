/**
 * Regulatory Framework Interface
 *
 * Abstracts the ratio definitions, thresholds, and weights for
 * different credit-union / banking regulators:
 *   - COSSEC (Puerto Rico cooperativas)
 *   - NCUA   (US credit unions — CAMEL framework)
 *   - SIB-DR (future: Dominican Republic)
 *
 * Each framework describes which ratios to evaluate and how
 * they contribute to an overall exam-readiness score.
 */

export interface RegulatoryRatio {
  /** Sequential id within the framework (1-based) */
  id: number;

  /** English display name */
  name: string;

  /** Spanish display name */
  nameEs: string;

  /**
   * CAMEL category:
   *   capital | asset_quality | management | earnings | liquidity | sensitivity
   */
  category: string;

  /** Human-readable threshold string, e.g. ">= 7%" or "<= 1.5%" */
  threshold: string;

  /** How to compare value vs threshold */
  thresholdDirection: 'gte' | 'lte' | 'range' | 'info';

  /** Contribution to exam readiness score (all weights sum to 100) */
  weight: number;
}

export interface IRegulatoryFramework {
  /** Machine identifier: 'cossec-pr' | 'ncua-us' | 'sib-dr' */
  id: string;

  /** Human-readable name */
  name: string;

  /** Spanish name */
  nameEs: string;

  /** Regulator body name */
  regulator: string;

  /** ISO country code */
  country: string;

  /** Default currency */
  currency: string;

  /** Ratio definitions for this framework */
  ratios: RegulatoryRatio[];

  /** Typical exam cadence, e.g. "Annual" or "18 months" */
  examFrequency: string;
}
