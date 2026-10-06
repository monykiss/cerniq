import { script } from '../../runner/mock-llm-bridge';

export default script()
  .forCase(
    'alm-005',
    'Capital adequacy — approaching undercapitalized — 3-turn',
  )
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
        name: 'getCapitalAdequacy',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 4600, outputTokens: 90 },
  )
  .addEndTurn(
    JSON.stringify({
      agentId: 'alm_decision',
      version: '2.0',
      topRisks: [
        {
          rank: 1,
          domain: 'Capital Adequacy',
          severity: 'HIGH',
          dollarImpact: 2400000,
          dollarImpactPct: 7.1,
          finding:
            'Net worth ratio 6.2% — below 7.0% well-capitalized threshold. Declining 40bps QoQ for 3 consecutive quarters. RBC ratio 10.8% (adequate but thin). At current trajectory, will cross 6.0% (adequately capitalized) in Q3 2026, triggering PCA restrictions.',
          findingEs:
            'Razón de patrimonio neto 6.2% — debajo del umbral de 7.0%. En declive 40bps QoQ por 3 trimestres. A trayectoria actual, cruzará 6.0% en Q3 2026.',
          regulatoryRef: 'NCUA §702.102, §702.302 PCA',
          toolsUsed: ['runFullSwarm', 'getCapitalAdequacy'],
        },
        {
          rank: 2,
          domain: 'Interest Rate Risk',
          severity: 'MEDIUM',
          dollarImpact: 1100000,
          dollarImpactPct: 3.2,
          finding:
            'NII +200bps at 5.0%. Rate shock would accelerate capital erosion by $1.1M/year.',
          findingEs:
            'NII +200bps a 5.0%. Choque de tasa aceleraría erosión de capital en $1.1M/año.',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 3,
          domain: 'Credit Risk',
          severity: 'MEDIUM',
          dollarImpact: 680000,
          dollarImpactPct: 2.0,
          finding:
            'Charge-offs trending up. CECL provision expense eating into retained earnings.',
          findingEs:
            'Castigos en aumento. Gasto de provisión CECL afecta ganancias retenidas.',
          regulatoryRef: 'ASC 326-20',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 4,
          domain: 'Liquidity Risk',
          severity: 'LOW',
          dollarImpact: 350000,
          dollarImpactPct: 1.0,
          finding: 'LCR 118%. Adequate but declining.',
          findingEs: 'LCR 118%. Adecuado pero en declive.',
          regulatoryRef: 'COSSEC Reg. 8866',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 5,
          domain: 'Concentration Risk',
          severity: 'LOW',
          dollarImpact: 190000,
          dollarImpactPct: 0.6,
          finding: 'Sector diversification adequate. No single-sector concern.',
          findingEs: 'Diversificación sectorial adecuada.',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          toolsUsed: ['runFullSwarm'],
        },
      ],
      decisionQueue: [
        {
          priority: 1,
          action:
            'File capital restoration plan with NCUA within 45 days per PCA §702.302.',
          actionEs:
            'Presentar plan de restauración de capital NCUA en 45 días.',
          expectedImpact: 'Regulatory compliance + restoration path',
          deadline: '30d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.302',
          status: 'PENDING',
        },
        {
          priority: 2,
          action:
            'Freeze discretionary expenses and reduce operating ratio to 75%.',
          actionEs:
            'Congelar gastos discrecionales y reducir ratio operativo a 75%.',
          expectedImpact: 'Capital preservation $400K/quarter',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'NCUA §702.102',
          status: 'PENDING',
        },
        {
          priority: 3,
          action:
            'Suspend dividend/patronage distributions until net worth exceeds 7.0%.',
          actionEs:
            'Suspender distribuciones de dividendos hasta patrimonio neto >7.0%.',
          expectedImpact: 'Retain $300K/quarter',
          deadline: '30d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.102',
          status: 'PENDING',
        },
        {
          priority: 4,
          action:
            'Evaluate subordinated debt issuance ($2M target) for Tier 2 capital.',
          actionEs:
            'Evaluar emisión de deuda subordinada ($2M) para capital Tier 2.',
          expectedImpact: 'Net worth +60bps',
          deadline: '60d',
          owner: 'CFO',
          regulatoryRef: 'NCUA §702.109',
          status: 'PENDING',
        },
        {
          priority: 5,
          action:
            'Monthly capital adequacy board reporting with trajectory projections.',
          actionEs:
            'Informe mensual de adecuación de capital con proyecciones.',
          expectedImpact: 'Early warning + governance',
          deadline: '30d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.102',
          status: 'PENDING',
        },
      ],
      brief:
        'Capital adequacy is critical. Net worth at 6.2% is below well-capitalized and declining 40bps/quarter. At current trajectory, PCA restrictions trigger in Q3 2026. Immediate capital restoration plan filing, expense freeze, and dividend suspension required. Subordinated debt issuance should be evaluated.',
      briefEs:
        'Adecuación de capital es crítica. Patrimonio neto a 6.2% debajo de bien capitalizado y en declive 40bps/trimestre. Se requiere plan de restauración inmediato.',
      healthSnapshot: {
        overall: 38,
        capital: 28,
        liquidity: 72,
        rateRisk: 58,
        credit: 52,
        concentration: 76,
        label: 'MARGINAL',
        trend: 'deteriorating',
      },
      auditTraceId: 'eval-trace-005',
    }),
    { inputTokens: 5600, outputTokens: 1800 },
  )
  .build();
