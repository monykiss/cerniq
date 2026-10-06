/**
 * ModelRegistrySeeder — populates the registry on boot.
 *
 * Runs OnModuleInit. Idempotent — upserts by modelKey, so restarting
 * the process never creates duplicates. Each entry maps to a real
 * service file + function in the codebase.
 *
 * The seeder covers 44 production models across 12 categories.
 * Models are seeded as APPROVED (they're already in production).
 * New models added later should start as DRAFT and go through
 * the CANDIDATE → APPROVED workflow.
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ModelRegistryService } from './model-registry.service';
import type { ModelSeedEntry } from './model-registry.types';

/** Namespaced registry identifier, e.g. ns('stress', 'inverted-curve') → 'stress.inverted-curve'. */
const ns = (namespace: string, name: string): string => `${namespace}.${name}`;

const OWNER = 'CerniQ Quant Team';

const PRODUCTION_MODELS: ModelSeedEntry[] = [
  // ───────────────── ALM CORE ─────────────────
  {
    modelKey: ns('alm', 'duration-gap'),
    displayName: 'Duration Gap Analysis',
    description:
      'Modified duration + leverage-adjusted gap analysis with convexity. Primary ALM metric for interest rate risk.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm-enterprise.service.ts',
    entryFunction: 'calculateDurationGap',
    requiredInputs: ['balanceSheetItems'],
    limitations: [
      'Assumes parallel rate shifts',
      'Does not model prepayment optionality',
    ],
  },
  {
    modelKey: ns('alm', 'nii-sensitivity'),
    displayName: 'NII Sensitivity Analysis',
    description:
      'Net Interest Income shock analysis under ±200bps parallel shifts with EVE impact.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm-enterprise.service.ts',
    entryFunction: 'calculateNIISensitivity',
    requiredInputs: ['balanceSheetItems', 'interestRateScenarios'],
    limitations: ['Linear shock only', 'Static balance sheet assumption'],
  },
  {
    modelKey: ns('alm', 'lcr'),
    displayName: 'Liquidity Coverage Ratio',
    description:
      'LCR per BCBS 128: HQLA / Net Cash Outflows over 30-day stress horizon.',
    version: '1.1.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm-enterprise.service.ts',
    entryFunction: 'calculateLCR',
    requiredInputs: ['liquidityPosition'],
    limitations: [
      'Returns data_unavailable when liquidityPosition missing (D1 locked)',
    ],
  },
  {
    modelKey: ns('alm', 'nsfr'),
    displayName: 'Net Stable Funding Ratio',
    description:
      'NSFR per BCBS 295: Available Stable Funding / Required Stable Funding.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/nsfr.service.ts',
    entryFunction: 'calculateNSFR',
    requiredInputs: ['balanceSheetItems', 'liquidityPosition'],
  },
  {
    modelKey: ns('alm', 'eve'),
    displayName: 'Economic Value of Equity',
    description:
      'EVE sensitivity analysis under rate shocks. Measures balance sheet value change.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm.service.ts',
    entryFunction: 'eveAnalysis',
    requiredInputs: ['balanceSheetItems'],
  },
  {
    modelKey: ns('alm', 'bpv'),
    displayName: 'Basis Point Value (DV01)',
    description:
      'Dollar value of a 1bp parallel rate move across the balance sheet.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm.service.ts',
    entryFunction: 'basisPointValue',
    requiredInputs: ['balanceSheetItems'],
  },

  // ───────────────── CREDIT RISK ─────────────────
  {
    modelKey: ns('credit', 'cecl-warm'),
    displayName: 'CECL — WARM Method',
    description:
      'Weighted Average Remaining Maturity CECL allowance computation.',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cecl.service.ts',
    entryFunction: 'calculateWARM',
    requiredInputs: ['loanSegments'],
    limitations: ['Refuses on empty segments (D1)', 'No DEMO segment fallback'],
  },
  {
    modelKey: ns('credit', 'incurred-loss'),
    displayName: 'Incurred-Loss Allowance (Reg 8665 §2.12.2.5)',
    description:
      'Legacy incurred-loss ALLL (COSSEC Reglamento 8665 §2.12.2.5 / ASC 450-20): balance × (historicalLossRate + qualitativeAdj) × loss-emergence period. The incurred-loss leg of the CAEL dual filing (W1.1) — the backward-looking contrast to lifetime CECL.',
    version: '0.1.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/cecl.service.ts',
    entryFunction: 'calculateIncurredLoss',
    requiredInputs: ['loanSegments'],
    limitations: [
      'Refuses on empty segments (D1)',
      'Loss-emergence period default 1yr is DISCLOSED config (WARNING gap) — exact Reg 8665 §2.12.2.5 basis UNVERIFIED (non-OCR scan, CC-2023-01)',
      'Undiscounted; no forward-looking macro overlay (by design — incurred vs CECL)',
    ],
  },
  {
    modelKey: ns('credit', 'cecl-vintage'),
    displayName: 'CECL — Vintage/Cohort Method',
    description: 'Vintage loss emergence with Weibull fit to cohort data.',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cecl.service.ts',
    entryFunction: 'calculateVintage',
    requiredInputs: ['loanCohorts'],
  },
  {
    modelKey: ns('credit', 'cecl-pd-lgd'),
    displayName: 'CECL — PD x LGD Method',
    description:
      'PD × LGD with 3-scenario macro weighting (baseline/adverse/severely adverse).',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cecl.service.ts',
    entryFunction: 'calculatePDxLGD',
    requiredInputs: ['loanSegments', 'macroScenarios'],
  },
  {
    modelKey: ns('credit', 'cecl-cooperativa-pr'),
    displayName: 'CECL — Cooperativa PR Overlay',
    description:
      'PD×LGD CECL with PR product-registry classification (préstamos personales/auto/hipotecas/MBL/garantía de acciones) and the PR macro overlay (hurricane/migration-calibrated multipliers 2.1x/3.6x, weights 45/35/20 vs mainland CCAR).',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cecl.service.ts',
    entryFunction: 'getCooperativaCECLAnalysis',
    requiredInputs: ['loanSegments', 'productRegistry', 'prMacroOverlay'],
    limitations: [
      'Provisional PD/LGD cold-start defaults from the product registry when the institution has no historical loss data — disclosed via WARNING DataGap, never silently substituted (D1). Final calibration needs institution loss history or a COSSEC/NCUA PR pooled-loss dataset.',
      'Returns data_unavailable when there are no CECL-eligible loan segments (D1).',
    ],
  },
  {
    modelKey: ns('credit', 'macro-overlay-pr'),
    displayName: 'PR Macro Overlay (data-derived CECL calibration)',
    description:
      'Derives the PR CECL PD multipliers + scenario weights from macro inputs (unemployment, HPI YoY, net migration) via a macro-stress index, reducing exactly to the provisional constants at a reference state. Slice 2 (v0.2.0): wired into CECLService.getCooperativaCECLAnalysis, fed by the committed pr-macro-snapshot (per-series BLS/FHFA/Census provenance) with optional FRED PRURN live refresh; CECL_MACRO_OVERLAY_MODE=hardcoded is the ops kill switch.',
    version: '0.2.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_2',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/macro-overlay.service.ts',
    entryFunction: 'deriveCurrentOverlay',
    requiredInputs: ['prUnemploymentPct', 'prHpiYoyPct', 'prNetMigrationPct'],
    limitations: [
      'Sensitivity coefficients + reference macro state are DISCLOSED config (WARNING gap), PROVISIONAL pending COSSEC/NCUA validation',
      'Stress-only: a better-than-reference macro state never softens the overlay below the provisional base',
      'Committed snapshot refreshes via operator protocol (quarterly cadence; STALE_SNAPSHOT gap past PR_MACRO_STALENESS_DAYS); only unemployment has a live path (FRED PRURN) — FHFA HPI + Census migration are snapshot-only',
      'Raw BLS LAUS series-ID prefix unresolved (market research notes §10.2) — live refresh deliberately uses FRED PRURN instead',
    ],
  },
  {
    modelKey: ns('credit', 'kmv-merton'),
    displayName: 'KMV-Merton Structural Credit',
    description:
      'Merton structural model — Distance to Default from equity value and volatility.',
    version: '1.1.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/kmv-merton.service.ts',
    entryFunction: 'computeKMV',
    requiredInputs: [
      'equityValue',
      'equityVolatility',
      'debtFaceValue',
      'riskFreeRate',
      'maturity',
    ],
  },
  {
    modelKey: ns('credit', 'portfolio-risk'),
    displayName: 'Credit Risk Portfolio',
    description:
      'Portfolio-level PD, default correlation, and Expected Loss (PD × LGD × EAD).',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/quant/credit/credit-risk-portfolio.ts',
    entryFunction: 'computeExpectedLoss',
    requiredInputs: ['loanSegments'],
  },
  {
    modelKey: ns('credit', 'pd-model'),
    displayName: 'PD Estimation (Logistic)',
    description:
      'Logistic regression PD model: 1/(1+exp(-logit)) by loan type.',
    version: '1.0.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/quant/credit/pd-model.ts',
    entryFunction: 'estimatePD',
    requiredInputs: ['loanType', 'borrowerMetrics'],
  },

  // ───────────────── INTEREST RATE MODELS ─────────────────
  {
    modelKey: ns('rate', 'hjm-2f'),
    displayName: 'HJM Two-Factor Monte Carlo',
    description:
      'Heath-Jarrow-Morton 2-factor forward curve Monte Carlo rate path generation.',
    version: '1.0.0',
    category: 'INTEREST_RATE',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/quant/hjm/hjm.service.ts',
    entryFunction: 'runForInstitution',
    requiredInputs: ['yieldCurve', 'historicalRates'],
    calibrationMetadata: {
      factors: 2,
      paths: 10000,
      method: 'PCA eigendecomposition',
    },
    limitations: [
      'Currently in-process (no worker thread)',
      'Calibration requires >=24 months history',
    ],
  },
  {
    modelKey: ns('rate', 'hull-white-1f'),
    displayName: 'Hull-White One-Factor',
    description:
      'One-factor Hull-White short-rate tree simulation with theta calibration.',
    version: '1.0.0',
    category: 'INTEREST_RATE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/hull-white.service.ts',
    entryFunction: 'simulate',
    requiredInputs: ['yieldCurve', 'meanReversion', 'volatility'],
  },
  {
    modelKey: ns('rate', 'vasicek-mc'),
    displayName: 'Vasicek Monte Carlo',
    description:
      'Vasicek short-rate Monte Carlo simulation with convergence testing.',
    version: '1.0.0',
    category: 'INTEREST_RATE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/monte-carlo.service.ts',
    entryFunction: 'runSimulation',
    requiredInputs: [
      'currentRate',
      'longTermMean',
      'meanReversion',
      'volatility',
    ],
    calibrationMetadata: { convergenceThreshold: '1% standard error of mean' },
  },
  {
    modelKey: ns('rate', 'cir'),
    displayName: 'Cox-Ingersoll-Ross Model',
    description:
      'CIR short-rate simulation with square-root volatility (non-negative rates).',
    version: '1.0.0',
    category: 'INTEREST_RATE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cir-model.service.ts',
    entryFunction: 'simulate',
    requiredInputs: [
      'currentRate',
      'longTermMean',
      'meanReversion',
      'volatility',
    ],
  },
  {
    modelKey: ns('rate', 'garch'),
    displayName: 'GARCH(1,1) Volatility',
    description:
      'GARCH(1,1) parameter estimation, conditional variance filtering, and multi-step forecast.',
    version: '1.0.0',
    category: 'INTEREST_RATE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/garch-volatility.service.ts',
    entryFunction: 'estimateParams',
    requiredInputs: ['returnSeries'],
    calibrationMetadata: { diagnostics: 'Ljung-Box Q-test on residuals' },
  },
  {
    modelKey: ns('rate', 'black-litterman'),
    displayName: 'Black-Litterman Portfolio',
    description:
      'Black-Litterman portfolio optimization combining market equilibrium with investor views.',
    version: '1.0.0',
    category: 'PORTFOLIO',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/black-litterman.service.ts',
    entryFunction: 'computeBLPortfolio',
    requiredInputs: ['marketWeights', 'covarianceMatrix', 'views'],
  },

  // ───────────────── STRESS TESTING ─────────────────
  {
    modelKey: ns('stress', 'regulatory'),
    displayName: 'Regulatory Stress Test',
    description:
      'FRB CCAR/DFAST regulatory stress scenarios with COSSEC-specific overlays.',
    version: '1.0.0',
    category: 'STRESS_TEST',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/stress-testing/stress-testing.service.ts',
    entryFunction: 'runRegulatoryStress',
    requiredInputs: ['balanceSheetItems', 'liquidityPosition'],
    limitations: ['Returns data_unavailable when baseLCR is null (D1)'],
  },
  {
    modelKey: ns('stress', 'monte-carlo'),
    displayName: 'Monte Carlo Stress Simulation',
    description:
      'Full Monte Carlo stress test execution with fan chart generation.',
    version: '1.0.0',
    category: 'STRESS_TEST',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/stress-testing/stress-testing.service.ts',
    entryFunction: 'runMonteCarloSimulation',
    requiredInputs: ['balanceSheetItems', 'rateScenarios'],
  },
  {
    modelKey: ns('stress', 'nev'),
    displayName: 'NEV Supervisory Test (COSSEC CC-2025-01)',
    description:
      'Net Economic Value supervisory analysis: ±100/200/300bps parallel shocks with duration+convexity revaluation, classified by the COSSEC CC-2025-01 / CAMEL-S two-dimensional bands (NEV ratio + sensitivity, worse of the two) on the +300bps supervisory point.',
    version: '1.0.0',
    category: 'STRESS_TEST',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/stress-testing/stress-testing.service.ts',
    entryFunction: 'getNEVAnalysis',
    requiredInputs: ['balanceSheetItems', 'durationGap'],
    limitations: [
      'Returns data_unavailable when the balance sheet is empty (D1). NCUA-derived methodology presented under COSSEC CC-2025-01; not a separately COSSEC-published numeric test.',
    ],
  },
  {
    modelKey: ns('stress', 'custom-scenario'),
    displayName: 'Custom Scenario Engine',
    description:
      'User-defined rate/credit scenario execution with impact analysis.',
    version: '1.0.0',
    category: 'STRESS_TEST',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/custom-scenario.service.ts',
    entryFunction: 'runCustomScenario',
    requiredInputs: ['balanceSheetItems', 'scenarioParameters'],
    limitations: ['Detects COSSEC data_unavailable before math (D1)'],
  },

  // ───────────────── REGULATORY ─────────────────
  {
    modelKey: ns('reg', 'cossec-compliance'),
    displayName: 'COSSEC 12-Ratio Compliance',
    description:
      'Full COSSEC regulatory compliance engine — 12 ratios with thresholds and trend deltas.',
    version: '1.0.0',
    category: 'REGULATORY',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alm-enterprise.service.ts',
    entryFunction: 'getCOSSECCompliance',
    requiredInputs: ['balanceSheetItems'],
    limitations: [
      'Returns data_unavailable on empty BS (D1)',
      'PR-specific: COSSEC thresholds only',
    ],
  },
  {
    modelKey: ns('reg', 'ncua-5300'),
    displayName: 'NCUA 5300 Report Generator',
    description:
      'NCUA 5300 regulatory report generation with edit-check validation.',
    version: '1.0.0',
    category: 'REGULATORY',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/ncua-5300.service.ts',
    entryFunction: 'generateForm5300',
    requiredInputs: ['balanceSheetItems'],
    limitations: [
      'Allowance/delinquency still sector-default ratios (WARNING gap)',
      'Do not file when data_unavailable',
    ],
  },
  {
    modelKey: ns('reg', 'ncua-rbc2'),
    displayName: 'NCUA Risk-Based Capital (RBC2)',
    description:
      'Risk-Based Capital per 12 CFR 702.204 with asset classification.',
    version: '1.0.0',
    category: 'REGULATORY',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/ncua-rbc2.service.ts',
    entryFunction: 'computeRBC2',
    requiredInputs: ['balanceSheetItems'],
    limitations: [
      'Hardcoded durationGap=2.1 (WARNING gap until DurationService wired)',
    ],
  },
  {
    modelKey: ns('reg', 'camel-certification'),
    displayName: 'CAMEL Certification Engine',
    description:
      'CAMEL rating computation (Capital, Assets, Management, Earnings, Liquidity) with HTML certification.',
    version: '1.0.0',
    category: 'REGULATORY',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/exam-prep/camel-certification.service.ts',
    entryFunction: 'generateCertification',
    requiredInputs: ['balanceSheetItems'],
  },
  {
    modelKey: ns('reg', 'cael-pr'),
    displayName: 'CAEL-PR Filing Framework (Reg 7790 / CECL / Piloto)',
    description:
      'COSSEC CAEL filing framework — Capital/Asset-quality/Earnings/Liquidity ratio dictionary for the three quarterly AITSA report variants (Reglamento 7790 incurred-loss, CAEL-with-CECL, and the Net Equity Ratio "Piloto"). Declarative half of W1.1; the compute + dual-output renderer land in Slice 2.',
    version: '0.1.0',
    category: 'REGULATORY',
    riskTier: 'TIER_1',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/frameworks/cael-pr.framework.ts',
    entryFunction: 'getCaelFramework',
    requiredInputs: ['balanceSheetItems', 'loanSegments'],
    limitations: [
      'CAEL composite weighting + rating bands UNVERIFIED (Reg 7790 / CC-2023-01 non-OCR scans) — provisional ratios flagged per-ratio, disclosed via WARNING gap at compute time',
      'Statutory thresholds (Ley 255 capital 8%, CC-2021-02 liquidity 5%) are NOT provisional',
      'Compute layer (calculateCAELCompliance) + dual-output renderer deferred to Slice 2',
    ],
  },

  // ───────────────── CAPITAL ─────────────────
  {
    modelKey: ns('capital', 'adequacy-ratio'),
    displayName: 'Capital Adequacy Ratio',
    description: 'CAR = Tier 1 Capital / Risk-Weighted Assets.',
    version: '1.0.0',
    category: 'CAPITAL',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/capital-adequacy-ratio.service.ts',
    entryFunction: 'calculate',
    requiredInputs: ['balanceSheetItems'],
  },
  {
    modelKey: ns('capital', 'optimizer'),
    displayName: 'Capital Allocation Optimizer',
    description:
      'Capital allocation across aggressive/moderate/conservative modes.',
    version: '1.0.0',
    category: 'CAPITAL',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/capital-optimizer.service.ts',
    entryFunction: 'optimize',
    requiredInputs: ['balanceSheetItems', 'riskAppetite'],
  },
  {
    modelKey: ns('capital', 'glide-path-planner'),
    displayName: 'Capital Indivisible Glide-Path Planner',
    description:
      'Forward-looking COSSEC capital projection (Wave 1, W1.4): projects the Net-Equity ratio (CAEL Piloto 4% floor) and the statutory indivisible-capital-over-RWA ratio (Ley 255 §6.02, 8%) period-by-period from retained net surplus + asset growth, with a stressed-recovery variant.',
    version: '0.1.0',
    category: 'CAPITAL',
    riskTier: 'TIER_2',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/cooperativa/capital-planning.service.ts',
    entryFunction: 'projectGlidePath',
    requiredInputs: ['equity', 'totalAssets', 'riskWeightedAssets'],
    limitations: [
      'Deterministic projection; growth/ROA/surplus-retention are DISCLOSED planning assumptions (WARNING gap), not measured data',
      'RWA grows proportionally with assets (disclosed simplification)',
      'Refuses on missing balance sheet (D1); statutory leg skipped + gap when RWA absent',
    ],
  },

  // ───────────────── RISK METRICS ─────────────────
  {
    modelKey: ns('risk', 'cash-flow-at-risk'),
    displayName: 'Cash-Flow-at-Risk (CFaR)',
    description: 'Earnings volatility with multi-factor correlated CFaR.',
    version: '1.0.0',
    category: 'RISK_METRICS',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/cash-flow-at-risk.service.ts',
    entryFunction: 'calculateCFaR',
    requiredInputs: ['balanceSheetItems', 'rateScenarios'],
  },
  {
    modelKey: ns('report', 'loan-tape-rollup'),
    displayName: 'Loan-Tape Segment Rollup',
    description:
      'Rolls the instrument-level loan tape (LoanRecord) up into LoanSegment-shaped aggregates: balance-weighted rate/maturity computed over COVERED records only (a null field never contributes a phantom 0), delinquency banding, per-dimension coverage disclosure, and tape↔segment-book reconciliation with a disclosed 1% tolerance (Wave 2, W2.0).',
    version: '0.1.0',
    category: 'REPORTING',
    riskTier: 'TIER_2',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/loan-tape/loan-tape-aggregation.service.ts',
    entryFunction: 'rollUpToSegments',
    requiredInputs: ['loanRecords'],
    limitations: [
      'READ-ONLY view: never materialized into LoanSegment (that table requires historicalLossRate, which a tape does not carry — writing 0 would be a phantom CECL input)',
      'Weighted averages cover only records carrying the field; coverage is gap-disclosed, never imputed',
      'Reconciliation tolerance (1%) is DISCLOSED config pending policy calibration',
    ],
  },
  {
    modelKey: ns('credit', 'geographic-concentration'),
    displayName: 'Geographic + Single-Borrower Concentration',
    description:
      'Municipio HHI (DOJ/FFIEC bands) and single-borrower exposure computed from the loan-level tape — the geography branch the aggregate concentration engine could never measure (Wave 2, W2.2). Shares are computed over the COVERED balance only; a null municipio/borrower is excluded, never bucketed.',
    version: '0.1.0',
    category: 'CREDIT_RISK',
    riskTier: 'TIER_2',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/loan-tape/geographic-concentration.service.ts',
    entryFunction: 'analyze',
    requiredInputs: ['loanRecords.municipio', 'loanRecords.borrowerId'],
    limitations: [
      'Zero municipio coverage → HHI null + WARNING gap — diversification is NEVER assumed from missing geography (D1: the silent-pass hazard the roadmap flagged)',
      'A null borrower key is EXCLUDED from single-borrower aggregation, not treated as its own obligor (would understate concentration)',
      'HHI bands (1500/2500) are the DOJ/FFIEC convention, DISCLOSED config pending COSSEC guidance',
      'Exposure lists cap at top 15 with a truncation flag — "top N" is never presented as "all"',
    ],
  },
  {
    modelKey: ns('liquidity', 'fhlbny-collateral'),
    displayName: 'FHLBNY Collateral + Borrowing Capacity (MODELED)',
    description:
      'MODELED FHLBNY collateral eligibility (1-4 family / HELOC / multifamily / CRE keyword classification from the loan tape), haircut-based lending value, borrowing-capacity what-ifs, and a clearly-labeled MODELED collateral file (COL-121 stand-in). The wedge for the FHLBNY membership wave (Wave 2, W2.1).',
    version: '0.1.0',
    category: 'LIQUIDITY',
    riskTier: 'TIER_2',
    status: 'DRAFT',
    ownerName: OWNER,
    serviceFile: 'alm/loan-tape/fhlbny-collateral.service.ts',
    entryFunction: 'analyze',
    requiredInputs: [
      'loanRecords.collateralType',
      'loanRecords.delinquencyDays',
    ],
    limitations: [
      'MODELED throughout: the exact COL-121 layout and official FHLBNY haircut schedule are UNVERIFIED (Bible §9.13) — haircuts (25/40/35/45%) and the 60-DPD ceiling are DISCLOSED PROVISIONAL config; a WARNING gap rides on every result',
      'UNKNOWN delinquency is INELIGIBLE — assuming current would overstate borrowing capacity (D1: errors reduce capacity, never inflate it)',
      'Unclassifiable collateral is excluded with its own disclosed reason, never guessed into a class',
      'Capacity what-ifs are relative ladders over the modeled lending value, not FHLBNY commitments',
    ],
  },
  {
    modelKey: ns('risk', 'early-warning'),
    displayName: 'Early Warning System',
    description:
      '12-indicator asset-quality composite with GREEN/YELLOW/RED bands and anomaly heuristic. W1.3 (v1.1.0): persisted as daily EwsSnapshot rows (idempotent per institution per day) with trend delta vs prior, band-transition / indicator-escalation / composite-drop alerts, and a 06:30 AST scheduled capture (EWS_SCHEDULER_DISABLED kill switch).',
    version: '1.1.0',
    category: 'RISK_METRICS',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/asset-ews.service.ts',
    entryFunction: 'computeEWS',
    requiredInputs: ['financialIndicators'],
    limitations: [
      'Returns DATA_UNAVAILABLE on empty portfolio; no fabricated score (D1)',
      '7 of 12 indicators (delinquency trend, LTV, DSCR, OREO growth, consumer 60d, allowance coverage, peer gap) are not yet wired — return null + WARNING gap, never a constant',
      'Refuses to grade below 50% measured indicator weight; composite scores only over measured indicators (57/100)',
      'Derived indicators are loss-rate proxies, not direct delinquency measurements',
      'Alert thresholds (composite drop 10 pts, band/indicator transitions) are DISCLOSED config pending board calibration; DATA_UNAVAILABLE is never compared numerically — grading loss/restoration are their own alert types',
    ],
  },

  // ───────────────── PRICING / FTP ─────────────────
  {
    modelKey: ns('pricing', 'deposit-beta'),
    displayName: 'Deposit Beta',
    description:
      'Beta coefficient for deposit rate elasticity — measures pass-through of rate changes.',
    version: '1.0.0',
    category: 'PRICING',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/deposit-beta.service.ts',
    entryFunction: 'computeDepositBeta',
    requiredInputs: ['depositTiers', 'rateHistory'],
  },
  {
    modelKey: ns('pricing', 'ftp'),
    displayName: 'Funds Transfer Pricing',
    description:
      'FTP framework for internal pricing of assets and liabilities.',
    version: '1.0.0',
    category: 'PRICING',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/ftp.service.ts',
    entryFunction: 'compute',
    requiredInputs: ['balanceSheetItems', 'yieldCurve'],
  },
  {
    modelKey: ns('pricing', 'nim-attribution'),
    displayName: 'NIM Attribution',
    description:
      'Net Interest Margin attribution decomposed into rate, volume, and mix effects.',
    version: '1.0.0',
    category: 'PRICING',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/nim-attribution.service.ts',
    entryFunction: 'decompose',
    requiredInputs: ['balanceSheetItems', 'priorPeriodBalanceSheet'],
  },

  // ───────────────── REPORTING ─────────────────
  {
    modelKey: ns('report', 'board'),
    displayName: 'Board Report Generator',
    description:
      'Executive board report with KPIs (NIM, LCR, NSFR, CECL, etc.). All data-gap-aware.',
    version: '1.1.0',
    category: 'REPORTING',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/board-report.service.ts',
    entryFunction: 'generateBoardReportData',
    requiredInputs: ['institutionId'],
    limitations: ['5 KPIs explicitly null + WARNING gap until services wired'],
  },
  {
    modelKey: ns('report', 'alco-dashboard'),
    displayName: 'ALCO Dashboard Aggregator',
    description:
      'ALCO committee dashboard KPI aggregation. All inputs nullable, data-gap-aware.',
    version: '1.1.0',
    category: 'REPORTING',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/alco-dashboard.service.ts',
    entryFunction: 'aggregate',
    requiredInputs: ['institutionId'],
  },
  {
    modelKey: ns('report', 'excel-export'),
    displayName: 'Excel Workbook Export',
    description:
      'Multi-sheet Excel workbook with Data Gaps sheet at index 0. All cells data-gap-aware.',
    version: '1.1.0',
    category: 'REPORTING',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/excel-export.service.ts',
    entryFunction: 'exportToExcel',
    requiredInputs: ['institutionId'],
  },
  {
    modelKey: ns('report', 'preflight'),
    displayName: 'Report Preflight Check',
    description:
      'Central "is the report safe to ship?" API. Aggregates gaps from ALM, COSSEC, and stress.',
    version: '1.0.0',
    category: 'REPORTING',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/reports/report-preflight.service.ts',
    entryFunction: 'check',
    requiredInputs: ['institutionId'],
  },

  // ───────────────── PEER ANALYTICS ─────────────────
  {
    modelKey: ns('peer', 'benchmarking'),
    displayName: 'Peer Group Benchmarking',
    description:
      'Asset-tier-specific peer group comparison with percentile ranking.',
    version: '1.0.0',
    category: 'PEER_ANALYTICS',
    riskTier: 'TIER_3',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/peer-analytics.service.ts',
    entryFunction: 'getPeerAnalytics',
    requiredInputs: ['institutionId'],
    limitations: ['4 metrics explicitly null + WARNING gap (unwired sources)'],
  },

  // ───────────────── PORTFOLIO ─────────────────
  {
    modelKey: ns('portfolio', 'hrp'),
    displayName: 'Hierarchical Risk Parity',
    description:
      'HRP portfolio construction via hierarchical clustering of asset covariance.',
    version: '1.0.0',
    category: 'PORTFOLIO',
    riskTier: 'TIER_3',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/hrp.service.ts',
    entryFunction: 'optimize',
    requiredInputs: ['returnSeries', 'covarianceMatrix'],
  },

  // ───────────────── LIQUIDITY ─────────────────
  {
    modelKey: ns('liquidity', 'survival'),
    displayName: 'Liquidity Survival Analysis',
    description: 'Survival period calculation under stress scenarios.',
    version: '1.0.0',
    category: 'LIQUIDITY',
    riskTier: 'TIER_1',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/liquidity-survival.service.ts',
    entryFunction: 'analyze',
    requiredInputs: ['liquidityPosition', 'stressScenario'],
  },
  {
    modelKey: ns('liquidity', 'buffer-sizing'),
    displayName: 'Liquidity Buffer Sizing',
    description:
      'Optimal liquidity buffer size given stress scenarios and risk appetite.',
    version: '1.0.0',
    category: 'LIQUIDITY',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/liquidity-buffer-sizing.service.ts',
    entryFunction: 'compute',
    requiredInputs: ['liquidityPosition', 'riskAppetite'],
  },
  {
    modelKey: ns('liquidity', 'maturity-ladder'),
    displayName: 'Maturity Ladder',
    description:
      'Maturity profile analysis across time buckets for gap identification.',
    version: '1.0.0',
    category: 'LIQUIDITY',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/maturity-ladder.service.ts',
    entryFunction: 'analyze',
    requiredInputs: ['balanceSheetItems'],
  },

  // ───────────────── DURATION & CONVEXITY ─────────────────
  {
    modelKey: ns('alm', 'duration-convexity'),
    displayName: 'Duration & Convexity Analysis',
    description:
      'Portfolio duration, convexity, and scenario analysis with key rate durations.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/duration-convexity.service.ts',
    entryFunction: 'analyze',
    requiredInputs: ['balanceSheetItems'],
  },
  {
    modelKey: ns('alm', 'behavioral-duration'),
    displayName: 'Behavioral Duration Model',
    description:
      'Behavioral model of deposit duration adjusted for withdrawal optionality.',
    version: '1.0.0',
    category: 'ALM_CORE',
    riskTier: 'TIER_2',
    status: 'APPROVED',
    ownerName: OWNER,
    serviceFile: 'alm/behavioral-duration.service.ts',
    entryFunction: 'computeBehavioralDurations',
    requiredInputs: ['depositTiers'],
  },
];

@Injectable()
export class ModelRegistrySeeder implements OnModuleInit {
  private readonly logger = new Logger(ModelRegistrySeeder.name);

  constructor(private readonly registry: ModelRegistryService) {}

  async onModuleInit() {
    this.logger.log(
      `Seeding ${PRODUCTION_MODELS.length} production models into registry...`,
    );
    let created = 0;
    let updated = 0;

    for (const model of PRODUCTION_MODELS) {
      try {
        const existing = await this.registry
          .getByKey(model.modelKey)
          .catch(() => null);
        await this.registry.upsert(model);
        if (existing) {
          updated++;
        } else {
          created++;
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to seed model ${model.modelKey}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Model registry seeded: ${created} created, ${updated} updated, ${PRODUCTION_MODELS.length} total`,
    );

    // Phase 2: Link golden test files as validation artifacts
    await this.linkGoldenTestArtifacts();
  }

  /**
   * Link existing golden test files (test/golden/pr-cooperativa-demo.*.json)
   * to their respective models as validation artifacts. Computes SHA-256
   * checksums for immutability verification.
   */
  private async linkGoldenTestArtifacts() {
    const GOLDEN_MAP: Array<{
      modelKey: string;
      goldenFile: string;
      label: string;
      /** Source fixture for validationMetadata (default: pr-cooperativa-demo). */
      fixture?: string;
    }> = [
      {
        modelKey: ns('reg', 'cossec-compliance'),
        goldenFile: 'pr-cooperativa-demo.cossec.json',
        label: 'COSSEC compliance golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('alm', 'duration-gap'),
        goldenFile: 'pr-cooperativa-demo.duration-gap.json',
        label: 'Duration gap golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('alm', 'lcr'),
        goldenFile: 'pr-cooperativa-demo.lcr.json',
        label: 'LCR golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('alm', 'nii-sensitivity'),
        goldenFile: 'pr-cooperativa-demo.nii-sensitivity.json',
        label: 'NII sensitivity golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('credit', 'incurred-loss'),
        goldenFile: 'pr-cooperativa-demo.incurred-loss.json',
        label: 'Incurred-loss (Reg 8665) golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('capital', 'glide-path-planner'),
        goldenFile: 'pr-cooperativa-demo.capital-glide-path.json',
        label: 'Capital glide-path golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('credit', 'macro-overlay-pr'),
        goldenFile: 'pr-macro-overlay.json',
        label: 'PR macro overlay derivation golden test (pr-macro-snapshot)',
        fixture: 'pr-macro-snapshot',
      },
      {
        modelKey: ns('risk', 'early-warning'),
        goldenFile: 'pr-cooperativa-demo.ews.json',
        label: 'EWS 12-indicator composite golden test (pr-cooperativa-demo)',
      },
      {
        modelKey: ns('report', 'loan-tape-rollup'),
        goldenFile: 'sample-loan-tape.rollup.json',
        label: 'Loan-tape segment rollup golden test (sample-loan-tape)',
        fixture: 'sample-loan-tape',
      },
      {
        modelKey: ns('credit', 'geographic-concentration'),
        goldenFile: 'sample-loan-tape.geographic-concentration.json',
        label:
          'Geographic + single-borrower concentration golden test (sample-loan-tape)',
        fixture: 'sample-loan-tape',
      },
      {
        modelKey: ns('liquidity', 'fhlbny-collateral'),
        goldenFile: 'sample-loan-tape.fhlbny-collateral.json',
        label:
          'MODELED FHLBNY collateral + capacity golden test (sample-loan-tape)',
        fixture: 'sample-loan-tape',
      },
    ];

    const goldenDir = path.resolve(__dirname, '../../test/golden');
    if (!fs.existsSync(goldenDir)) {
      this.logger.debug(
        'Golden test directory not found — skipping artifact linkage',
      );
      return;
    }

    let linked = 0;
    for (const { modelKey, goldenFile, label, fixture } of GOLDEN_MAP) {
      try {
        const filePath = path.join(goldenDir, goldenFile);
        if (!fs.existsSync(filePath)) continue;

        const model = await this.registry.getByKey(modelKey).catch(() => null);
        if (!model) continue;

        // Compute SHA-256 checksum
        const content = fs.readFileSync(filePath);
        const checksum = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;

        // Check if this exact artifact already exists (idempotent)
        const existing = model.validationArtifacts?.find(
          (a: any) =>
            a.artifactType === 'golden_test' &&
            a.storageLocator === `test/golden/${goldenFile}`,
        );
        if (existing) {
          // Update checksum if file changed
          if (existing.checksum !== checksum) {
            this.logger.log(
              `Golden test checksum changed for ${modelKey}: ${goldenFile}`,
            );
          }
          continue;
        }

        await this.registry.addValidationArtifact(model.id, {
          artifactType: 'golden_test',
          label,
          storageLocator: `test/golden/${goldenFile}`,
          checksum,
          producedBy: 'golden-reconciliation-spec',
          producedAt: new Date(),
          validationMetadata: {
            fixture: fixture ?? 'pr-cooperativa-demo',
            driftDetection: 'UPDATE_GOLDEN=1 to regenerate',
          },
        });
        linked++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to link golden artifact for ${modelKey}: ${err.message}`,
        );
      }
    }

    if (linked > 0) {
      this.logger.log(
        `Linked ${linked} golden test artifacts to registry models`,
      );
    }
  }
}
