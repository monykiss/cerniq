import { script } from '../../runner/mock-llm-bridge';

/**
 * Scripted LLM replay for case 001: High rate risk, adequate liquidity.
 *
 * Turn sequence:
 *   1. Agent calls runFullSwarm (tool_use)
 *   2. Agent calls runRateShock with ±100/200/300bps (tool_use)
 *   3. Agent calls getRepricingGap (tool_use)
 *   4. Agent produces final output JSON (end_turn)
 */
export default script()
  .forCase('alm-001', 'High rate risk, adequate liquidity — 4-turn sequence')

  // Turn 1: Agent requests runFullSwarm
  .addToolUseTurn(
    [
      {
        id: 'tc_001',
        name: 'runFullSwarm',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 3200, outputTokens: 150 },
  )

  // Turn 2: Agent calls runRateShock with 5 shocks
  .addToolUseTurn(
    [
      {
        id: 'tc_002',
        name: 'runRateShock',
        input: {
          institutionId: 'golden-inst-001',
          shockBps: [100, 200, 300, -100, -200],
        },
      },
    ],
    { inputTokens: 4800, outputTokens: 120 },
  )

  // Turn 3: Agent calls getRepricingGap
  .addToolUseTurn(
    [
      {
        id: 'tc_003',
        name: 'getRepricingGap',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 5200, outputTokens: 80 },
  )

  // Turn 4: Final output — structured JSON matching ALMDecisionOutputSchema
  .addEndTurn(
    JSON.stringify({
      agentId: 'alm_decision',
      version: '2.0',
      runId: 'eval-001',
      institutionId: 'golden-inst-001',
      timestamp: '2026-04-15T10:00:00.000Z',
      language: 'bilingual',
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
      topRisks: [
        {
          rank: 1,
          domain: 'Interest Rate Risk',
          priorityScore: 24,
          severity: 'HIGH',
          finding:
            'NII at +200bps declines 6.2% ($2.1M). Duration gap of −1.8yr driven by 3yr fixed-rate auto loan concentration. Exceeds IRR policy limit of 5.5%.',
          findingEs:
            'NII a +200bps disminuye 6.2% ($2.1M). Brecha de duración de −1.8yr impulsada por concentración de préstamos de auto a tasa fija a 3 años. Excede el límite de política IRR de 5.5%.',
          dollarImpact: 2100000,
          dollarImpactPct: 6.2,
          regulatoryRef: 'COSSEC Carta Circular 2021-02 §III.B',
          toolsUsed: ['runFullSwarm', 'runRateShock', 'getRepricingGap'],
        },
        {
          rank: 2,
          domain: 'Liquidity Risk',
          priorityScore: 20,
          severity: 'HIGH',
          finding:
            'LCR at 112% — 3pp above minimum but trending down (was 119% prior quarter).',
          findingEs:
            'LCR en 112% — 3pp sobre el mínimo pero con tendencia a la baja.',
          dollarImpact: 850000,
          dollarImpactPct: 2.5,
          regulatoryRef: 'COSSEC Reg. 8866 §7.2',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 3,
          domain: 'Concentration Risk',
          priorityScore: 15,
          severity: 'MEDIUM',
          finding:
            'Auto loan sector HHI: 2,840 (high). 34% of total portfolio in a single sector.',
          findingEs:
            'HHI del sector de préstamos de auto: 2,840. 34% de cartera total en un solo sector.',
          dollarImpact: 640000,
          dollarImpactPct: 1.9,
          regulatoryRef: 'COSSEC Carta Circular 2019-01 §IV',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 4,
          domain: 'Credit Risk',
          priorityScore: 12,
          severity: 'MEDIUM',
          finding:
            'CECL allowance coverage ratio: 1.42% vs peer median 1.58%. Under-reserved by $380K in CRE segment.',
          findingEs:
            'Ratio de cobertura CECL: 1.42% vs mediana de pares 1.58%. Sub-reservado por $380K en CRE.',
          dollarImpact: 380000,
          dollarImpactPct: 1.1,
          regulatoryRef: 'ASC 326-20',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 5,
          domain: 'Capital Adequacy',
          priorityScore: 8,
          severity: 'LOW',
          finding:
            'Net worth ratio: 7.4% (well-capitalized threshold: 7.0%). Adequate but declining 20bps QoQ.',
          findingEs:
            'Razón de patrimonio neto: 7.4% (umbral: 7.0%). Adecuado pero en declive 20bps QoQ.',
          dollarImpact: 210000,
          dollarImpactPct: 0.6,
          regulatoryRef: 'NCUA §702.102',
          toolsUsed: ['runFullSwarm'],
        },
      ],
      decisionQueue: [
        {
          priority: 1,
          action:
            'Shift $15M from 5yr fixed auto loans to 1yr variable structures.',
          actionEs:
            'Mover $15M de préstamos de auto fijos a 5 años a estructuras variables a 1 año.',
          expectedImpact: '+12bps NIM improvement (+$840K annualized)',
          deadline: '60d',
          owner: 'CFO',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          status: 'PENDING',
        },
        {
          priority: 2,
          action: 'Increase HQLA buffer by $2M through Treasury bill ladder.',
          actionEs:
            'Aumentar buffer HQLA en $2M mediante escalera de letras del Tesoro.',
          expectedImpact: 'LCR improvement to 121% (+9pp)',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'COSSEC Reg. 8866',
          status: 'PENDING',
        },
        {
          priority: 3,
          action: 'Cap auto loan originations at 30% of total portfolio.',
          actionEs:
            'Limitar originaciones de préstamos de auto al 30% de cartera total.',
          expectedImpact: 'HHI reduction to ~2,400 over 90 days',
          deadline: '90d',
          owner: 'ALM_COMMITTEE',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          status: 'PENDING',
        },
        {
          priority: 4,
          action: 'Increase CECL reserve by $380K in CRE segment.',
          actionEs: 'Aumentar reserva CECL en $380K en segmento CRE.',
          expectedImpact: 'Coverage ratio to peer median',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'ASC 326-20',
          status: 'PENDING',
        },
        {
          priority: 5,
          action: 'Review capital plan stress scenarios with 25bps buffer.',
          actionEs:
            'Revisar escenarios de estrés del plan de capital con buffer de 25bps.',
          expectedImpact: 'Maintain well-capitalized status through cycle',
          deadline: '60d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.102',
          status: 'PENDING',
        },
      ],
      brief:
        'This institution faces elevated interest rate risk as the primary concern. NII sensitivity at +200bps exceeds policy limits by 70bps, driven by a duration mismatch from concentrated fixed-rate auto lending. Liquidity is trending down despite adequate LCR. The decision queue prioritizes rate risk restructuring first ($840K annual benefit), followed by HQLA buffer build and concentration caps.',
      briefEs:
        'Esta institución enfrenta un riesgo de tasa de interés elevado como preocupación principal. La sensibilidad de NII a +200bps excede los límites de política por 70bps. La liquidez tiende a la baja a pesar de un LCR adecuado. La cola de decisiones prioriza la reestructuración del riesgo de tasa primero.',
      auditTraceId: 'eval-trace-001',
    }),
    { inputTokens: 6200, outputTokens: 1800 },
  )

  .build();
