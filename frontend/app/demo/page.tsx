"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Shield,
  MessageSquare,
  Send,
  ChevronRight,
  Sparkles,
  Receipt,
  Eye,
  Building2,
} from "lucide-react";
import { CerniqMark } from "@/components/brand/CerniqLogo";
import { getAcquisitionCopy } from "@/lib/acquisition-copy";
import { PUBLIC_PATHS } from "@/lib/public-links";

// ──────────────────────────────────────────────
// Language helper
// ──────────────────────────────────────────────
type Lang = "en" | "es";

// ──────────────────────────────────────────────
// Step definitions
// ──────────────────────────────────────────────
const STEPS = [
  { id: 1, labelEn: "COSSEC Score", labelEs: "Puntaje COSSEC" },
  { id: 2, labelEn: "ALM Report", labelEs: "Informe ALM" },
  { id: 3, labelEn: "SpendCheck", labelEs: "SpendCheck" },
  { id: 4, labelEn: "AI Advisor", labelEs: "Asesor IA" },
  { id: 5, labelEn: "Quant Engine", labelEs: "Motor Cuantitativo" },
  { id: 6, labelEn: "Start Pilot", labelEs: "Comenzar piloto" },
];

// ──────────────────────────────────────────────
// Demo institution data
// ──────────────────────────────────────────────
const DEMO_INSTITUTION = {
  name: "Example Bank of Puerto Rico",
  assets: "$18.9B",
  members: "320,000+",
  location: "San Juan, PR",
  overallScore: 82,
};

// ──────────────────────────────────────────────
// COSSEC 12-ratio traffic light data
// ──────────────────────────────────────────────
type RatioStatus = "PASS" | "WARNING" | "FAIL";

interface CossecRatio {
  id: string;
  nameEn: string;
  nameEs: string;
  value: string;
  thresholdEn: string;
  thresholdEs: string;
  status: RatioStatus;
}

const COSSEC_RATIOS: CossecRatio[] = [
  {
    id: "R1",
    nameEn: "CET1 Capital Ratio",
    nameEs: "Ratio Capital CET1",
    value: "16.4%",
    thresholdEn: ">= 6.5%",
    thresholdEs: ">= 6.5%",
    status: "PASS",
  },
  {
    id: "R2",
    nameEn: "NPL Ratio",
    nameEs: "Ratio Morosidad (NPL)",
    value: "1.42%",
    thresholdEn: "<= 5%",
    thresholdEs: "<= 5%",
    status: "PASS",
  },
  {
    id: "R3",
    nameEn: "Return on Assets (ROA)",
    nameEs: "Rentabilidad sobre Activos (ROA)",
    value: "1.58%",
    thresholdEn: ">= 0.5%",
    thresholdEs: ">= 0.5%",
    status: "PASS",
  },
  {
    id: "R4",
    nameEn: "Efficiency Ratio",
    nameEs: "Ratio de Eficiencia",
    value: "52.8%",
    thresholdEn: "<= 65%",
    thresholdEs: "<= 65%",
    status: "PASS",
  },
  {
    id: "R5",
    nameEn: "Liquidity Coverage Ratio (LCR)",
    nameEs: "Ratio de Cobertura de Liquidez (LCR)",
    value: "148.2%",
    thresholdEn: ">= 100%",
    thresholdEs: ">= 100%",
    status: "PASS",
  },
  {
    id: "R6",
    nameEn: "Loan-to-Deposit Ratio",
    nameEs: "Préstamos / Depósitos",
    value: "71.6%",
    thresholdEn: "<= 85%",
    thresholdEs: "<= 85%",
    status: "PASS",
  },
  {
    id: "R7",
    nameEn: "Allowance / NPL Coverage",
    nameEs: "Reserva / Cobertura NPL",
    value: "187.3%",
    thresholdEn: ">= 100%",
    thresholdEs: ">= 100%",
    status: "PASS",
  },
  {
    id: "R8",
    nameEn: "Net Interest Margin (NIM)",
    nameEs: "Margen de Interés Neto (NIM)",
    value: "4.25%",
    thresholdEn: ">= 2.5%",
    thresholdEs: ">= 2.5%",
    status: "PASS",
  },
  {
    id: "R9",
    nameEn: "Asset Growth Rate",
    nameEs: "Tasa de Crecimiento de Activos",
    value: "5.2%",
    thresholdEn: "3-10%",
    thresholdEs: "3-10%",
    status: "PASS",
  },
  {
    id: "R10",
    nameEn: "Duration Gap (years)",
    nameEs: "Brecha de Duración (años)",
    value: "+1.8 yr",
    thresholdEn: "<= 2.0 yr",
    thresholdEs: "<= 2.0 años",
    status: "PASS",
  },
  {
    id: "R11",
    nameEn: "CRE Concentration / Total Capital",
    nameEs: "Concentración CRE / Capital Total",
    value: "285%",
    thresholdEn: "<= 300%",
    thresholdEs: "<= 300%",
    status: "WARNING",
  },
  {
    id: "R12",
    nameEn: "EVE Sensitivity (+200bps)",
    nameEs: "Sensibilidad EVE (+200pbs)",
    value: "-$412M",
    thresholdEn: "<= -15% equity",
    thresholdEs: "<= -15% patrimonio",
    status: "WARNING",
  },
];

// ──────────────────────────────────────────────
// ALM Report pages (preview metadata)
// ──────────────────────────────────────────────
const ALM_REPORT_PAGES = [
  {
    pageEn: "Cover Page",
    pageEs: "Portada",
    descEn: "Example Bank of Puerto Rico - Q4 2025 ALM Report",
    descEs: "Example Bank of Puerto Rico - Informe ALM Q4 2025",
  },
  {
    pageEn: "Executive Summary",
    pageEs: "Resumen ejecutivo",
    descEn:
      "Overall risk score: 82/100. Strong capital position, two concentration warnings.",
    descEs:
      "Puntaje de riesgo general: 82/100. Posición de capital sólida, dos alertas de concentración.",
  },
  {
    pageEn: "Regulatory Ratio Grid",
    pageEs: "Cuadrícula de Ratios Regulatorios",
    descEn: "12 NCUA/Basel ratios with traffic light indicators",
    descEs: "12 ratios NCUA/Basel con indicadores semáforo",
  },
  {
    pageEn: "Balance Sheet Summary",
    pageEs: "Resumen Hoja de Balance",
    descEn: "Assets: $18.9B, Deposits: $15.2B, Equity: $2.4B",
    descEs: "Activos: $18.9B, Depósitos: $15.2B, Patrimonio: $2.4B",
  },
  {
    pageEn: "NII Sensitivity Analysis",
    pageEs: "Análisis de Sensibilidad NII",
    descEn:
      "Base NII: $742M. +200bps: +$118M (+15.9%). -200bps: -$96M (-12.9%)",
    descEs:
      "NII Base: $742M. +200pbs: +$118M (+15.9%). -200pbs: -$96M (-12.9%)",
  },
  {
    pageEn: "Duration Gap Analysis",
    pageEs: "Análisis de Brecha de Duración",
    descEn: "Asset duration: 3.8yr, Liability duration: 2.0yr, Gap: +1.8yr",
    descEs: "Duración activos: 3.8a, Duración pasivos: 2.0a, Brecha: +1.8a",
  },
  {
    pageEn: "EVE Sensitivity",
    pageEs: "Sensibilidad EVE",
    descEn:
      "EVE at +200bps: -$412M (-17.2%). Behavioral correction: -$248M (-10.3%)",
    descEs:
      "EVE a +200pbs: -$412M (-17.2%). Corrección conductual: -$248M (-10.3%)",
  },
  {
    pageEn: "Liquidity Coverage",
    pageEs: "Cobertura de Liquidez",
    descEn: "LCR: 148.2%, HQLA: $4.8B, NSFR: 118.4%",
    descEs: "LCR: 148.2%, HQLA: $4.8B, NSFR: 118.4%",
  },
  {
    pageEn: "Monte Carlo Stress Test",
    pageEs: "Prueba de Estrés Monte Carlo",
    descEn: "10,000 Vasicek paths. VaR-95: $385M, CVaR-99: $528M",
    descEs: "10,000 senderos Vasicek. VaR-95: $385M, CVaR-99: $528M",
  },
  {
    pageEn: "Concentration Risk",
    pageEs: "Riesgo de Concentración",
    descEn:
      "CRE concentration: 285% of total capital (limit: 300%). HHI: 1,420",
    descEs:
      "Concentración CRE: 285% del capital total (límite: 300%). HHI: 1,420",
  },
  {
    pageEn: "Peer Benchmarking",
    pageEs: "Benchmarking Sectorial",
    descEn: "Compared against 94 PR institutions (FDIC/NCUA Q3 2025)",
    descEs: "Comparado contra 94 instituciones PR (FDIC/NCUA Q3 2025)",
  },
  {
    pageEn: "Recommendations",
    pageEs: "Recomendaciones",
    descEn:
      "5 actionable items: hedge duration gap, diversify CRE, increase SOFR-linked assets",
    descEs:
      "5 acciones: cubrir brecha duración, diversificar CRE, aumentar activos SOFR",
  },
  {
    pageEn: "Appendix A: Methodology",
    pageEs: "Apéndice A: Metodología",
    descEn: "Calculation methodology & data sources (FRED, Treasury.gov, FDIC)",
    descEs: "Metodología de cálculo y fuentes (FRED, Treasury.gov, FDIC)",
  },
  {
    pageEn: "Appendix B: Glossary",
    pageEs: "Apéndice B: Glosario",
    descEn: "Terms and definitions in EN/ES",
    descEs: "Términos y definiciones en EN/ES",
  },
];

// ──────────────────────────────────────────────
// SpendCheck demo data
// ──────────────────────────────────────────────
type FindingSeverity = "HIGH" | "MEDIUM" | "LOW";
type SpendcheckTab =
  | "overview"
  | "anomalies"
  | "vendors"
  | "liquidity"
  | "report";

interface SpendFinding {
  id: string;
  titleEn: string;
  titleEs: string;
  severity: FindingSeverity;
  descEn: string;
  descEs: string;
  amountImpact: string;
}

const SPEND_FINDINGS: SpendFinding[] = [
  {
    id: "F1",
    titleEn: "Duplicate Invoice Detected",
    titleEs: "Factura duplicada detectada",
    severity: "HIGH",
    descEn:
      "Invoice #4782 from TechServe PR matches #4781 - same amount ($12,450), same vendor, 2 days apart.",
    descEs:
      "Factura #4782 de TechServe PR coincide con #4781 - mismo monto ($12,450), mismo proveedor, 2 dias de diferencia.",
    amountImpact: "$12,450",
  },
  {
    id: "F2",
    titleEn: "Amount Anomaly - 3x Average",
    titleEs: "Anomalia de monto - 3x promedio",
    severity: "HIGH",
    descEn:
      "Payment to Caribbean Office Supplies ($38,200) is 3.2x the rolling 12-month average ($11,937).",
    descEs:
      "Pago a Caribbean Office Supplies ($38,200) es 3.2x el promedio movil de 12 meses ($11,937).",
    amountImpact: "$26,263",
  },
  {
    id: "F3",
    titleEn: "Vendor Concentration Risk",
    titleEs: "Riesgo de concentracion de proveedores",
    severity: "HIGH",
    descEn:
      "Top 3 vendors represent 47% of total AP spend. Industry benchmark: <30%.",
    descEs:
      "Los 3 principales proveedores representan el 47% del gasto total de AP. Referencia del sector: <30%.",
    amountImpact: "$1.2M exposure",
  },
  {
    id: "F4",
    titleEn: "Late Payment Pattern",
    titleEs: "Patron de pagos tardios",
    severity: "MEDIUM",
    descEn:
      "14 invoices paid beyond net-30 terms in Q4. Estimated late fees: $2,800.",
    descEs:
      "14 facturas pagadas fuera del plazo net-30 en Q4. Cargos estimados por mora: $2,800.",
    amountImpact: "$2,800",
  },
  {
    id: "F5",
    titleEn: "Unused Early-Pay Discounts",
    titleEs: "Descuentos por pronto pago no utilizados",
    severity: "MEDIUM",
    descEn:
      "8 vendors offer 2/10 net-30 discounts. Estimated missed savings: $4,150/quarter.",
    descEs:
      "8 proveedores ofrecen descuento 2/10 net-30. Ahorro estimado perdido: $4,150/trimestre.",
    amountImpact: "$4,150",
  },
  {
    id: "F6",
    titleEn: "Round-Number Payment",
    titleEs: "Pago en numero redondo",
    severity: "LOW",
    descEn:
      "Payment of exactly $10,000 to Servicios Generales PR with no matching invoice.",
    descEs:
      "Pago de exactamente $10,000 a Servicios Generales PR sin factura correspondiente.",
    amountImpact: "$10,000",
  },
];

const SPEND_VENDORS = [
  {
    name: "TechServe PR",
    spend: "$284,000",
    pctEn: "19.2%",
    invoices: 48,
    riskEn: "Duplicate detected",
    riskEs: "Duplicado detectado",
  },
  {
    name: "Caribbean Office Supplies",
    spend: "$198,400",
    pctEn: "13.4%",
    invoices: 36,
    riskEn: "Amount anomaly",
    riskEs: "Anomalia de monto",
  },
  {
    name: "Seguridad Integral LLC",
    spend: "$212,000",
    pctEn: "14.3%",
    invoices: 24,
    riskEn: "Concentration",
    riskEs: "Concentracion",
  },
  {
    name: "NetPR Solutions",
    spend: "$96,200",
    pctEn: "6.5%",
    invoices: 18,
    riskEn: "None",
    riskEs: "Ninguno",
  },
  {
    name: "Limpieza Total Corp",
    spend: "$78,600",
    pctEn: "5.3%",
    invoices: 12,
    riskEn: "None",
    riskEs: "Ninguno",
  },
];

// ──────────────────────────────────────────────
// AI Advisor pre-loaded conversation
// ──────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  textEn: string;
  textEs: string;
}

const DEMO_CONVERSATION: ChatMessage[] = [
  {
    role: "user",
    textEn:
      "What happens to Example Bank if the Fed cuts 100 basis points in 2026?",
    textEs:
      "¿Qué pasa con Example Bank si la Fed recorta 100 puntos base en 2026?",
  },
  {
    role: "assistant",
    textEn:
      "Based on Example Bank's duration gap of +1.8 years and $12.4B in fixed-rate assets, a -100bps shock would reduce NII by approximately $48M (-6.5%) over 12 months as variable-rate assets reprice faster than fixed-rate liabilities. Your EVE would increase by +$164M as the longer-duration asset portfolio gains value. With LCR at 148.2% and $4.8B HQLA, your liquidity position remains strong. Key risk: $3.2B in CDs repricing in the next 6 months may demand higher rates to retain. Recommendation: lock in funding with 2-3yr FHLB advances before the rate cut.",
    textEs:
      "Basado en la brecha de duración de +1.8 años de Example Bank y $12.4B en activos de tasa fija, un choque de -100pbs reduciría el NII en aproximadamente $48M (-6.5%) en 12 meses ya que los activos de tasa variable se reprecian más rápido que los pasivos de tasa fija. Su EVE aumentaría en +$164M al ganar valor el portafolio de activos de mayor duración. Con LCR al 148.2% y $4.8B en HQLA, su posición de liquidez se mantiene sólida. Riesgo clave: $3.2B en CDs repreciándose en los próximos 6 meses puede demandar tasas más altas para retención. Recomendación: asegurar fondeo con avances FHLB a 2-3 años antes del recorte.",
  },
];

const CANNED_RESPONSES: {
  patternEn: string;
  responseEn: string;
  responseEs: string;
}[] = [
  {
    patternEn: "liquidity",
    responseEn:
      "Example Bank's LCR stands at 148.2%, well above the 100% minimum. HQLA of $4.8B against $3.24B in net outflows provides a 148-day coverage horizon. NSFR is 118.4%, indicating strong structural funding. Key monitor: the government deposit concentration (22% of total deposits) introduces event-risk sensitivity — a sovereign downgrade could trigger $1.2B in outflows within 30 days. Recommendation: maintain the unencumbered securities portfolio above $5B and diversify into private-sector deposits.",
    responseEs:
      "El LCR de Example Bank es 148.2%, muy por encima del mínimo del 100%. Los HQLA de $4.8B contra $3.24B en flujos netos proporciona un horizonte de cobertura de 148 días. El NSFR es 118.4%, indicando fondeo estructural sólido. Monitor clave: la concentración en depósitos gubernamentales (22% del total) introduce sensibilidad a eventos — una rebaja soberana podría desencadenar $1.2B en salidas en 30 días. Recomendación: mantener el portafolio de valores no comprometidos sobre $5B y diversificar hacia depósitos del sector privado.",
  },
  {
    patternEn: "capital",
    responseEn:
      "Example Bank's CET1 ratio is 16.4% ($2.4B equity / $14.6B risk-weighted assets), significantly above the 6.5% regulatory minimum and the 10% well-capitalized threshold. Total capital ratio: 17.8%. Excess capital above well-capitalized: $934M. This supports annual organic growth of 6-8% without capital raise. The 2025 share buyback program ($150M authorized) is well-covered. Key consideration: Basel III.1 implementation in 2026 may increase RWA for commercial real estate exposures by ~12%, which would reduce CET1 to approximately 14.8% — still well-capitalized.",
    responseEs:
      "El ratio CET1 de Example Bank es 16.4% ($2.4B patrimonio / $14.6B activos ponderados por riesgo), significativamente por encima del mínimo regulatorio de 6.5% y el umbral de bien capitalizado del 10%. Ratio capital total: 17.8%. Exceso de capital sobre bien capitalizado: $934M. Esto soporta crecimiento orgánico anual de 6-8% sin necesidad de levantar capital. El programa de recompra 2025 ($150M autorizado) está bien cubierto. Consideración clave: la implementación de Basel III.1 en 2026 puede incrementar los APR de CRE en ~12%, reduciendo CET1 a ~14.8% — aún bien capitalizado.",
  },
  {
    patternEn: "stress",
    responseEn:
      "Under the Monte Carlo stress test (10,000 Vasicek paths), the 95th percentile NII loss is $385M, which would reduce NIM from 4.25% to 2.89%. The 99th percentile (CVaR) shows $528M loss, reducing NIM to 2.32%. Even in the severe adverse scenario, CET1 remains above 12.1% (well-capitalized threshold: 10%). DFAST 9-quarter projection under severely adverse: cumulative net loss of $892M with CET1 trough at 11.4% in Q6. Recommendation: the $4.8B HQLA buffer and $2.1B available FHLB capacity provide sufficient countercyclical cushion. No immediate action required.",
    responseEs:
      "Bajo la prueba de estrés Monte Carlo (10,000 senderos Vasicek), la pérdida NII del percentil 95 es $385M, que reduciría el NIM de 4.25% a 2.89%. El percentil 99 (CVaR) muestra pérdida de $528M, reduciendo NIM a 2.32%. Aun en el escenario severamente adverso, el CET1 se mantiene sobre 12.1% (umbral bien capitalizado: 10%). Proyección DFAST 9 trimestres adverso severo: pérdida neta acumulada $892M con CET1 mínimo 11.4% en Q6. Recomendación: el buffer HQLA de $4.8B y $2.1B de capacidad FHLB disponible proveen colchón contracíclico suficiente. No se requiere acción inmediata.",
  },
];

const DEFAULT_CANNED_RESPONSE = {
  responseEn:
    "Based on Example Bank of Puerto Rico's current risk profile (score: 78/100), your institution is in a moderate risk position. Key areas to watch: (1) Duration gap of +2.3 years suggests asset-liability mismatch that should be addressed through shorter-duration asset allocation. (2) EVE sensitivity of -$4.2M at +200bps indicates vulnerability to rising rates. (3) Your strong capital position (10.2%) provides a buffer, but I recommend proactive duration management. Would you like me to elaborate on any specific metric?",
  responseEs:
    "Basado en el perfil de riesgo actual de Example Bank of Puerto Rico (puntaje: 78/100), su institucion se encuentra en una posicion de riesgo moderado. Areas clave a monitorear: (1) La brecha de duracion de +2.3 anos sugiere un desajuste activo-pasivo que debe abordarse mediante una asignacion de activos de menor duracion. (2) La sensibilidad EVE de -$4.2M a +200pbs indica vulnerabilidad a tasas en alza. (3) Su solida posicion de capital (10.2%) proporciona un buffer, pero recomiendo gestion proactiva de duracion. Desea que profundice en alguna metrica especifica?",
};

// ──────────────────────────────────────────────
// Fire-and-forget analytics tracker
// ──────────────────────────────────────────────
function trackDemoStep(step: number) {
  try {
    fetch("/api/demo/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, timestamp: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    // fire-and-forget
  }
}

// ──────────────────────────────────────────────
// Status badge component
// ──────────────────────────────────────────────
function StatusBadge({ status, lang }: { status: RatioStatus; lang: Lang }) {
  if (status === "PASS") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {lang === "en" ? "PASS" : "APROBADO"}
      </span>
    );
  }
  if (status === "WARNING") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {lang === "en" ? "WARNING" : "ALERTA"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">
      <XCircle className="h-3.5 w-3.5" />
      {lang === "en" ? "FAIL" : "FALLO"}
    </span>
  );
}

// ──────────────────────────────────────────────
// Severity badge for SpendCheck
// ──────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const cls =
    severity === "HIGH"
      ? "border-red-200 bg-red-50 text-red-700"
      : severity === "MEDIUM"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {severity}
    </span>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────
export default function DemoPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [step, setStep] = useState(1);
  const [spendTab, setSpendTab] = useState<SpendcheckTab>("overview");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(DEMO_CONVERSATION);
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const t = (en: string, es: string) => (lang === "en" ? en : es);
  const acquisition = getAcquisitionCopy(lang);

  // Track step views
  useEffect(() => {
    trackDemoStep(step);
  }, [step]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isTyping]);

  // Scroll content to top on step change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  function goToStep(s: number) {
    setStep(s);
  }

  function handleChatSend() {
    if (!chatInput.trim() || isTyping) return;
    const userText = chatInput.trim();
    setChatInput("");

    const userMsg: ChatMessage = {
      role: "user",
      textEn: userText,
      textEs: userText,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    // Find a matching canned response
    const lowerInput = userText.toLowerCase();
    const match = CANNED_RESPONSES.find((r) =>
      lowerInput.includes(r.patternEn),
    );

    setTimeout(() => {
      const aiMsg: ChatMessage = {
        role: "assistant",
        textEn: match ? match.responseEn : DEFAULT_CANNED_RESPONSE.responseEn,
        textEs: match ? match.responseEs : DEFAULT_CANNED_RESPONSE.responseEs,
      };
      setChatMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1200);
  }

  // ── Computed ──
  const passCount = COSSEC_RATIOS.filter((r) => r.status === "PASS").length;
  const warnCount = COSSEC_RATIOS.filter((r) => r.status === "WARNING").length;
  const failCount = COSSEC_RATIOS.filter((r) => r.status === "FAIL").length;
  const highFindings = SPEND_FINDINGS.filter(
    (f) => f.severity === "HIGH",
  ).length;

  return (
    <div className="min-h-screen text-slate-950">
      <h1 className="sr-only">
        {t("CERNIQ Interactive Demo", "Demo Interactivo CERNIQ")}
      </h1>
      {/* ── AMBER BANNER ── */}
      <div className="bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-white">
        <span className="mr-2">
          {t(
            "Demo Mode -- Sample data for Example Bank of Puerto Rico ($18.9B assets).",
            "Modo Demo -- Datos de ejemplo para Example Bank of Puerto Rico ($18.9B activos).",
          )}
        </span>
        <Link
          href="/get-started"
          className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-0.5 text-xs font-bold text-white transition hover:bg-white/30"
        >
          {acquisition.primaryCta}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* ── TOP NAV ── */}
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 rounded-full border border-slate-200/80 bg-white/80 px-4 py-2.5 backdrop-blur-xl sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <CerniqMark size="sm" />
            <div>
              <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">
                Cerniq
              </div>
              <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">
                {t("Interactive Demo", "Demo Interactivo")}
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-slate-200 text-xs">
              <button
                onClick={() => setLang("en")}
                className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === "en" ? "bg-cyan-700 text-white" : "text-slate-500 hover:text-slate-950"}`}
                aria-label="Switch to English"
                aria-pressed={lang === "en"}
              >
                EN
              </button>
              <button
                onClick={() => setLang("es")}
                className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === "es" ? "bg-cyan-700 text-white" : "text-slate-500 hover:text-slate-950"}`}
                aria-label="Cambiar a Espanol"
                aria-pressed={lang === "es"}
              >
                ES
              </button>
            </div>
            <Link
              href="/get-started"
              className="hidden rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 sm:inline-flex"
            >
              {acquisition.primaryCta}
            </Link>
          </div>
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ── LEFT: Progress indicator ── */}
          <div className="lg:w-64 lg:shrink-0">
            <div className="sticky top-4">
              <div className="cerniq-panel p-4">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                  {t("GUIDED TOUR", "RECORRIDO GUIADO")}
                </p>
                <p className="mb-4 text-xs text-slate-500">
                  {t("Step", "Paso")} {step} {t("of", "de")} 5
                </p>

                {/* Progress bar */}
                <div
                  className="cerniq-progress-track mb-5"
                  role="progressbar"
                  aria-valuenow={step}
                  aria-valuemin={1}
                  aria-valuemax={5}
                  aria-label={t(`Step ${step} of 5`, `Paso ${step} de 5`)}
                >
                  <div
                    className="cerniq-progress-bar"
                    style={{ width: `${(step / 5) * 100}%` }}
                  />
                </div>

                {/* Step list */}
                <div className="space-y-1">
                  {STEPS.map((s) => {
                    const isActive = s.id === step;
                    const isDone = s.id < step;
                    return (
                      <button
                        key={s.id}
                        onClick={() => goToStep(s.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                          isActive
                            ? "border border-cyan-300/60 bg-cyan-50 font-semibold text-slate-950"
                            : isDone
                              ? "text-slate-600 hover:bg-slate-50"
                              : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            isActive
                              ? "bg-cyan-700 text-white"
                              : isDone
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            s.id
                          )}
                        </span>
                        <span>{lang === "en" ? s.labelEn : s.labelEs}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Institution info */}
                <div className="mt-5 rounded-xl border border-slate-200/60 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Building2 className="h-3.5 w-3.5 text-cyan-700" />
                    <span className="font-semibold text-slate-700">
                      {DEMO_INSTITUTION.name}
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                    <p>
                      {t("Assets", "Activos")}: {DEMO_INSTITUTION.assets}
                    </p>
                    <p>
                      {t("Members", "Socios")}: {DEMO_INSTITUTION.members}
                    </p>
                    <p>{DEMO_INSTITUTION.location}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Content area ── */}
          <div ref={contentRef} className="min-w-0 flex-1">
            {/* ══════════════════════════════════════════════ */}
            {/* STEP 1: COSSEC Score                          */}
            {/* ══════════════════════════════════════════════ */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="cerniq-data-wave opacity-40" />
                  <div className="relative z-10">
                    <span className="cerniq-kicker mb-4 inline-flex">
                      {t(
                        "COSSEC Compliance Score",
                        "Puntaje de Cumplimiento COSSEC",
                      )}
                    </span>
                    <h2 className="font-display text-2xl text-slate-950 sm:text-3xl">
                      {t(
                        "12-Ratio Regulatory Traffic Light",
                        "Semaforo Regulatorio de 12 Ratios",
                      )}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                      {t(
                        "Every CERNIQ report calculates all 12 COSSEC/NCUA regulatory ratios and flags them as PASS, WARNING, or FAIL against regulatory thresholds.",
                        "Cada informe CERNIQ calcula los 12 ratios regulatorios COSSEC/NCUA y los marca como APROBADO, ALERTA o FALLO contra los umbrales regulatorios.",
                      )}
                    </p>
                  </div>
                </div>

                {/* Score ring */}
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                    {/* Score display */}
                    <div className="flex flex-col items-center">
                      <div className="relative flex h-32 w-32 items-center justify-center rounded-full border-4 border-cyan-200/50 bg-gradient-to-br from-cyan-50 to-white">
                        <div className="text-center">
                          <span className="font-display text-4xl font-bold text-slate-950">
                            {DEMO_INSTITUTION.overallScore}
                          </span>
                          <span className="block text-xs text-slate-500">
                            /100
                          </span>
                        </div>
                      </div>
                      <span className="mt-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                        {t("MODERATE", "MODERADO")}
                      </span>
                    </div>

                    {/* Summary badges */}
                    <div className="flex flex-1 flex-wrap gap-3">
                      <div className="flex-1 rounded-xl border border-emerald-200/60 bg-emerald-50/50 p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">
                          {passCount}
                        </p>
                        <p className="text-xs font-semibold text-emerald-600">
                          {t("PASS", "APROBADO")}
                        </p>
                      </div>
                      <div className="flex-1 rounded-xl border border-amber-200/60 bg-amber-50/50 p-3 text-center">
                        <p className="text-2xl font-bold text-amber-700">
                          {warnCount}
                        </p>
                        <p className="text-xs font-semibold text-amber-600">
                          {t("WARNING", "ALERTA")}
                        </p>
                      </div>
                      <div className="flex-1 rounded-xl border border-red-200/60 bg-red-50/50 p-3 text-center">
                        <p className="text-2xl font-bold text-red-700">
                          {failCount}
                        </p>
                        <p className="text-xs font-semibold text-red-600">
                          {t("FAIL", "FALLO")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ratio grid */}
                <div className="cerniq-table-shell">
                  <table className="cerniq-table">
                    <thead>
                      <tr>
                        <th className="w-12">#</th>
                        <th>{t("Ratio", "Ratio")}</th>
                        <th className="hidden sm:table-cell">
                          {t("Value", "Valor")}
                        </th>
                        <th className="hidden md:table-cell">
                          {t("Threshold", "Umbral")}
                        </th>
                        <th className="text-right">{t("Status", "Estado")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COSSEC_RATIOS.map((ratio) => (
                        <tr key={ratio.id}>
                          <td className="text-xs font-bold text-slate-400">
                            {ratio.id}
                          </td>
                          <td>
                            <div className="text-sm font-medium text-slate-800">
                              {lang === "en" ? ratio.nameEn : ratio.nameEs}
                            </div>
                            <div className="text-xs text-slate-500 sm:hidden">
                              {ratio.value}
                            </div>
                          </td>
                          <td className="hidden text-sm font-semibold tabular-nums text-slate-700 sm:table-cell">
                            {ratio.value}
                          </td>
                          <td className="hidden text-xs text-slate-500 md:table-cell">
                            {lang === "en"
                              ? ratio.thresholdEn
                              : ratio.thresholdEs}
                          </td>
                          <td className="text-right">
                            <StatusBadge status={ratio.status} lang={lang} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Next step */}
                <div className="flex justify-end">
                  <button
                    onClick={() => goToStep(2)}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    {t(
                      "Next: ALM Report Preview",
                      "Siguiente: Vista previa del informe ALM",
                    )}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* STEP 2: ALM Report Preview                    */}
            {/* ══════════════════════════════════════════════ */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="cerniq-data-wave opacity-40" />
                  <div className="relative z-10">
                    <span className="cerniq-kicker mb-4 inline-flex">
                      {t("Board Output", "Salida para Junta")}
                    </span>
                    <h2 className="font-display text-2xl text-slate-950 sm:text-3xl">
                      {t(
                        "Board-ready reporting package",
                        "Paquete de reportes listo para junta",
                      )}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                      {t(
                        "Every analysis generates a bilingual institutional reporting package. Below is the table of contents for Example Bank of Puerto Rico's Q1 2026 board output.",
                        "Cada analisis genera un paquete institucional bilingue de reportes. A continuacion se muestra el indice de la salida para junta Q1 2026 de Example Bank of Puerto Rico.",
                      )}
                    </p>
                  </div>
                </div>

                {/* Report page list */}
                <div className="cerniq-panel overflow-hidden">
                  <div className="border-b border-slate-200/60 bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-6 text-white sm:px-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                        <FileText className="h-7 w-7 text-cyan-300" />
                      </div>
                      <div>
                        <p className="text-lg font-bold">
                          {DEMO_INSTITUTION.name}
                        </p>
                        <p className="text-sm text-slate-300">
                          {t(
                            "Treasury and Risk Report - Q1 2026",
                            "Informe de Tesoreria y Riesgo - Q1 2026",
                          )}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          14 {t("pages", "paginas")} | EN/ES |{" "}
                          {t("Board-ready", "Listo para junta")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {ALM_REPORT_PAGES.map((page, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-4 px-5 py-3.5 transition hover:bg-cyan-50/30 sm:px-6"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">
                            {lang === "en" ? page.pageEn : page.pageEs}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {lang === "en" ? page.descEn : page.descEs}
                          </p>
                        </div>
                        <Eye className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Key metrics preview */}
                <div className="grid gap-4 sm:grid-cols-4">
                  {[
                    {
                      labelEn: "Risk Score",
                      labelEs: "Puntaje",
                      value: "78/100",
                      color: "text-amber-600",
                    },
                    {
                      labelEn: "Duration Gap",
                      labelEs: "Brecha",
                      value: "+2.3yr",
                      color: "text-amber-600",
                    },
                    {
                      labelEn: "LCR",
                      labelEs: "LCR",
                      value: "115.3%",
                      color: "text-emerald-600",
                    },
                    {
                      labelEn: "Capital",
                      labelEs: "Capital",
                      value: "10.2%",
                      color: "text-emerald-600",
                    },
                  ].map((m) => (
                    <div
                      key={m.labelEn}
                      className="cerniq-stat-card text-center"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                        {lang === "en" ? m.labelEn : m.labelEs}
                      </p>
                      <p
                        className={`mt-1 font-display text-2xl font-bold ${m.color}`}
                      >
                        {m.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Nav buttons */}
                <div className="flex justify-between">
                  <button
                    onClick={() => goToStep(1)}
                    className="cerniq-button-secondary text-sm"
                  >
                    {t("Back", "Atras")}
                  </button>
                  <button
                    onClick={() => goToStep(3)}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    {t("Next: SpendCheck", "Siguiente: SpendCheck")}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* STEP 3: SpendCheck                            */}
            {/* ══════════════════════════════════════════════ */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="cerniq-data-wave opacity-40" />
                  <div className="relative z-10">
                    <span className="cerniq-kicker mb-4 inline-flex">
                      SpendCheck
                    </span>
                    <h2 className="font-display text-2xl text-slate-950 sm:text-3xl">
                      {t(
                        "AP Intelligence & Anomaly Detection",
                        "Inteligencia de Cuentas por Pagar y Deteccion de Anomalias",
                      )}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                      {t(
                        "SpendCheck analyzes your accounts payable data to identify duplicate invoices, amount anomalies, vendor concentration risks, and missed discounts.",
                        "SpendCheck analiza sus datos de cuentas por pagar para identificar facturas duplicadas, anomalias de montos, riesgos de concentracion de proveedores y descuentos perdidos.",
                      )}
                    </p>
                  </div>
                </div>

                {/* AP Health Score */}
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="flex flex-col items-center gap-5 sm:flex-row">
                    <div className="flex flex-col items-center">
                      <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-amber-200/50 bg-gradient-to-br from-amber-50 to-white">
                        <div className="text-center">
                          <span className="font-display text-3xl font-bold text-slate-950">
                            72
                          </span>
                          <span className="block text-xs text-slate-500">
                            /100
                          </span>
                        </div>
                      </div>
                      <span className="mt-2 text-xs font-bold uppercase tracking-wider text-amber-600">
                        {t("AP Health Score", "Puntaje Salud AP")}
                      </span>
                    </div>

                    <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-slate-200/60 p-3 text-center">
                        <p className="text-xl font-bold text-red-600">
                          {highFindings}
                        </p>
                        <p className="text-[10px] font-semibold uppercase text-slate-500">
                          {t("High Risk", "Alto Riesgo")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 p-3 text-center">
                        <p className="text-xl font-bold text-amber-600">2</p>
                        <p className="text-[10px] font-semibold uppercase text-slate-500">
                          {t("Medium", "Medio")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 p-3 text-center">
                        <p className="text-xl font-bold text-slate-500">1</p>
                        <p className="text-[10px] font-semibold uppercase text-slate-500">
                          {t("Low", "Bajo")}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 p-3 text-center">
                        <p className="text-xl font-bold text-cyan-700">
                          $1.48M
                        </p>
                        <p className="text-[10px] font-semibold uppercase text-slate-500">
                          {t("Total Exposure", "Exposicion Total")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200/60 bg-white/80 p-1">
                  {[
                    {
                      key: "overview" as SpendcheckTab,
                      en: "Overview",
                      es: "Resumen",
                    },
                    {
                      key: "anomalies" as SpendcheckTab,
                      en: "Anomalies",
                      es: "Anomalias",
                    },
                    {
                      key: "vendors" as SpendcheckTab,
                      en: "Vendors",
                      es: "Proveedores",
                    },
                    {
                      key: "liquidity" as SpendcheckTab,
                      en: "Liquidity",
                      es: "Liquidez",
                    },
                    {
                      key: "report" as SpendcheckTab,
                      en: "Report",
                      es: "Informe",
                    },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setSpendTab(tab.key)}
                      className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        spendTab === tab.key
                          ? "bg-cyan-700 text-white"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      }`}
                    >
                      {lang === "en" ? tab.en : tab.es}
                    </button>
                  ))}
                </div>

                {/* Tab: Overview */}
                {spendTab === "overview" && (
                  <div className="cerniq-panel p-5 sm:p-6">
                    <h3 className="mb-4 font-display text-lg text-slate-950">
                      {t("Key Findings", "Hallazgos Clave")}
                    </h3>
                    <div className="space-y-3">
                      {SPEND_FINDINGS.map((f) => (
                        <div
                          key={f.id}
                          className="flex flex-col gap-2 rounded-xl border border-slate-200/60 p-4 transition hover:border-cyan-200/40 sm:flex-row sm:items-start sm:gap-4"
                        >
                          <SeverityBadge severity={f.severity} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800">
                              {lang === "en" ? f.titleEn : f.titleEs}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {lang === "en" ? f.descEn : f.descEs}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-slate-700">
                            {f.amountImpact}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab: Anomalies */}
                {spendTab === "anomalies" && (
                  <div className="cerniq-panel p-5 sm:p-6">
                    <h3 className="mb-4 font-display text-lg text-slate-950">
                      {t("Detected Anomalies", "Anomalias Detectadas")}
                    </h3>
                    <div className="space-y-3">
                      {SPEND_FINDINGS.filter(
                        (f) => f.severity === "HIGH" || f.severity === "MEDIUM",
                      ).map((f) => (
                        <div
                          key={f.id}
                          className="rounded-xl border border-slate-200/60 p-4"
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <SeverityBadge severity={f.severity} />
                            <span className="text-sm font-semibold text-slate-800">
                              {lang === "en" ? f.titleEn : f.titleEs}
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-slate-500">
                            {lang === "en" ? f.descEn : f.descEs}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-slate-400">
                              {t("Impact", "Impacto")}:
                            </span>
                            <span className="text-sm font-bold text-red-600">
                              {f.amountImpact}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab: Vendors */}
                {spendTab === "vendors" && (
                  <div className="cerniq-table-shell">
                    <table className="cerniq-table">
                      <thead>
                        <tr>
                          <th>{t("Vendor", "Proveedor")}</th>
                          <th>{t("Spend", "Gasto")}</th>
                          <th className="hidden sm:table-cell">
                            % {t("of Total", "del Total")}
                          </th>
                          <th className="hidden sm:table-cell">
                            {t("Invoices", "Facturas")}
                          </th>
                          <th>{t("Risk Flag", "Alerta")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SPEND_VENDORS.map((v) => (
                          <tr key={v.name}>
                            <td className="text-sm font-medium text-slate-800">
                              {v.name}
                            </td>
                            <td className="text-sm font-semibold tabular-nums text-slate-700">
                              {v.spend}
                            </td>
                            <td className="hidden text-sm text-slate-500 sm:table-cell">
                              {v.pctEn}
                            </td>
                            <td className="hidden text-sm text-slate-500 sm:table-cell">
                              {v.invoices}
                            </td>
                            <td>
                              <span
                                className={`text-xs font-medium ${v.riskEn === "None" ? "text-slate-400" : "text-red-600"}`}
                              >
                                {lang === "en" ? v.riskEn : v.riskEs}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tab: Liquidity */}
                {spendTab === "liquidity" && (
                  <div className="cerniq-panel p-5 sm:p-6">
                    <h3 className="mb-4 font-display text-lg text-slate-950">
                      {t("AP Liquidity Impact", "Impacto de Liquidez AP")}
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-200/60 p-4 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t("Total AP Outstanding", "Total AP Pendiente")}
                        </p>
                        <p className="mt-1 font-display text-2xl font-bold text-slate-800">
                          $1.48M
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 p-4 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t("Avg Days to Pay", "Dias Promedio Pago")}
                        </p>
                        <p className="mt-1 font-display text-2xl font-bold text-amber-600">
                          34.2
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 p-4 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {t(
                            "Missed Discounts (YTD)",
                            "Descuentos Perdidos (YTD)",
                          )}
                        </p>
                        <p className="mt-1 font-display text-2xl font-bold text-red-600">
                          $16,600
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-cyan-200/40 bg-cyan-50/50 p-4">
                      <p className="text-xs font-semibold text-cyan-800">
                        {t(
                          "Recommendation: Implement 2/10 net-30 discount capture for top 8 vendors to recover ~$16,600 annually.",
                          "Recomendacion: Implementar captura de descuento 2/10 net-30 para los 8 principales proveedores y recuperar ~$16,600 anualmente.",
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tab: Report */}
                {spendTab === "report" && (
                  <div className="cerniq-panel p-5 sm:p-6">
                    <h3 className="mb-4 font-display text-lg text-slate-950">
                      {t(
                        "SpendCheck Report Summary",
                        "Resumen de Informe SpendCheck",
                      )}
                    </h3>
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-5">
                      <div className="space-y-3 text-sm text-slate-700">
                        <p className="font-semibold">
                          {DEMO_INSTITUTION.name} - SpendCheck{" "}
                          {t("Analysis", "Analisis")} Q1 2026
                        </p>
                        <div className="h-px bg-slate-200" />
                        <p>
                          {t(
                            "Total invoices analyzed",
                            "Total de facturas analizadas",
                          )}
                          : <strong>138</strong>
                        </p>
                        <p>
                          {t("Total vendors", "Total de proveedores")}:{" "}
                          <strong>24</strong>
                        </p>
                        <p>
                          {t("Findings", "Hallazgos")}:{" "}
                          <strong className="text-red-600">
                            3 {t("HIGH", "ALTO")}
                          </strong>
                          ,{" "}
                          <strong className="text-amber-600">
                            2 {t("MEDIUM", "MEDIO")}
                          </strong>
                          ,{" "}
                          <strong className="text-slate-500">
                            1 {t("LOW", "BAJO")}
                          </strong>
                        </p>
                        <p>
                          {t(
                            "Potential savings identified",
                            "Ahorros potenciales identificados",
                          )}
                          :{" "}
                          <strong className="text-emerald-700">$55,663</strong>
                        </p>
                        <p>
                          AP {t("Health Score", "Puntaje de Salud")}:{" "}
                          <strong className="text-amber-600">72/100</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Nav buttons */}
                <div className="flex justify-between">
                  <button
                    onClick={() => goToStep(2)}
                    className="cerniq-button-secondary text-sm"
                  >
                    {t("Back", "Atras")}
                  </button>
                  <button
                    onClick={() => goToStep(4)}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    {t("Next: AI Advisor", "Siguiente: Asesor IA")}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* STEP 4: AI Advisor                            */}
            {/* ══════════════════════════════════════════════ */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="cerniq-panel p-5 sm:p-6">
                  <div className="cerniq-data-wave opacity-40" />
                  <div className="relative z-10">
                    <span className="cerniq-kicker mb-4 inline-flex">
                      {t("AI Advisor", "Asesor IA")}
                    </span>
                    <h2 className="font-display text-2xl text-slate-950 sm:text-3xl">
                      {t(
                        "Ask Questions About Your Risk Profile",
                        "Haga Preguntas Sobre Su Perfil de Riesgo",
                      )}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                      {t(
                        "CERNIQ's AI Advisor answers questions about your institution's risk metrics, regulatory compliance, and scenario analysis.",
                        "El Asesor IA de CERNIQ responde preguntas sobre las metricas de riesgo de su institucion, cumplimiento regulatorio y analisis de escenarios.",
                      )}
                    </p>
                  </div>
                </div>

                {/* Chat window */}
                <div
                  className="cerniq-panel flex flex-col"
                  style={{ height: "480px" }}
                  role="region"
                  aria-label={t("AI Advisor chat", "Chat del Asesor IA")}
                >
                  {/* Messages */}
                  <div
                    className="flex-1 overflow-y-auto p-4 sm:p-5"
                    aria-live="polite"
                  >
                    <div className="space-y-4">
                      {chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          {msg.role === "assistant" && (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50">
                              <Sparkles className="h-4 w-4 text-cyan-700" />
                            </div>
                          )}
                          <div
                            className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                              msg.role === "user"
                                ? "bg-cyan-700 text-white"
                                : "border border-slate-200/60 bg-white text-slate-700"
                            }`}
                          >
                            {lang === "en" ? msg.textEn : msg.textEs}
                          </div>
                          {msg.role === "user" && (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100">
                              <MessageSquare className="h-4 w-4 text-slate-500" />
                            </div>
                          )}
                        </div>
                      ))}

                      {isTyping && (
                        <div className="flex gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50">
                            <Sparkles className="h-4 w-4 text-cyan-700" />
                          </div>
                          <div className="rounded-2xl border border-slate-200/60 bg-white px-4 py-3">
                            <div className="flex gap-1">
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-slate-300"
                                style={{ animationDelay: "0ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-slate-300"
                                style={{ animationDelay: "150ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-slate-300"
                                style={{ animationDelay: "300ms" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>
                  </div>

                  {/* Suggested prompts */}
                  <div className="border-t border-slate-200/60 bg-slate-50/40 px-4 py-2">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {t("Try asking", "Pruebe preguntar")}:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        {
                          en: "What about our liquidity?",
                          es: "Que hay de nuestra liquidez?",
                        },
                        {
                          en: "Explain the capital position",
                          es: "Explique la posicion de capital",
                        },
                        {
                          en: "Run a stress test scenario",
                          es: "Ejecute un escenario de estres",
                        },
                      ].map((q) => (
                        <button
                          key={q.en}
                          onClick={() => {
                            setChatInput(lang === "en" ? q.en : q.es);
                          }}
                          className="rounded-full border border-slate-200/60 bg-white px-2.5 py-1 text-[11px] text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700"
                        >
                          {lang === "en" ? q.en : q.es}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input */}
                  <div className="border-t border-slate-200/60 p-3">
                    <div className="flex gap-2">
                      <label htmlFor="demo-chat-input" className="sr-only">
                        {t("Ask a question", "Haga una pregunta")}
                      </label>
                      <input
                        id="demo-chat-input"
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleChatSend();
                        }}
                        placeholder={t(
                          "Ask about Example Bank of Puerto Rico's risk profile...",
                          "Pregunte sobre el perfil de riesgo de Example Bank of Puerto Rico...",
                        )}
                        className="cerniq-field flex-1 text-sm"
                      />
                      <button
                        onClick={handleChatSend}
                        disabled={!chatInput.trim() || isTyping}
                        aria-label={t("Send message", "Enviar mensaje")}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-700 text-white transition hover:bg-cyan-600 disabled:opacity-40"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-center text-[10px] text-slate-400">
                      {t(
                        "Demo mode: responses are pre-loaded samples.",
                        "Modo demo: las respuestas son muestras pre-cargadas.",
                      )}
                    </p>
                  </div>
                </div>

                {/* Nav buttons */}
                <div className="flex justify-between">
                  <button
                    onClick={() => goToStep(3)}
                    className="cerniq-button-secondary text-sm"
                  >
                    {t("Back", "Atras")}
                  </button>
                  <button
                    onClick={() => goToStep(5)}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    {t("Next: Start Pilot", "Siguiente: Comenzar piloto")}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* STEP 5: Quant Engine Preview                  */}
            {/* ══════════════════════════════════════════════ */}
            {step === 5 && (
              <div className="space-y-4">
                <div className="cerniq-shell p-5 sm:p-6">
                  <div className="cerniq-panel p-6">
                    <h2 className="font-display text-xl text-slate-950 mb-2">
                      {lang === "en"
                        ? "34 Quant Models — Institutional-Grade, Credit Union Pricing"
                        : "34 Modelos Cuantitativos — Nivel Institucional, Precio Cooperativa"}
                    </h2>
                    <p className="text-sm text-slate-600 mb-5">
                      {lang === "en"
                        ? "Every model runs on your institution's real data. No consultants, no spreadsheets."
                        : "Cada modelo corre con datos reales de su institución. Sin consultores, sin hojas de cálculo."}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        {
                          name: "Nelson-Siegel",
                          desc:
                            lang === "en" ? "Yield curve" : "Curva rendimiento",
                        },
                        {
                          name: "Vasicek MC",
                          desc:
                            lang === "en" ? "10K rate paths" : "10K senderos",
                        },
                        {
                          name: "Black-Litterman",
                          desc:
                            lang === "en"
                              ? "Bayesian allocation"
                              : "Asignación Bayesiana",
                        },
                        { name: "CreditMetrics", desc: "JP Morgan VaR" },
                        { name: "KMV-Merton", desc: "Distance-to-Default" },
                        { name: "FRTB-IMA", desc: "Basel III.1 ES" },
                        { name: "CVaR Optimizer", desc: "Rockafellar-Uryasev" },
                        { name: "HRP", desc: "López de Prado" },
                        { name: "CECL 3-Method", desc: "WARM + Vintage + PD" },
                        {
                          name: "HMM Regime",
                          desc:
                            lang === "en"
                              ? "Viterbi 4-state"
                              : "Viterbi 4 estados",
                        },
                        {
                          name: "PCA Yield Curve",
                          desc:
                            lang === "en"
                              ? "3-factor decomp"
                              : "Descomp. 3 factores",
                        },
                        { name: "Copula Credit", desc: "Gaussian vs t" },
                      ].map((m) => (
                        <div
                          key={m.name}
                          className="rounded-lg border border-slate-200 bg-white p-2.5"
                        >
                          <p className="text-xs font-bold text-slate-800">
                            {m.name}
                          </p>
                          <p className="text-[10px] text-slate-400">{m.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-center text-[10px] text-slate-400 mt-3">
                      {lang === "en"
                        ? "+ 22 more models across duration, liquidity, credit & market risk"
                        : "+ 22 modelos más en duración, liquidez, crédito y riesgo de mercado"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* STEP 6: Get Started                           */}
            {/* ══════════════════════════════════════════════ */}
            {step === 6 && (
              <div className="space-y-4">
                <div className="cerniq-shell p-5 sm:p-6 lg:p-8">
                  <div className="cerniq-panel p-6 sm:p-8">
                    <div className="cerniq-data-wave opacity-50" />
                    <div className="relative z-10 mx-auto max-w-2xl text-center">
                      <CerniqMark size="lg" className="mx-auto mb-6" />
                      <h2 className="font-display text-3xl text-slate-950 sm:text-4xl">
                        {t(
                          "Ready to use CERNIQ with your institution's real data?",
                          "Listo para usar CERNIQ con los datos reales de su institucion?",
                        )}
                      </h2>
                      <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-slate-600">
                        {t(
                          "Upload your balance sheet and move into the full treasury, risk, and board-output workflow with bilingual reporting delivered on a clean institutional cadence.",
                          "Cargue su hoja de balance y pase al flujo completo de tesoreria, riesgo y salida para junta con reportes bilingues entregados en una cadencia institucional limpia.",
                        )}
                      </p>

                      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                        <Link
                          href="/get-started"
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-8 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-amber-600 hover:-translate-y-0.5"
                        >
                          {acquisition.primaryCta}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link href={PUBLIC_PATHS.contact} className="cerniq-button-secondary">
                          {acquisition.salesCta}
                        </Link>
                      </div>

                      {/* What you saw recap */}
                      <div className="mx-auto mt-10 max-w-lg">
                        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                          {t("WHAT YOU EXPLORED TODAY", "LO QUE EXPLORO HOY")}
                        </p>
                        <div className="grid grid-cols-2 gap-3 text-left">
                          <div className="rounded-xl border border-slate-200/60 p-3">
                            <Shield className="mb-2 h-5 w-5 text-cyan-700" />
                            <p className="text-xs font-semibold text-slate-800">
                              {t("12 COSSEC Ratios", "12 Ratios COSSEC")}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {t(
                                "Traffic light compliance grid",
                                "Cuadricula de cumplimiento semaforo",
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/60 p-3">
                            <FileText className="mb-2 h-5 w-5 text-cyan-700" />
                            <p className="text-xs font-semibold text-slate-800">
                              {t(
                                "14-Page ALM Report",
                                "Informe ALM de 14 paginas",
                              )}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {t(
                                "Board-ready bilingual PDF",
                                "PDF bilingue listo para junta",
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/60 p-3">
                            <Receipt className="mb-2 h-5 w-5 text-cyan-700" />
                            <p className="text-xs font-semibold text-slate-800">
                              SpendCheck
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {t(
                                "AP anomaly detection",
                                "Deteccion de anomalias AP",
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/60 p-3">
                            <Sparkles className="mb-2 h-5 w-5 text-cyan-700" />
                            <p className="text-xs font-semibold text-slate-800">
                              {t("AI Advisor", "Asesor IA")}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {t(
                                "Risk scenario analysis",
                                "Analisis de escenarios de riesgo",
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Cost comparison */}
                      <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">
                          {t(
                            "CERNIQ: $750 per report vs. Traditional consultant: $8,000-$12,000",
                            "CERNIQ: $750 por informe vs. Consultor tradicional: $8,000-$12,000",
                          )}
                        </p>
                        <p className="mt-1 text-xs text-emerald-600">
                          {t(
                            "Save 83-93% on ALM analysis",
                            "Ahorre 83-93% en analisis ALM",
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Back button */}
                <div className="flex justify-start">
                  <button
                    onClick={() => goToStep(4)}
                    className="cerniq-button-secondary text-sm"
                  >
                    {t("Back", "Atras")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div className="border-t border-slate-200/60 bg-white/60 py-4 text-center text-xs text-slate-400">
        CERNIQ &middot; KLYTICS LLC &middot; San Juan, PR &middot;{" "}
        {new Date().getFullYear()}
      </div>
    </div>
  );
}
