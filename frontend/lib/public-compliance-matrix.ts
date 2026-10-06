export type PublicComplianceFramework = 'cossec' | 'ncua' | 'basel' | 'cecl';

export type PublicCoverageStatus = 'supported' | 'partial' | 'not_claimed';

interface LocalizedText {
  en: string;
  es: string;
}

export interface PublicComplianceRow {
  readonly id: string;
  readonly requirement: LocalizedText;
  readonly buyerOutcome: LocalizedText;
  readonly module: {
    readonly label: LocalizedText;
    readonly href: string;
  };
  readonly coverage: Record<PublicComplianceFramework, PublicCoverageStatus>;
  readonly evidence: LocalizedText;
}

export const PUBLIC_COMPLIANCE_FRAMEWORKS = [
  {
    key: 'cossec',
    label: { en: 'COSSEC', es: 'COSSEC' },
    audience: {
      en: 'Puerto Rico cooperativa workflows',
      es: 'Flujos para cooperativas de Puerto Rico',
    },
    summary: {
      en: 'Current public scope for quarterly ALM, liquidity, exam prep, and board reporting.',
      es: 'Scope publico actual para ALM trimestral, liquidez, preparacion de examen e informes de junta.',
    },
  },
  {
    key: 'ncua',
    label: { en: 'NCUA', es: 'NCUA' },
    audience: {
      en: 'US credit union workflows',
      es: 'Flujos para credit unions de EEUU',
    },
    summary: {
      en: 'Current public scope for IRR, liquidity, capital, call report mapping, and examiner prep.',
      es: 'Scope publico actual para IRR, liquidez, capital, mapeo del call report y preparacion para examinadores.',
    },
  },
  {
    key: 'basel',
    label: { en: 'Basel IRRBB', es: 'Basel IRRBB' },
    audience: {
      en: 'Shock, liquidity, and capital analytics',
      es: 'Analitica de shocks, liquidez y capital',
    },
    summary: {
      en: 'Current public scope for IRRBB shocks, liquidity structure, and capital-oriented analytics.',
      es: 'Scope publico actual para shocks IRRBB, estructura de liquidez y analitica orientada a capital.',
    },
  },
  {
    key: 'cecl',
    label: { en: 'CECL', es: 'CECL' },
    audience: {
      en: 'Allowance and credit-loss workflows',
      es: 'Flujos de reserva y perdida crediticia',
    },
    summary: {
      en: 'Current public scope for allowance adequacy, cohort analysis, and quarterly review workflows.',
      es: 'Scope publico actual para adecuacion de reservas, analisis por cohortes y flujos de revision trimestral.',
    },
  },
] as const satisfies ReadonlyArray<{
  key: PublicComplianceFramework;
  label: LocalizedText;
  audience: LocalizedText;
  summary: LocalizedText;
}>;

export const PUBLIC_COMPLIANCE_MATRIX: readonly PublicComplianceRow[] = [
  {
    id: 'R1',
    requirement: {
      en: 'Net worth and capital buffer tracking',
      es: 'Seguimiento de patrimonio neto y margen de capital',
    },
    buyerOutcome: {
      en: 'Monitor supervisory capital buffers before they become a board or examiner issue.',
      es: 'Monitoree los margenes de capital antes de que se conviertan en un tema de junta o de examen.',
    },
    module: {
      label: { en: 'Capital Adequacy', es: 'Adecuacion de Capital' },
      href: '/alm/capital-adequacy',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'partial',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public module copy claims CAR plus tier 1/tier 2 capital adequacy ratios, while site copy also references the COSSEC ratio engine.',
      es: 'La copia publica actual del modulo reclama CAR mas ratios de capital tier 1/tier 2, mientras el sitio tambien referencia el motor de ratios COSSEC.',
    },
  },
  {
    id: 'R2',
    requirement: {
      en: 'Duration gap analysis',
      es: 'Analisis de gap de duracion',
    },
    buyerOutcome: {
      en: 'Quantify structural rate exposure in a form treasury and ALCO teams can review quickly.',
      es: 'Cuantifique la exposicion estructural a tasas en un formato que tesoreria y ALCO puedan revisar rapido.',
    },
    module: {
      label: { en: 'Rate Sensitivity', es: 'Sensibilidad de Tasa' },
      href: '/alm/sensitivity',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public claims include duration gap coverage on the homepage, changelog, and the rate-sensitivity workflow.',
      es: 'Las claims publicas actuales incluyen cobertura de duration gap en la pagina principal, el changelog y el flujo de sensibilidad de tasa.',
    },
  },
  {
    id: 'R3',
    requirement: {
      en: 'NII sensitivity under rate shocks',
      es: 'Sensibilidad NII bajo shocks de tasa',
    },
    buyerOutcome: {
      en: 'Show projected earnings pressure under standardized interest-rate scenarios.',
      es: 'Muestre la presion proyectada sobre utilidades bajo escenarios estandarizados de tasa de interes.',
    },
    module: {
      label: { en: 'Rate Sensitivity', es: 'Sensibilidad de Tasa' },
      href: '/alm/sensitivity',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module index and homepage explicitly claim NII sensitivity as part of the compliance scope.',
      es: 'El indice publico de modulos y la pagina principal reclaman explicitamente sensibilidad NII como parte del scope de cumplimiento.',
    },
  },
  {
    id: 'R4',
    requirement: {
      en: 'EVE sensitivity under rate shocks',
      es: 'Sensibilidad EVE bajo shocks de tasa',
    },
    buyerOutcome: {
      en: 'Surface balance-sheet value exposure alongside earnings sensitivity in the same review cycle.',
      es: 'Exponga la sensibilidad del valor economico del balance junto con la sensibilidad de utilidades en el mismo ciclo de revision.',
    },
    module: {
      label: { en: 'Rate Sensitivity', es: 'Sensibilidad de Tasa' },
      href: '/alm/sensitivity',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Public product copy for Rate Sensitivity states NII and EVE impacts across parallel shifts, and docs position EVE inside the current IRR scope.',
      es: 'La copia publica de Rate Sensitivity declara impactos NII y EVE bajo movimientos paralelos, y la documentacion ubica EVE dentro del scope actual de IRR.',
    },
  },
  {
    id: 'R5',
    requirement: {
      en: 'Liquidity Coverage Ratio (LCR)',
      es: 'Liquidity Coverage Ratio (LCR)',
    },
    buyerOutcome: {
      en: 'Track short-term liquidity resilience with a workflow already framed for supervisory review.',
      es: 'Siga la resiliencia de liquidez de corto plazo con un flujo ya planteado para revision supervisora.',
    },
    module: {
      label: { en: 'LCR / NSFR', es: 'LCR / NSFR' },
      href: '/alm/liquidity',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module registry claims Basel III LCR plus NCUA-oriented liquidity workflows, and site copy continues to include LCR in the public compliance promise.',
      es: 'El registro publico de modulos reclama LCR Basel III mas flujos de liquidez orientados a NCUA, y la copia del sitio sigue incluyendo LCR en la promesa publica de cumplimiento.',
    },
  },
  {
    id: 'R6',
    requirement: {
      en: 'Net Stable Funding Ratio (NSFR)',
      es: 'Net Stable Funding Ratio (NSFR)',
    },
    buyerOutcome: {
      en: 'Review structural funding posture over a longer horizon, not only near-term stress days.',
      es: 'Revise la posicion de fondeo estructural en un horizonte mas largo, no solo dias de estres de corto plazo.',
    },
    module: {
      label: { en: 'NSFR', es: 'NSFR' },
      href: '/alm/nsfr',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'partial',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public module copy frames NSFR as a Basel III structural funding workflow and references it from the broader liquidity suite.',
      es: 'La copia publica actual del modulo plantea NSFR como un flujo de fondeo estructural Basel III y lo referencia desde la suite amplia de liquidez.',
    },
  },
  {
    id: 'R7',
    requirement: {
      en: 'Concentration limits and exposure monitoring',
      es: 'Monitoreo de limites de concentracion y exposicion',
    },
    buyerOutcome: {
      en: 'Identify sector and obligor concentrations before they become a policy or exam finding.',
      es: 'Identifique concentraciones por sector y deudor antes de que se conviertan en un hallazgo de politica o examen.',
    },
    module: {
      label: { en: 'Concentration', es: 'Concentracion' },
      href: '/alm/concentration',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module registry claims sector and single-name exposure monitoring with policy limits, while exam-prep copy references concentration findings.',
      es: 'El registro publico de modulos reclama monitoreo de exposicion por sector y nombre individual con limites de politica, mientras la copia de exam prep referencia hallazgos de concentracion.',
    },
  },
  {
    id: 'R8',
    requirement: {
      en: 'CECL allowance adequacy',
      es: 'Adecuacion de la reserva CECL',
    },
    buyerOutcome: {
      en: 'Review reserve adequacy with a documented workflow instead of a quarter-end spreadsheet scramble.',
      es: 'Revise la adecuacion de la reserva con un flujo documentado en lugar de una carrera de hojas de calculo al cierre del trimestre.',
    },
    module: {
      label: { en: 'CECL', es: 'CECL' },
      href: '/alm/cecl',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'supported',
    },
    evidence: {
      en: 'Current public CECL copy claims WARM, Vintage, and PDxLGD methods, while the public compliance hub includes a quarterly CECL allowance review.',
      es: 'La copia publica actual de CECL reclama metodos WARM, Vintage y PDxLGD, mientras el compliance hub publico incluye una revision trimestral de la reserva CECL.',
    },
  },
  {
    id: 'R9',
    requirement: {
      en: 'Regulatory stress testing',
      es: 'Pruebas de estres regulatorias',
    },
    buyerOutcome: {
      en: 'Package rate, liquidity, and earnings stress analysis into a repeatable governance workflow.',
      es: 'Empaquete el analisis de estres de tasas, liquidez y utilidades en un flujo repetible de gobierno.',
    },
    module: {
      label: { en: 'DFAST Stress 2.0', es: 'Estres DFAST 2.0' },
      href: '/alm/stress-v2',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Public stress workflows include DFAST-style projections, the COSSEC stress pack, and custom stress-testing pages already linked from the product index.',
      es: 'Los flujos publicos de estres incluyen proyecciones estilo DFAST, el stress pack COSSEC y paginas de stress testing personalizadas ya enlazadas desde el indice del producto.',
    },
  },
  {
    id: 'R10',
    requirement: {
      en: 'Exam readiness and CAMEL workflows',
      es: 'Flujos de preparacion de examen y CAMEL',
    },
    buyerOutcome: {
      en: 'Centralize findings, action items, document readiness, and supervisory score context before exam season.',
      es: 'Centralice hallazgos, planes de accion, preparacion documental y contexto de puntuacion supervisora antes de la temporada de examenes.',
    },
    module: {
      label: { en: 'Exam Prep', es: 'Prep Examen' },
      href: '/alm/exam-prep',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'not_claimed',
      cecl: 'partial',
    },
    evidence: {
      en: 'Current public exam-prep copy claims COSSEC and NCUA readiness, CAMEL scoring, and document tracking, including CECL documentation gaps.',
      es: 'La copia publica actual de exam prep reclama preparacion para COSSEC y NCUA, scoring CAMEL y seguimiento documental, incluyendo brechas de documentacion CECL.',
    },
  },
  {
    id: 'R11',
    requirement: {
      en: 'Basel IRRBB standard shock set',
      es: 'Set estandar de shocks Basel IRRBB',
    },
    buyerOutcome: {
      en: 'Run a consistent public shock library instead of rebuilding scenario sets every quarter.',
      es: 'Ejecute una libreria publica consistente de shocks en lugar de reconstruir escenarios cada trimestre.',
    },
    module: {
      label: { en: 'Yield Curve', es: 'Curva de Rendimiento' },
      href: '/alm/yield-curve',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public Yield Curve workflow explicitly claims six Basel IRRBB shocks and preserves NII and EVE impacts.',
      es: 'El flujo publico de Yield Curve reclama explicitamente seis shocks Basel IRRBB y preserva los impactos de NII y EVE.',
    },
  },
  {
    id: 'R12',
    requirement: {
      en: 'Repricing gap in supervisory buckets',
      es: 'Brecha de repricing en buckets supervisorios',
    },
    buyerOutcome: {
      en: 'Present repricing concentration in a format that fits policy and examiner review cycles.',
      es: 'Presente la concentracion de repricing en un formato que encaje en ciclos de politica y revision examinadora.',
    },
    module: {
      label: { en: 'Repricing Gap', es: 'Brecha de Reprecio' },
      href: '/alm/repricing-gap',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'partial',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public module copy claims an exact seven-bucket supervisory format and positions repricing gap within the regulatory workflow set.',
      es: 'La copia publica actual del modulo reclama un formato supervisorio exacto de siete buckets y ubica repricing gap dentro del conjunto de flujos regulatorios.',
    },
  },
  {
    id: 'R13',
    requirement: {
      en: 'Funds transfer pricing (FTP)',
      es: 'Funds transfer pricing (FTP)',
    },
    buyerOutcome: {
      en: 'Support treasury pricing discussions with matched-maturity transfer-pricing analysis.',
      es: 'Apoye discusiones de pricing de tesoreria con analisis de transfer pricing a vencimiento equivalente.',
    },
    module: {
      label: { en: 'FTP Analysis', es: 'Analisis FTP' },
      href: '/alm/ftp',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'partial',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module index claims matched-maturity FTP and spread decomposition, and product docs position FTP inside the capital and treasury stack.',
      es: 'El indice publico de modulos reclama FTP a vencimiento equivalente y descomposicion de spread, y la documentacion del producto ubica FTP dentro del stack de capital y tesoreria.',
    },
  },
  {
    id: 'R14',
    requirement: {
      en: 'IRR policy limit monitoring',
      es: 'Monitoreo de limites de politica IRR',
    },
    buyerOutcome: {
      en: 'Flag watch, warning, and breach conditions before the next committee package goes out.',
      es: 'Marque condiciones de watch, warning y breach antes de que salga el proximo paquete de comite.',
    },
    module: {
      label: { en: 'IRR Policy Monitor', es: 'Monitor Politica IRR' },
      href: '/alm/irr-policy',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public IRR Policy copy claims EVE, NII, duration-gap limits, and supervisory references across multiple scenarios.',
      es: 'La copia publica actual de IRR Policy reclama limites de EVE, NII y duration gap, ademas de referencias supervisorias bajo multiples escenarios.',
    },
  },
  {
    id: 'R15',
    requirement: {
      en: 'NCUA RBC2 capital workflow',
      es: 'Flujo de capital NCUA RBC2',
    },
    buyerOutcome: {
      en: 'Work through the eight-component NCUA capital view without maintaining a separate manual model.',
      es: 'Trabaje la vista de capital NCUA de ocho componentes sin mantener un modelo manual separado.',
    },
    module: {
      label: { en: 'NCUA RBC2', es: 'NCUA RBC2' },
      href: '/alm/rbc2',
    },
    coverage: {
      cossec: 'not_claimed',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module registry claims an eight-component risk-based capital workflow per NCUA Letter 15-CU-02.',
      es: 'El registro publico de modulos reclama un flujo de capital basado en riesgo de ocho componentes segun NCUA Letter 15-CU-02.',
    },
  },
  {
    id: 'R16',
    requirement: {
      en: 'NCUA 5300 field mapping',
      es: 'Mapeo de campos NCUA 5300',
    },
    buyerOutcome: {
      en: 'Map analytical outputs into a filing workflow instead of re-keying the same data for call reports.',
      es: 'Mapee salidas analiticas a un flujo de radicacion en lugar de reingresar los mismos datos para call reports.',
    },
    module: {
      label: { en: 'NCUA 5300', es: 'NCUA 5300' },
      href: '/alm/form-5300',
    },
    coverage: {
      cossec: 'not_claimed',
      ncua: 'supported',
      basel: 'not_claimed',
      cecl: 'partial',
    },
    evidence: {
      en: 'Public module copy explicitly claims automated 5300 field mapping, and product copy frames the workflow as part of NCUA reporting readiness.',
      es: 'La copia publica del modulo reclama explicitamente mapeo automatizado de campos 5300, y la copia del producto plantea el flujo como parte de la preparacion de reportes NCUA.',
    },
  },
  {
    id: 'R17',
    requirement: {
      en: 'Board and ALCO reporting',
      es: 'Informes para junta y ALCO',
    },
    buyerOutcome: {
      en: 'Deliver a committee-ready narrative package instead of stitching together board slides by hand.',
      es: 'Entregue un paquete narrativo listo para comite en lugar de coser manualmente presentaciones para junta.',
    },
    module: {
      label: { en: 'Board Report', es: 'Informe Junta' },
      href: '/alm/board-report',
    },
    coverage: {
      cossec: 'supported',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'partial',
    },
    evidence: {
      en: 'Current public copy claims a 20-page bilingual PDF and broader board-ready reporting across ALM and credit sections.',
      es: 'La copia publica actual reclama un PDF bilingue de 20 paginas y reportes board-ready mas amplios a traves de secciones ALM y de credito.',
    },
  },
  {
    id: 'R18',
    requirement: {
      en: 'Climate risk assessment',
      es: 'Evaluacion de riesgo climatico',
    },
    buyerOutcome: {
      en: 'Bring scenario-based climate exposure into the same review stack used for other supervisory analytics.',
      es: 'Lleve la exposicion climatica basada en escenarios al mismo stack de revision usado para otras analiticas supervisorias.',
    },
    module: {
      label: { en: 'Climate Risk', es: 'Riesgo Climatico' },
      href: '/alm/climate-risk',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'partial',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module index claims climate-risk analytics, while product documentation positions climate disclosure inside the broader supervisory analytics stack.',
      es: 'El indice publico de modulos reclama analitica de riesgo climatico, mientras la documentacion del producto ubica disclosure climatico dentro del stack mas amplio de analitica supervisoria.',
    },
  },
  {
    id: 'R19',
    requirement: {
      en: 'Key rate duration',
      es: 'Key rate duration',
    },
    buyerOutcome: {
      en: 'Move from one aggregate duration figure to tenor-level rate-risk attribution when the portfolio needs it.',
      es: 'Pase de una sola cifra agregada de duracion a atribucion de riesgo por tenor cuando el portafolio lo necesite.',
    },
    module: {
      label: { en: 'Key Rate Duration', es: 'Duracion Tasa Clave' },
      href: '/alm/key-rate-durations',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'supported',
      basel: 'supported',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'Current public module copy claims KRD by tenor bucket with hedging precision, and the public compliance promise already includes key-rate duration.',
      es: 'La copia publica actual del modulo reclama KRD por bucket de tenor con precision de cobertura, y la promesa publica de cumplimiento ya incluye key rate duration.',
    },
  },
  {
    id: 'R20',
    requirement: {
      en: 'Deposit beta and NMD modeling',
      es: 'Modelado de deposit beta y NMD',
    },
    buyerOutcome: {
      en: 'Document deposit behavior assumptions with a workflow stronger than spreadsheet-side judgment calls.',
      es: 'Documente supuestos de comportamiento de depositos con un flujo mas fuerte que decisiones subjetivas en hojas de calculo.',
    },
    module: {
      label: { en: 'Deposit Beta', es: 'Beta de Depositos' },
      href: '/alm/deposit-beta',
    },
    coverage: {
      cossec: 'partial',
      ncua: 'supported',
      basel: 'partial',
      cecl: 'not_claimed',
    },
    evidence: {
      en: 'The public module index claims deposit-beta calibration against a PR library, and adjacent public workflows cover non-maturity deposit behavior.',
      es: 'El indice publico de modulos reclama calibracion de deposit beta contra una libreria de PR, y flujos publicos adyacentes cubren el comportamiento de depositos sin vencimiento.',
    },
  },
] as const;

export function getPublicComplianceCoverageCounts(
  framework: PublicComplianceFramework,
) {
  return PUBLIC_COMPLIANCE_MATRIX.reduce(
    (totals, row) => {
      const status = row.coverage[framework];
      if (status === 'supported') totals.supported += 1;
      if (status === 'partial') totals.partial += 1;
      if (status === 'not_claimed') totals.notClaimed += 1;
      return totals;
    },
    { supported: 0, partial: 0, notClaimed: 0, total: PUBLIC_COMPLIANCE_MATRIX.length },
  );
}
