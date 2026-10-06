/**
 * B2 — Stress Testing Agent Golden Test Cases
 *
 * 10 deterministic fixtures covering the full STRESS_TESTING scenario space:
 * parallel shocks, curve reshaping, PR-specific catastrophe overlays,
 * boundary/edge cases, and multi-factor combined stresses.
 *
 * Each case carries expected numeric ranges derived from the 34-model quant
 * engine and COSSEC regulatory thresholds (Vol.1 §05). The spec runner
 * validates Zod schema compliance (StressTestOutputSchema) and asserts
 * every numeric output falls within the declared bands.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StressTestGoldenCase {
  name: string;
  description: string;
  input: {
    institutionId: string;
    scenarioType: string;
    rateShockBps: number;
    depositRunoffPct?: number;
    prepaymentMultiplier?: number;
    creditLossOverridePct?: number;
    /** Short-rate delta when different from rateShockBps (curve reshaping). */
    shortRateDeltaBps?: number;
    /** Long-rate delta when different from rateShockBps (curve reshaping). */
    longRateDeltaBps?: number;
  };
  expectedOutput: {
    /** Inclusive [min, max] NII impact in millions (negative = decline). */
    niiImpactRange: [number, number];
    /** Inclusive [min, max] EVE change as percentage. */
    eveChangeRange: [number, number];
    /** Inclusive [min, max] LCR after stress (%). */
    lcrAfterRange?: [number, number];
    /** Inclusive [min, max] duration gap in years. */
    durationGapRange?: [number, number];
    /** Allowed scenario-level verdicts. */
    verdictOneOf: string[];
  };
  tags: string[];
}

// ─── Cases ─────────────────────────────────────────────────────────────────

export const STRESS_TESTING_GOLDEN_CASES: readonly StressTestGoldenCase[] = [
  // ── 1. Parallel +200bps on stable cooperativa ────────────────────────────
  {
    name: 'Parallel +200bps on stable cooperativa',
    description:
      'Moderate upward parallel shock applied to a well-capitalised, ' +
      'liability-sensitive cooperativa. NII should decline as funding costs ' +
      'reprice faster than asset yields. EVE decreases because longer-duration ' +
      'assets lose more present value than shorter liabilities.',
    input: {
      institutionId: 'st-golden-001',
      scenarioType: 'parallel_up_200',
      rateShockBps: 200,
    },
    expectedOutput: {
      niiImpactRange: [-3.5, -0.5],
      eveChangeRange: [-12, -2],
      lcrAfterRange: [105, 160],
      durationGapRange: [1.0, 3.5],
      verdictOneOf: ['PASS', 'WARN'],
    },
    tags: ['parallel', 'rate-up', 'stable', 'cossec'],
  },

  // ── 2. Parallel -100bps on asset-sensitive institution ───────────────────
  {
    name: 'Parallel -100bps on asset-sensitive institution',
    description:
      'Downward shock on an institution whose assets reprice faster than ' +
      'liabilities. NII decreases as floating-rate loan yields compress ' +
      'while CD funding costs remain locked. EVE may increase because the ' +
      'longer-duration liability portfolio gains more PV than assets lose.',
    input: {
      institutionId: 'st-golden-002',
      scenarioType: 'parallel_down_100',
      rateShockBps: -100,
    },
    expectedOutput: {
      niiImpactRange: [-2.0, -0.2],
      eveChangeRange: [-3, 6],
      lcrAfterRange: [110, 170],
      durationGapRange: [0.5, 3.0],
      verdictOneOf: ['PASS', 'WARN'],
    },
    tags: ['parallel', 'rate-down', 'asset-sensitive'],
  },

  // ── 3. Steepening scenario ───────────────────────────────────────────────
  {
    name: 'Steepening scenario — short rates -50bps, long rates +100bps',
    description:
      'Non-parallel steepening twist: short end drops 50bps, long end rises ' +
      '100bps. Institutions with long-dated fixed assets and short-dated ' +
      'funding benefit from wider NIM on new originations but suffer EVE ' +
      'decline on existing long-duration book.',
    input: {
      institutionId: 'st-golden-003',
      scenarioType: 'steepening_200',
      rateShockBps: 0,
      shortRateDeltaBps: -50,
      longRateDeltaBps: 100,
    },
    expectedOutput: {
      niiImpactRange: [-1.5, 1.5],
      eveChangeRange: [-10, -1],
      durationGapRange: [1.5, 4.5],
      verdictOneOf: ['PASS', 'WARN'],
    },
    tags: ['curve', 'steepening', 'twist'],
  },

  // ── 4. Flattening scenario ───────────────────────────────────────────────
  {
    name: 'Flattening scenario — short rates +100bps, long rates unchanged',
    description:
      'Bear flattener: front end rises 100bps while long end holds steady. ' +
      'Short-funded institutions face immediate funding cost spike. NII ' +
      'compresses. Duration gap narrows as short-rate exposure dominates.',
    input: {
      institutionId: 'st-golden-004',
      scenarioType: 'flattening_200',
      rateShockBps: 0,
      shortRateDeltaBps: 100,
      longRateDeltaBps: 0,
    },
    expectedOutput: {
      niiImpactRange: [-2.5, -0.3],
      eveChangeRange: [-5, 2],
      durationGapRange: [0.5, 3.0],
      verdictOneOf: ['PASS', 'WARN'],
    },
    tags: ['curve', 'flattening', 'bear-flat'],
  },

  // ── 5. PR Hurricane stress ───────────────────────────────────────────────
  {
    name: 'PR Hurricane stress — 30% deposit runoff + 200bps spike + 2x credit loss',
    description:
      'PR-specific catastrophe overlay modelling a Category 4 hurricane. ' +
      'Combines 30% non-maturity deposit runoff, 200bps emergency rate ' +
      'hike (FEMA/Treasury response), and a 2x multiplier on baseline ' +
      'credit losses from property damage. This is the most severe ' +
      'single-event scenario in the COSSEC battery.',
    input: {
      institutionId: 'st-golden-005',
      scenarioType: 'pr_hurricane_scenario',
      rateShockBps: 200,
      depositRunoffPct: 30,
      creditLossOverridePct: 4.0,
    },
    expectedOutput: {
      niiImpactRange: [-8.0, -2.0],
      eveChangeRange: [-25, -5],
      lcrAfterRange: [60, 110],
      verdictOneOf: ['WARN', 'FAIL'],
    },
    tags: ['hurricane', 'pr-specific', 'catastrophe', 'cossec', 'combined'],
  },

  // ── 6. Recession scenario ────────────────────────────────────────────────
  {
    name: 'Recession scenario — rates -300bps + 15% deposit runoff + 1.5x prepayments',
    description:
      'Deep recession overlay: rates plunge 300bps (Fed emergency cuts), ' +
      'depositors withdraw 15% seeking safety outside the institution, ' +
      'and prepayment speeds increase 1.5x as borrowers refinance. NII ' +
      'collapses from both rate compression and asset runoff.',
    input: {
      institutionId: 'st-golden-006',
      scenarioType: 'pr_recession_scenario',
      rateShockBps: -300,
      depositRunoffPct: 15,
      prepaymentMultiplier: 1.5,
    },
    expectedOutput: {
      niiImpactRange: [-6.0, -1.5],
      eveChangeRange: [-8, 10],
      lcrAfterRange: [75, 130],
      verdictOneOf: ['WARN', 'FAIL'],
    },
    tags: ['recession', 'rate-down', 'deposit-runoff', 'prepayment'],
  },

  // ── 7. COSSEC adverse scenario ───────────────────────────────────────────
  {
    name: 'COSSEC adverse scenario — regulatory-defined thresholds',
    description:
      'Regulatory baseline adverse scenario as defined by COSSEC Carta ' +
      'Circular 2021-02. Uses the prescribed +300bps parallel shock, ' +
      '10% deposit runoff, and 1.2x credit loss multiplier. Results must ' +
      'fall within COSSEC-published tolerance bands.',
    input: {
      institutionId: 'st-golden-007',
      scenarioType: 'parallel_up_300',
      rateShockBps: 300,
      depositRunoffPct: 10,
      creditLossOverridePct: 2.4,
    },
    expectedOutput: {
      niiImpactRange: [-7.0, -1.0],
      eveChangeRange: [-20, -3],
      lcrAfterRange: [80, 140],
      durationGapRange: [1.0, 5.0],
      verdictOneOf: ['PASS', 'WARN', 'FAIL'],
    },
    tags: ['cossec', 'regulatory', 'adverse', 'parallel'],
  },

  // ── 8. Zero interest rate environment ────────────────────────────────────
  {
    name: 'Zero interest rate environment — all rates at 0, test floor behavior',
    description:
      'Validates floor constraints when the yield curve is flat at zero. ' +
      'No rate can go negative (COSSEC does not model negative rates). ' +
      'NII impact should be near-zero or slightly negative from reduced ' +
      'reinvestment income. EVE change should be minimal. Critical test: ' +
      'no NaN, no Infinity, no division-by-zero in output.',
    input: {
      institutionId: 'st-golden-008',
      scenarioType: 'parallel_down_100',
      rateShockBps: 0,
    },
    expectedOutput: {
      niiImpactRange: [-1.0, 0.5],
      eveChangeRange: [-3, 3],
      lcrAfterRange: [100, 200],
      durationGapRange: [0.0, 6.0],
      verdictOneOf: ['PASS', 'WARN'],
    },
    tags: ['boundary', 'zero-rate', 'floor', 'edge-case'],
  },

  // ── 9. Extreme +400bps shock ─────────────────────────────────────────────
  {
    name: 'Extreme +400bps shock — maximum shock, verify no NaN/Infinity',
    description:
      'Maximum parallel upward shock at 400bps, exceeding standard COSSEC ' +
      'scenarios. Primary validation: all numeric outputs are finite, no ' +
      'NaN, no Infinity, no negative LCR. Secondary: NII and EVE impacts ' +
      'are appropriately severe but within model bounds.',
    input: {
      institutionId: 'st-golden-009',
      scenarioType: 'parallel_up_300',
      rateShockBps: 400,
    },
    expectedOutput: {
      niiImpactRange: [-10.0, -1.0],
      eveChangeRange: [-30, -5],
      lcrAfterRange: [50, 140],
      durationGapRange: [0.5, 6.0],
      verdictOneOf: ['WARN', 'FAIL'],
    },
    tags: ['extreme', 'boundary', 'max-shock', 'numeric-safety'],
  },

  // ── 10. Multi-shock combined ─────────────────────────────────────────────
  {
    name: 'Multi-shock combined — rate + deposit runoff + prepayment + credit loss',
    description:
      'Simultaneous four-factor stress: +200bps rate shock, 20% deposit ' +
      'runoff, 1.8x prepayment speed, and 3.5% credit loss override. ' +
      "Tests the engine's ability to compound multiple shocks correctly " +
      'without double-counting. Expected to produce the most severe ' +
      'outcome in the battery.',
    input: {
      institutionId: 'st-golden-010',
      scenarioType: 'pr_liquidity_crisis',
      rateShockBps: 200,
      depositRunoffPct: 20,
      prepaymentMultiplier: 1.8,
      creditLossOverridePct: 3.5,
    },
    expectedOutput: {
      niiImpactRange: [-9.0, -2.0],
      eveChangeRange: [-28, -4],
      lcrAfterRange: [55, 110],
      verdictOneOf: ['WARN', 'FAIL'],
    },
    tags: ['combined', 'multi-factor', 'severe', 'compound'],
  },
] as const;
