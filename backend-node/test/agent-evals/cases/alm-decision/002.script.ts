import { script } from '../../runner/mock-llm-bridge';

export default script()
  .forCase('alm-002', 'Liquidity stress, capital erosion — 4-turn')
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
  .addToolUseTurn(
    [
      {
        id: 'tc_002',
        name: 'getLCR',
        input: { institutionId: 'golden-inst-001' },
      },
      {
        id: 'tc_003',
        name: 'getNSFR',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 4600, outputTokens: 100 },
  )
  .addToolUseTurn(
    [
      {
        id: 'tc_004',
        name: 'getCapitalAdequacy',
        input: { institutionId: 'golden-inst-001' },
      },
    ],
    { inputTokens: 5400, outputTokens: 80 },
  )
  .addEndTurn(
    JSON.stringify({
      agentId: 'alm_decision',
      version: '2.0',
      topRisks: [
        {
          rank: 1,
          domain: 'Liquidity Risk',
          severity: 'HIGH',
          dollarImpact: 3200000,
          dollarImpactPct: 9.4,
          finding:
            'LCR at 94% — below 100% regulatory minimum. HQLA depleted by $3.2M net outflows. Stress survival horizon: 18 days.',
          findingEs:
            'LCR en 94% — debajo del mínimo regulatorio de 100%. HQLA agotado por $3.2M de salidas netas.',
          regulatoryRef: 'COSSEC Reg. 8866 §7.2',
          toolsUsed: ['runFullSwarm', 'getLCR', 'getNSFR'],
        },
        {
          rank: 2,
          domain: 'Capital Adequacy',
          severity: 'HIGH',
          dollarImpact: 1800000,
          dollarImpactPct: 5.3,
          finding:
            'Net worth ratio 6.2% — below 7.0% well-capitalized. Declining 40bps QoQ. PCA action threshold approaching.',
          findingEs:
            'Razón de patrimonio neto 6.2% — debajo de 7.0%. En declive 40bps QoQ.',
          regulatoryRef: 'NCUA §702.102',
          toolsUsed: ['runFullSwarm', 'getCapitalAdequacy'],
        },
        {
          rank: 3,
          domain: 'Interest Rate Risk',
          severity: 'MEDIUM',
          dollarImpact: 1400000,
          dollarImpactPct: 4.1,
          finding:
            'NII sensitivity +200bps at 4.1% — within policy but compounding liquidity stress.',
          findingEs:
            'Sensibilidad NII +200bps a 4.1% — dentro de política pero agravando estrés de liquidez.',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 4,
          domain: 'Credit Risk',
          severity: 'MEDIUM',
          dollarImpact: 420000,
          dollarImpactPct: 1.2,
          finding:
            'CECL coverage adequate but loan delinquency rising 30bps QoQ.',
          findingEs:
            'Cobertura CECL adecuada pero morosidad aumentando 30bps QoQ.',
          regulatoryRef: 'ASC 326-20',
          toolsUsed: ['runFullSwarm'],
        },
        {
          rank: 5,
          domain: 'Concentration Risk',
          severity: 'LOW',
          dollarImpact: 180000,
          dollarImpactPct: 0.5,
          finding: 'Sector diversification adequate. HHI 1,920.',
          findingEs: 'Diversificación sectorial adecuada. HHI 1,920.',
          regulatoryRef: 'COSSEC Carta Circular 2019-01',
          toolsUsed: ['runFullSwarm'],
        },
      ],
      decisionQueue: [
        {
          priority: 1,
          action:
            'Emergency HQLA injection: liquidate $4M in available-for-sale securities.',
          actionEs:
            'Inyección HQLA de emergencia: liquidar $4M en valores disponibles para venta.',
          expectedImpact: 'LCR to 112% (+18pp)',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'COSSEC Reg. 8866',
          status: 'PENDING',
        },
        {
          priority: 2,
          action:
            'Suspend share-secured lending until capital ratio recovers to 7.0%.',
          actionEs: 'Suspender préstamos garantizados hasta capital 7.0%.',
          expectedImpact: 'Capital preservation $1.2M',
          deadline: '30d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.102',
          status: 'PENDING',
        },
        {
          priority: 3,
          action:
            'Activate contingency funding line with FHLB ($5M committed facility).',
          actionEs: 'Activar línea de financiamiento contingente FHLB ($5M).',
          expectedImpact: 'Backup liquidity +30 days',
          deadline: '30d',
          owner: 'CFO',
          regulatoryRef: 'COSSEC Reg. 8866',
          status: 'PENDING',
        },
        {
          priority: 4,
          action:
            'Increase share certificate rates 25bps to stem deposit outflows.',
          actionEs:
            'Aumentar tasas de certificados 25bps para detener salidas.',
          expectedImpact: 'Deposit retention +$1.5M/quarter',
          deadline: '60d',
          owner: 'ALM_COMMITTEE',
          regulatoryRef: 'COSSEC Carta Circular 2021-02',
          status: 'PENDING',
        },
        {
          priority: 5,
          action: 'File NCUA capital restoration plan within 60 days.',
          actionEs:
            'Presentar plan de restauración de capital NCUA en 60 días.',
          expectedImpact: 'Regulatory compliance + path to well-capitalized',
          deadline: '60d',
          owner: 'BOARD',
          regulatoryRef: 'NCUA §702.302',
          status: 'PENDING',
        },
      ],
      brief:
        'Critical liquidity and capital position. LCR at 94% breaches the 100% regulatory floor. Net worth ratio at 6.2% is below well-capitalized and declining. Immediate HQLA injection and lending suspension required. FHLB contingency facility should be activated within 30 days.',
      briefEs:
        'Posición crítica de liquidez y capital. LCR a 94% viola el piso regulatorio de 100%. Patrimonio neto a 6.2% debajo de bien capitalizado. Se requiere inyección HQLA inmediata y suspensión de préstamos.',
      healthSnapshot: {
        overall: 42,
        capital: 35,
        liquidity: 28,
        rateRisk: 62,
        credit: 68,
        concentration: 74,
        label: 'MARGINAL',
        trend: 'deteriorating',
      },
      auditTraceId: 'eval-trace-002',
    }),
    { inputTokens: 6400, outputTokens: 2000 },
  )
  .build();
