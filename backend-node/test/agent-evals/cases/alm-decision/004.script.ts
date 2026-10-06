import { script } from '../../runner/mock-llm-bridge';

export default script()
  .forCase('alm-004', 'CECL inadequacy — CRE under-reserved — 3-turn')
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
        name: 'getCECL',
        input: { institutionId: 'golden-inst-001' },
      },
      {
        id: 'tc_003',
        name: 'getPeerBenchmark',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 5000, outputTokens: 100 },
  )
  .addEndTurn(
    JSON.stringify({
      agentId: 'alm_decision',
      version: '2.0',
      topRisks: [
        {
          rank: 1,
          domain: 'Credit Risk',
          severity: 'HIGH',
          dollarImpact: 580000,
          dollarImpactPct: 1.7,
          finding:
            'CECL coverage 1.32% vs peer median 1.58%. CRE segment under-reserved by $580K. Qualitative factors (declining collateral, higher vacancy) not reflected in quantitative model.',
          findingEs:
            'Cobertura CECL 1.32% vs mediana pares 1.58%. Segmento CRE sub-reservado por $580K.',
          regulatoryRef: 'ASC 326-20 §326-20-30-9',
          toolsUsed: ['runFullSwarm', 'getCECL', 'getPeerBenchmark'],
        },
        {
          rank: 2,
          domain: 'Concentration Risk',
          severity: 'MEDIUM',
          dollarImpact: 420000,
          dollarImpactPct: 1.2,
          finding:
            'CRE concentration at 28% of total portfolio. Below 300% of capital threshold but trending up.',
          findingEs:
            'Concentración CRE a 28% de cartera total. Debajo del umbral de 300% de capital pero en aumento.',
          regulatoryRef: 'OCC 2006-46 (CRE Guidance)',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 3,
          domain: 'Interest Rate Risk',
          severity: 'MEDIUM',
          dollarImpact: 890000,
          dollarImpactPct: 2.6,
          finding:
            'NII +200bps at 4.2%. CRE fixed-rate book adds duration risk.',
          findingEs:
            'NII +200bps a 4.2%. Libro CRE a tasa fija añade riesgo de duración.',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 4,
          domain: 'Liquidity Risk',
          severity: 'LOW',
          dollarImpact: 240000,
          dollarImpactPct: 0.7,
          finding: 'LCR 132%. Adequate.',
          findingEs: 'LCR 132%. Adecuado.',
          regulatoryRef: 'COSSEC Reg. 8866',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 5,
          domain: 'Capital Adequacy',
          severity: 'LOW',
          dollarImpact: 150000,
          dollarImpactPct: 0.4,
          finding: 'Net worth 7.8%. Stable.',
          findingEs: 'Patrimonio neto 7.8%. Estable.',
          regulatoryRef: 'NCUA §702.102',
          toolsUsed: ['runFullSwarm'],
        },
      ],
      decisionQueue: [
        {
          priority: 1,
          action: 'Increase CECL reserve by $580K in CRE segment this quarter.',
          actionEs:
            'Aumentar reserva CECL en $580K en segmento CRE este trimestre.',
          expectedImpact: 'Coverage to 1.58% peer median',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'ASC 326-20',
          status: 'PENDING',
        },
        {
          priority: 2,
          action:
            'Add qualitative overlay for CRE vacancy rate increase (+200bps from baseline).',
          actionEs:
            'Añadir ajuste cualitativo para aumento de tasa de vacancia CRE.',
          expectedImpact: 'Model accuracy + examiner defensibility',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'ASC 326-20 §326-20-30-9',
          status: 'PENDING',
        },
        {
          priority: 3,
          action: 'Obtain updated appraisals on top 10 CRE exposures.',
          actionEs: 'Obtener avalúos actualizados en top 10 exposiciones CRE.',
          expectedImpact: 'Collateral accuracy within 6 months',
          deadline: '60d',
          owner: 'CFO',
          regulatoryRef: 'OCC 2010-42',
          status: 'PENDING',
        },
        {
          priority: 4,
          action: 'Establish CRE concentration limit at 25% of portfolio.',
          actionEs: 'Establecer límite de concentración CRE a 25% de cartera.',
          expectedImpact: 'Gradual diversification mandate',
          deadline: '90d',
          owner: 'BOARD',
          regulatoryRef: 'OCC 2006-46',
          status: 'PENDING',
        },
        {
          priority: 5,
          action:
            'Schedule quarterly CECL model backtesting with loss-emergence period validation.',
          actionEs: 'Programar backtesting trimestral del modelo CECL.',
          expectedImpact: 'Model governance compliance',
          deadline: '90d',
          owner: 'ALM_COMMITTEE',
          regulatoryRef: 'ASC 326-20',
          status: 'PENDING',
        },
      ],
      brief:
        'Credit risk is the primary concern. CECL coverage is 26bps below peer median, concentrated in the CRE segment. Qualitative factors not captured in the model amplify the gap. Immediate reserve increase of $580K and qualitative overlay required.',
      briefEs:
        'Riesgo de crédito es la preocupación principal. Cobertura CECL 26bps debajo de mediana. Factores cualitativos no capturados amplifican la brecha.',
      healthSnapshot: {
        overall: 62,
        capital: 76,
        liquidity: 84,
        rateRisk: 64,
        credit: 44,
        concentration: 58,
        label: 'FAIR',
        trend: 'deteriorating',
      },
      auditTraceId: 'eval-trace-004',
    }),
    { inputTokens: 5800, outputTokens: 1700 },
  )
  .build();
