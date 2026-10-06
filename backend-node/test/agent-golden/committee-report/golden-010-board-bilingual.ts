import type { GoldenCase } from '../../../src/agent-eval/contracts';

/**
 * Blueprint §2.2 — Committee Report Agent.
 *
 * Board-level bilingual (EN + ES) ALM committee report. Agent consumes the
 * latest ALM Decision Agent run and produces a formatted narrative with
 * executive summary, risk commentary, and regulatory compliance notes. Both
 * languages are mandatory for PR-regulated institutions.
 */
export const golden010BoardBilingual: GoldenCase = {
  id: 'golden-010',
  name: 'Committee Report — board bilingual (EN + ES, PR cooperativa)',
  agentType: 'COMMITTEE_REPORT',
  params: {
    analysisRunId: 'golden-alm-run-for-010',
    committeeType: 'board',
    language: 'bilingual',
  },
  expected: {
    bilingualRequired: true,
    hasRegulatoryReference: true,
    toolsCalledMin: 3,
    maxWords: 1200,
  },
};
