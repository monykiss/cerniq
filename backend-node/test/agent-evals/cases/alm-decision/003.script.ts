import { script } from '../../runner/mock-llm-bridge';

export default script()
  .forCase('alm-003', 'Concentration risk — auto loans — 3-turn')
  .addToolUseTurn(
    [
      {
        id: 'tc_001',
        name: 'runFullSwarm',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 3200, outputTokens: 140 },
  )
  .addToolUseTurn(
    [
      {
        id: 'tc_002',
        name: 'getConcentration',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 4800, outputTokens: 90 },
  )
  .addEndTurn(
    JSON.stringify({
      agentId: 'alm_decision',
      version: '2.0',
      topRisks: [
        {
          rank: 1,
          domain: 'Concentration Risk',
          severity: 'HIGH',
          dollarImpact: 1240000,
          dollarImpactPct: 3.6,
          finding:
            'Auto loan sector HHI: 2,840 (internal limit: 2,500). 34% portfolio in one sector. Top-member exposure 8.2% of net worth exceeds 5% internal guideline.',
          findingEs:
            'HHI sector auto: 2,840 (límite: 2,500). 34% de cartera en un sector. Exposición principal 8.2% de patrimonio.',
          regulatoryRef: 'COSSEC Carta Circular 2019-01 §IV',
          toolsUsed: ['runFullSwarm', 'getConcentration'],
        },
        {
          rank: 2,
          domain: 'Interest Rate Risk',
          severity: 'MEDIUM',
          dollarImpact: 980000,
          dollarImpactPct: 2.9,
          finding:
            'NII sensitivity +200bps at 4.8% — within 5.5% policy but concentrated in auto-rate repricing.',
          findingEs:
            'Sensibilidad NII +200bps a 4.8% — dentro de política pero concentrada en repreciación auto.',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 3,
          domain: 'Credit Risk',
          severity: 'MEDIUM',
          dollarImpact: 560000,
          dollarImpactPct: 1.6,
          finding:
            'Auto loan delinquency 2.4% (peer median 1.8%). Early-stage (30-59 day) increasing 15bps QoQ.',
          findingEs:
            'Morosidad auto 2.4% (mediana pares 1.8%). Etapa temprana aumentando 15bps QoQ.',
          regulatoryRef: 'ASC 326-20',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 4,
          domain: 'Liquidity Risk',
          severity: 'LOW',
          dollarImpact: 320000,
          dollarImpactPct: 0.9,
          finding:
            'LCR 128% — well above minimum. NSFR 115%. No liquidity concern.',
          findingEs:
            'LCR 128% — bien sobre mínimo. NSFR 115%. Sin preocupación de liquidez.',
          regulatoryRef: 'COSSEC Reg. 8866',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 5,
          domain: 'Capital Adequacy',
          severity: 'LOW',
          dollarImpact: 110000,
          dollarImpactPct: 0.3,
          finding: 'Net worth 8.1% — well-capitalized. Stable QoQ.',
          findingEs: 'Patrimonio neto 8.1% — bien capitalizado. Estable QoQ.',
          regulatoryRef: 'NCUA §702.102',
          toolsUsed: ['runFullSwarm'],
        },
      ],
      decisionQueue: [
        {
          priority: 1,
          action: 'Cap new auto originations at 30% of total portfolio.',
          actionEs: 'Limitar nuevas originaciones auto a 30% de cartera.',
          expectedImpact: 'HHI to ~2,400 in 90 days',
          deadline: '30d',
          owner: 'ALM_COMMITTEE',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          status: 'PENDING',
        },
        {
          priority: 2,
          action:
            'Reduce top-member auto exposure from 8.2% to 5.0% of net worth via participation.',
          actionEs:
            'Reducir exposición principal auto de 8.2% a 5.0% vía participación.',
          expectedImpact: 'Single-name risk halved',
          deadline: '60d',
          owner: 'CFO',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          status: 'PENDING',
        },
        {
          priority: 3,
          action: 'Tighten underwriting on 30-59 day delinquent auto renewals.',
          actionEs:
            'Endurecer suscripción en renovaciones auto con morosidad 30-59 días.',
          expectedImpact: 'Delinquency -20bps in 90d',
          deadline: '60d',
          owner: 'CFO',
          regulatoryRef: 'ASC 326-20',
          status: 'PENDING',
        },
        {
          priority: 4,
          action: 'Diversify into SBA 7(a) participations ($2M target).',
          actionEs: 'Diversificar a participaciones SBA 7(a) ($2M objetivo).',
          expectedImpact: 'HHI reduction + government guarantee',
          deadline: '90d',
          owner: 'ALM_COMMITTEE',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          status: 'PENDING',
        },
        {
          priority: 5,
          action: 'Board quarterly concentration risk report with HHI trend.',
          actionEs:
            'Informe trimestral de riesgo de concentración con tendencia HHI.',
          expectedImpact: 'Governance compliance',
          deadline: '90d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §741.3',
          status: 'PENDING',
        },
      ],
      brief:
        'Concentration risk is the primary concern. Auto loan HHI at 2,840 exceeds the 2,500 internal limit. Top-member exposure at 8.2% of net worth violates the 5% guideline. Credit quality in the auto portfolio is deteriorating. Cap originations and diversify into government-backed participations.',
      briefEs:
        'Riesgo de concentración es la preocupación principal. HHI auto a 2,840 excede límite interno de 2,500. Exposición principal 8.2% viola guía de 5%. Calidad crediticia deteriorándose.',
      healthSnapshot: {
        overall: 68,
        capital: 82,
        liquidity: 85,
        rateRisk: 66,
        credit: 58,
        concentration: 42,
        label: 'FAIR',
        trend: 'stable',
      },
      auditTraceId: 'eval-trace-003',
    }),
    { inputTokens: 5600, outputTokens: 1600 },
  )
  .build();
