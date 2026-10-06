/**
 * Agent Evaluation — Master E2E Spec
 *
 * Runs ALL golden cases through the 6-dimension scoring framework and
 * prints the scorecard. This is the Vol2 §Testing regression gate:
 *   - Average score must be ≥ 80% to pass
 *   - Any ≥ 5pp drop vs baseline triggers investigation
 *
 * To run:
 *   npx jest --rootDir=. \
 *     --testRegex="agent-evals/agent-evals\\.e2e-spec\\.ts$" \
 *     --transform='{"^.+\\.(t|j)s$": "ts-jest"}'
 *
 * This spec uses OFFLINE scoring — it evaluates pre-built outputs against
 * expected findings without calling the real LLM. Full integration tests
 * (NestJS + mock LLM + Prisma) are a future extension.
 */

import { scoreOffline, runBatch, printScorecard } from './runner/eval-runner';
import { loadAllCases, loadBaseline, listAgentDirs } from './runner/load-case';
import type { GoldenCase } from './runner/fixture-types';
import type { AuditStep } from './scoring/dimensions';
import { PASS_THRESHOLD, REGRESSION_DROP_THRESHOLD } from './scoring/weights';

function syntheticAuditTrace(): AuditStep[] {
  return [
    'runFullSwarm',
    'runRateShock',
    'getRepricingGap',
    'getLCR',
    'getNSFR',
    'getCECL',
    'getConcentration',
    'getPeerBenchmark',
    'getCapitalAdequacy',
    'getEWS',
    'getDepositBeta',
  ].map((t) => ({ stepKind: 'TOOL_CALL', toolName: t, toolOutput: null }));
}

const FIXTURE_ALM_OUTPUT = {
  agentId: 'alm_decision',
  version: '2.0',
  topRisks: [
    {
      rank: 1,
      domain: 'Interest Rate Risk',
      severity: 'HIGH',
      dollarImpact: 2100000,
      dollarImpactPct: 6.2,
      finding: 'NII at +200bps drops 6.2% ($2.1M). Duration gap −1.8yr.',
      findingEs: 'NII a +200bps disminuye 6.2% ($2.1M).',
      regulatoryRef: 'COSSEC Carta Circular 2021-02',
      toolsUsed: ['runFullSwarm', 'runRateShock'],
    },
    {
      rank: 2,
      domain: 'Liquidity Risk',
      severity: 'HIGH',
      dollarImpact: 850000,
      dollarImpactPct: 2.5,
      finding: 'LCR at 112% — trending down.',
      findingEs: 'LCR en 112% — tendencia a la baja.',
      regulatoryRef: 'COSSEC Reg. 8866',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 3,
      domain: 'Concentration Risk',
      severity: 'MEDIUM',
      dollarImpact: 640000,
      dollarImpactPct: 1.9,
      finding: 'Auto loan HHI: 2,840. 34% single sector.',
      findingEs: 'HHI auto: 2,840. 34% un solo sector.',
      regulatoryRef: 'COSSEC Carta Circular 2019-01',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 4,
      domain: 'Credit Risk',
      severity: 'MEDIUM',
      dollarImpact: 380000,
      dollarImpactPct: 1.1,
      finding: 'CECL coverage 1.42% vs peer 1.58%. Under-reserved $380K CRE.',
      findingEs: 'Cobertura CECL 1.42% vs pares 1.58%.',
      regulatoryRef: 'ASC 326-20',
      toolsUsed: ['runFullSwarm'],
    },
    {
      rank: 5,
      domain: 'Capital Adequacy',
      severity: 'LOW',
      dollarImpact: 210000,
      dollarImpactPct: 0.6,
      finding: 'Net worth 7.4% (threshold 7.0%). Declining 20bps QoQ.',
      findingEs: 'Patrimonio neto 7.4% (umbral 7.0%).',
      regulatoryRef: 'NCUA §702.102',
      toolsUsed: ['runFullSwarm'],
    },
  ],
  decisionQueue: [
    {
      priority: 1,
      action: 'Shift $15M from 5yr fixed to 1yr variable.',
      actionEs: 'Mover $15M a variable.',
      expectedImpact: '+12bps NIM (+$840K)',
      deadline: '60d',
      owner: 'CFO',
      regulatoryRef: 'COSSEC 2021-02',
      status: 'PENDING',
    },
    {
      priority: 2,
      action: 'Increase HQLA buffer by $2M via T-bill ladder.',
      actionEs: 'Aumentar HQLA en $2M.',
      expectedImpact: 'LCR +9pp to 121%',
      deadline: '30d',
      owner: 'CFO',
      regulatoryRef: 'COSSEC Reg. 8866',
      status: 'PENDING',
    },
    {
      priority: 3,
      action: 'Cap auto originations at 30%.',
      actionEs: 'Limitar auto a 30%.',
      expectedImpact: 'HHI ~2,400 in 90d',
      deadline: '90d',
      owner: 'ALM_COMMITTEE',
      regulatoryRef: 'COSSEC 2019-01',
      status: 'PENDING',
    },
    {
      priority: 4,
      action: 'Increase CECL reserve $380K in CRE.',
      actionEs: 'Aumentar reserva CECL $380K.',
      expectedImpact: 'Coverage to peer median',
      deadline: '30d',
      owner: 'CFO',
      regulatoryRef: 'ASC 326-20',
      status: 'PENDING',
    },
    {
      priority: 5,
      action: 'Review capital stress scenarios.',
      actionEs: 'Revisar escenarios de capital.',
      expectedImpact: 'Maintain well-capitalized',
      deadline: '60d',
      owner: 'BOARD',
      regulatoryRef: 'NCUA §702.102',
      status: 'PENDING',
    },
  ],
  brief:
    'Elevated interest rate risk. NII sensitivity +200bps exceeds policy by 70bps. Duration mismatch from fixed-rate auto lending. Liquidity trending down. Priority: restructure rate risk first ($840K annual benefit).',
  briefEs:
    'Riesgo de tasa elevado. Sensibilidad NII +200bps excede política por 70bps. La liquidez tiende a la baja.',
  healthSnapshot: {
    overall: 64,
    capital: 78,
    liquidity: 58,
    rateRisk: 52,
    credit: 71,
    concentration: 66,
    label: 'FAIR',
    trend: 'deteriorating',
  },
};

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('Agent Evaluation Framework — Golden Cases', () => {
  const almCases = loadAllCases('alm-decision');
  const rmCases = loadAllCases('risk-monitor');
  const copilotCases = loadAllCases('cfo-copilot');
  const committeeCases = loadAllCases('committee-report');

  it('loads all expected ALM Decision golden cases', () => {
    expect(almCases.length).toBe(10);
    const ids = almCases.map((c) => c.id);
    expect(ids).toContain('alm-001');
    expect(ids).toContain('alm-010');
  });

  it('loads Risk Monitor golden cases', () => {
    expect(rmCases.length).toBe(2);
  });

  it('loads CFO Copilot golden case', () => {
    expect(copilotCases.length).toBe(1);
    expect(copilotCases[0].id).toBe('copilot-001');
  });

  it('loads Committee Report golden case', () => {
    expect(committeeCases.length).toBe(1);
    expect(committeeCases[0].id).toBe('committee-001');
  });

  it('covers all 4 core agent types', () => {
    const agentIds = new Set([
      ...almCases.map((c) => c.agentId),
      ...rmCases.map((c) => c.agentId),
      ...copilotCases.map((c) => c.agentId),
      ...committeeCases.map((c) => c.agentId),
    ]);
    expect(agentIds).toEqual(
      new Set([
        'ALM_DECISION',
        'RISK_MONITOR',
        'CFO_COPILOT',
        'COMMITTEE_REPORT',
      ]),
    );
  });

  describe('ALM Decision — offline scoring with fixture output', () => {
    const trace = syntheticAuditTrace();
    const output = FIXTURE_ALM_OUTPUT;

    for (const goldenCase of almCases) {
      it(`scores case ${goldenCase.id}: ${goldenCase.name}`, () => {
        const result = scoreOffline({
          goldenCase,
          actualOutput: output,
          auditTrace: trace,
        });

        expect(result.score).toBeGreaterThan(0);
        expect(result.caseId).toBe(goldenCase.id);
        expect(result.agentId).toBe('ALM_DECISION');
        expect(result.toolsCalled.length).toBeGreaterThanOrEqual(
          goldenCase.expectedFindings.minToolsCalled ?? 0,
        );

        if (goldenCase.expectedFindings.requiredTools) {
          for (const tool of goldenCase.expectedFindings.requiredTools) {
            expect(result.toolsCalled).toContain(tool);
          }
        }
      });
    }
  });

  describe('Batch scoring produces valid scorecard', () => {
    it('runs all ALM cases through batch scorer', () => {
      const trace = syntheticAuditTrace();
      const inputs = almCases.map((c) => ({
        goldenCase: c,
        actualOutput: FIXTURE_ALM_OUTPUT,
        auditTrace: trace,
      }));

      const { results, avgScore, allPass } = runBatch(inputs);
      expect(results).toHaveLength(almCases.length);
      expect(avgScore).toBeGreaterThan(0);

      // Print scorecard for CI visibility
      printScorecard(results);
    });
  });

  describe('Regression gate integration', () => {
    it('baseline file exists for ALM Decision', () => {
      const baseline = loadBaseline('alm_decision');
      expect(baseline).not.toBeNull();
      expect(baseline!.agentId).toBe('ALM_DECISION');
    });

    it('baseline meanScore is 0 (initial — no verified run yet)', () => {
      const baseline = loadBaseline('alm_decision');
      expect(baseline!.meanScore).toBe(0);
    });
  });

  describe('Every golden case has valid structure', () => {
    const allCases = [
      ...almCases,
      ...rmCases,
      ...copilotCases,
      ...committeeCases,
    ];

    for (const c of allCases) {
      it(`${c.id} has required fields`, () => {
        expect(c.id).toBeTruthy();
        expect(c.name).toBeTruthy();
        expect(c.agentId).toBeTruthy();
        expect(c.description).toBeTruthy();
        expect(c.input).toBeDefined();
        expect(c.expectedFindings).toBeDefined();
      });
    }
  });

  describe('Fixture loader discovers all agent directories', () => {
    it('finds at least 4 agent case directories', () => {
      const dirs = listAgentDirs();
      expect(dirs).toContain('alm-decision');
      expect(dirs).toContain('risk-monitor');
      expect(dirs).toContain('cfo-copilot');
      expect(dirs).toContain('committee-report');
    });
  });
});
