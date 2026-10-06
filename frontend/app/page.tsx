"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  FileText,
  LineChart,
  PlayCircle,
  ShieldCheck,
  Target,
  Upload,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { createCheckoutSession, type CheckoutTier } from "@/lib/billing";
import { analytics, EVENTS } from "@/lib/analytics";
import { PRICING, getCtaLabel } from "@/lib/pricing";
import { buildLoginUrlForReturnUrl } from "@/lib/auth-redirect";
import { CerniqLockup, CerniqMark } from "@/components/brand/CerniqLogo";
import Footer from "@/components/layout/Footer";
import { getAcquisitionCopy } from "@/lib/acquisition-copy";
import { PUBLIC_COMPLIANCE_MATRIX } from "@/lib/public-compliance-matrix";
import { PUBLIC_PATHS } from "@/lib/public-links";

const DEMO_VIDEO_URL = (
  process.env.NEXT_PUBLIC_CERNIQ_DEMO_VIDEO_URL || ""
).trim();

const institutionOptionsEN = [
  { value: "", label: "Institution type" },
  { value: "cooperativa", label: "Cooperativa" },
  { value: "credit_union", label: "Credit Union" },
  { value: "cpa_consultant", label: "CPA / Consulting Firm" },
  { value: "community_bank", label: "Community Bank" },
  { value: "other", label: "Other" },
];

const institutionOptionsES = [
  { value: "", label: "Tipo de institucion" },
  { value: "cooperativa", label: "Cooperativa" },
  { value: "credit_union", label: "Credit Union" },
  { value: "cpa_consultant", label: "CPA / Consultora" },
  { value: "community_bank", label: "Banco comunitario" },
  { value: "other", label: "Otro" },
];

const assetRangesEN = [
  { value: "", label: "Asset range" },
  { value: "< $100M", label: "< $100M" },
  { value: "$100M - $500M", label: "$100M - $500M" },
  { value: "$500M - $1B", label: "$500M - $1B" },
  { value: "$1B - $5B", label: "$1B - $5B" },
  { value: "$5B+", label: "$5B+" },
];

const assetRangesES = [
  { value: "", label: "Rango de activos" },
  { value: "< $100M", label: "< $100M" },
  { value: "$100M - $500M", label: "$100M - $500M" },
  { value: "$500M - $1B", label: "$500M - $1B" },
  { value: "$1B - $5B", label: "$1B - $5B" },
  { value: "$5B+", label: "$5B+" },
];

const pulseHooksEN = [
  "Open the reporting cycle before the next ALCO packet is due.",
  "Move from quarterly spreadsheet choreography to a repeatable operating rhythm.",
  "Bring rate risk, portfolio context, and board delivery into one system of record.",
];

const pulseHooksES = [
  "Abra el ciclo de reportes antes del proximo paquete de ALCO.",
  "Pase de la coreografia trimestral en hojas de calculo a un ritmo operativo repetible.",
  "Una riesgo de tasas, contexto de portafolio y entrega a junta en un solo sistema.",
];

const heroMetrics = [
  { label: "Treasury + Risk", labelEs: "Tesoreria + Riesgo", value: "1" },
  {
    label: "Institutional command surface",
    labelEs: "Superficie de mando institucional",
    value: "4",
  },
  {
    label: "Bilingual board outputs",
    labelEs: "Salidas bilingues para junta",
    value: "EN/ES",
  },
  {
    label: "Primary workflow",
    labelEs: "Flujo primario",
    value: "Upload -> Report",
  },
];

const platformPillars = [
  {
    href: "/dashboard",
    icon: Building2,
    title: "Treasury intelligence",
    titleEs: "Inteligencia de tesoreria",
    body:
      "Anchor the CFO, treasurer, and ALCO workflow in one command surface built for review, escalation, and delivery.",
    bodyEs:
      "Ancle el flujo del CFO, tesorero y ALCO en una sola superficie de mando para revision, escalacion y entrega.",
  },
  {
    href: "/alm",
    icon: ShieldCheck,
    title: "Risk operating system",
    titleEs: "Sistema operativo de riesgo",
    body:
      "Run ALM, stress, liquidity, and compliance narratives through the same institutional workflow instead of disconnected reports.",
    bodyEs:
      "Ejecute ALM, estres, liquidez y cumplimiento en el mismo flujo institucional en vez de reportes desconectados.",
  },
];

const operatingLinks = [
  {
    href: "/dashboard",
    label: "Open command center",
    labelEs: "Abrir centro de mando",
  },
  {
    href: "/alm",
    label: "Run ALM models",
    labelEs: "Correr modelos ALM",
  },
];

const PUBLIC_GATED_MODULE_PATHS = new Set(["/alm"]);

const workflowSteps = [
  {
    icon: Upload,
    label: "1. Ingest",
    labelEs: "1. Ingerir",
    title: "Load institution context once",
    titleEs: "Cargue el contexto institucional una vez",
    body:
      "Bring in the balance sheet, institution profile, and current operating context through the secure workspace.",
    bodyEs:
      "Traiga hoja de balance, perfil institucional y contexto operativo al workspace seguro.",
  },
  {
    icon: BarChart3,
    label: "2. Model",
    labelEs: "2. Modelar",
    title: "Model rates, risk, and exposure",
    titleEs: "Modele tasas, riesgo y exposicion",
    body:
      "Use CERNIQ as the operating layer across ALM analytics, scenario review, market context, and portfolio insight.",
    bodyEs:
      "Use CERNIQ como capa operativa sobre analitica ALM, escenarios, contexto de mercado y vision de portafolio.",
  },
  {
    icon: FileText,
    label: "3. Deliver",
    labelEs: "3. Entregar",
    title: "Ship board-ready output",
    titleEs: "Entregue salidas listas para junta",
    body:
      "Move directly from analysis to committee, board, and advisory deliverables without reassembling the story in spreadsheets.",
    bodyEs:
      "Pase directo del analisis a entregables para comite, junta y asesores sin reconstruir la historia en hojas de calculo.",
  },
];

const audienceTracks = [
  {
    title: "Primary: Treasury + Risk",
    titleEs: "Primario: Tesoreria + Riesgo",
    body:
      "CFO, treasurer, ALCO, and risk teams use CERNIQ as the operating layer for reporting, rate posture, institution health, and board prep.",
    bodyEs:
      "CFO, tesorero, ALCO y riesgo usan CERNIQ como capa operativa para reportes, postura de tasas, salud institucional y preparacion de junta.",
  },
  {
    title: "Secondary: PM + Analyst",
    titleEs: "Secundario: PM + Analista",
    body:
      "Portfolio and analyst teams get a connected view of mandates, live positions, execution quality, and rate-sensitive portfolio context.",
    bodyEs:
      "Equipos de portafolio y analistas obtienen una vista conectada de mandatos, posiciones, calidad de ejecucion y contexto sensible a tasas.",
  },
  {
    title: "Tertiary: Advisor + Client",
    titleEs: "Terciario: Asesor + Cliente",
    body:
      "CPA, advisory, and white-label relationships stay supported through polished output and multi-client operating paths.",
    bodyEs:
      "Relaciones CPA, advisory y white-label siguen soportadas con salidas pulidas y rutas multi-cliente.",
  },
];

const institutionalFaqs = [
  {
    q: "Is CERNIQ only for Puerto Rico institutions?",
    qEs: "¿CERNIQ es solo para instituciones de Puerto Rico?",
    a:
      "No. Puerto Rico remains an important proof market, but the product is positioned as an institutional treasury, risk, and portfolio intelligence platform for credit unions, community banks, advisors, and similar regulated teams.",
    aEs:
      "No. Puerto Rico sigue siendo un mercado importante de prueba, pero el producto esta posicionado como una plataforma institucional de tesoreria, riesgo e inteligencia de portafolio para credit unions, bancos comunitarios, asesores y equipos regulados similares.",
  },
  {
    q: "Do I need to choose between ALM and portfolio workflows?",
    qEs: "¿Tengo que escoger entre ALM y flujos de portafolio?",
    a:
      "No. The relaunch keeps ALM as the primary workflow while making portfolio, execution, and market surfaces visible as part of the same operating system.",
    aEs:
      "No. El relanzamiento mantiene ALM como flujo primario mientras hace visibles las superficies de portafolio, ejecucion y mercado dentro del mismo sistema operativo.",
  },
  {
    q: "What makes the board workflow different from a consultant report?",
    qEs: "¿Que hace diferente el flujo para junta frente a un informe de consultor?",
    a:
      "CERNIQ is designed as an ongoing institutional workflow: ingest, model, review, and deliver. The board packet is an output of that system, not a one-off artifact assembled at the end.",
    aEs:
      "CERNIQ esta disenado como un flujo institucional continuo: ingerir, modelar, revisar y entregar. El paquete para junta es una salida del sistema, no un artefacto aislado armado al final.",
  },
  {
    q: "Can advisors or CPA firms run this for multiple clients?",
    qEs: "¿Pueden asesores o firmas CPA operarlo para multiples clientes?",
    a:
      "Yes. Advisor and white-label support remain in scope, but the public narrative now leads with the treasury-and-risk command center rather than consultant replacement alone.",
    aEs:
      "Si. El soporte para asesores y white-label sigue dentro del alcance, pero la narrativa publica ahora lidera con el centro de mando de tesoreria y riesgo en vez de solo reemplazo de consultor.",
  },
];

function getVideoEmbedUrl(url: string) {
  if (!url) {
    return "";
  }

  if (url.includes("youtube.com/watch?v=")) {
    const videoId = new URL(url).searchParams.get("v");
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }

  if (url.includes("youtu.be/")) {
    const videoId = url.split("youtu.be/")[1]?.split(/[?&]/)[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }

  if (url.includes("vimeo.com/")) {
    const videoId = url.split("vimeo.com/")[1]?.split(/[?&/]/)[0];
    return videoId ? `https://player.vimeo.com/video/${videoId}` : url;
  }

  if (url.includes("loom.com/share/")) {
    const videoId = url.split("loom.com/share/")[1]?.split(/[?&]/)[0];
    return videoId ? `https://www.loom.com/embed/${videoId}` : url;
  }

  return url;
}

function isDirectVideoFile(url: string) {
  return /\.(mp4|webm|ogg|webp)(\?.*)?$/i.test(url);
}

function isHtmlPage(url: string) {
  return /\.html?(\?.*)?$/i.test(url) || /\/demo-video\/?(\?.*)?$/i.test(url);
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="cerniq-section-label">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl text-[var(--dashboard-text-primary)] sm:text-4xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-sm leading-7 text-[var(--dashboard-text-secondary)] sm:text-base">
          {body}
        </p>
      ) : null}
    </div>
  );
}

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [totalAssets, setTotalAssets] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<CheckoutTier | null>(null);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [lang, setLang] = useState<"en" | "es">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("cerniq_lang") as "en" | "es") || "en";
    }
    return "en";
  });

  const router = useRouter();
  const acquisition = getAcquisitionCopy(lang);
  const embedUrl = getVideoEmbedUrl(DEMO_VIDEO_URL);
  const hasVideo = Boolean(DEMO_VIDEO_URL);

  const t = (en: string, es: string) => (lang === "en" ? en : es);
  const pulseHooks = lang === "en" ? pulseHooksEN : pulseHooksES;
  const institutionOptions =
    lang === "en" ? institutionOptionsEN : institutionOptionsES;
  const assetRanges = lang === "en" ? assetRangesEN : assetRangesES;

  const getPublicEntryHref = (href: string) =>
    PUBLIC_GATED_MODULE_PATHS.has(href)
      ? buildLoginUrlForReturnUrl(href)
      : href;

  useEffect(() => {
    localStorage.setItem("cerniq_lang", lang);
  }, [lang]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPulseIndex((current) => (current + 1) % pulseHooks.length);
    }, 4200);
    return () => clearInterval(interval);
  }, [pulseHooks.length]);

  const getSubmitErrorMessage = (error: unknown): string => {
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: unknown }).response === "object" &&
      (error as { response?: { data?: unknown } }).response?.data &&
      typeof (error as { response?: { data?: { message?: unknown } } }).response
        ?.data?.message === "string"
    ) {
      const message = (error as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      if (message) {
        return message;
      }
    }

    return t(
      "Failed to submit. Please try again.",
      "No se pudo enviar. Intente de nuevo.",
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (honeypot) return;

    setSubmitError("");
    setLoading(true);

    try {
      await apiClient.submitDemoRequest({
        email,
        name,
        institutionName,
        institutionType,
        totalAssets,
      });
      analytics.track(EVENTS.LEAD_FORM_SUBMITTED, {
        institutionType,
        totalAssets,
        source: "landing_page_pilot_intake",
      });
      setSubmitted(true);
    } catch (error: unknown) {
      setSubmitError(getSubmitErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  async function handleCheckout(tier: CheckoutTier) {
    if (tier === "one_time") {
      router.push("/get-started");
      return;
    }

    analytics.track(EVENTS.CHECKOUT_STARTED, {
      tier,
      source: "landing_page",
    });
    setCheckoutTier(tier);

    try {
      const checkoutUrl = await createCheckoutSession({
        tier,
        successUrl: buildLoginUrlForReturnUrl("/portal?welcome=1", {
          billingSuccess: true,
          forceMagicLink: true,
        }),
        cancelUrl: "/pricing",
      });
      window.location.href = checkoutUrl;
    } catch {
      window.location.href = "/#pricing";
    } finally {
      setCheckoutTier(null);
    }
  }

  return (
    <div className="cerniq-dashboard-page min-h-screen overflow-x-clip text-[var(--dashboard-text-primary)]">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <nav
          aria-label="Main navigation"
          className="sticky top-3 z-30 mb-6 flex items-center justify-between gap-4 rounded-full border border-[rgba(216,192,139,0.76)] bg-[rgba(255,251,239,0.88)] px-4 py-3 shadow-[0_16px_40px_rgba(113,88,40,0.08)] backdrop-blur-xl sm:px-6"
        >
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-3 text-left"
            aria-label="CERNIQ home"
          >
            <CerniqMark size="sm" />
            <div>
              <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">
                Cerniq
              </div>
              <div className="text-[10px] uppercase tracking-[0.32em] text-cyan-700/70">
                Treasury and Risk OS
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center rounded-full border border-slate-200 text-xs">
              <button
                onClick={() => setLang("en")}
                className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${
                  lang === "en"
                    ? "bg-cyan-700 text-white"
                    : "text-slate-500 hover:text-slate-950"
                }`}
                aria-label="Switch to English"
                aria-pressed={lang === "en"}
              >
                EN
              </button>
              <button
                onClick={() => setLang("es")}
                className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${
                  lang === "es"
                    ? "bg-cyan-700 text-white"
                    : "text-slate-500 hover:text-slate-950"
                }`}
                aria-label="Cambiar a Espanol"
                aria-pressed={lang === "es"}
              >
                ES
              </button>
            </div>
            <button
              onClick={() =>
                router.push(
                  buildLoginUrlForReturnUrl("/dashboard", {
                    forceMagicLink: true,
                  }),
                )
              }
              className="hidden rounded-full border border-[rgba(216,192,139,0.72)] px-4 py-2 text-sm text-[var(--dashboard-text-secondary)] transition hover:border-cyan-300/50 hover:text-[var(--dashboard-text-primary)] md:inline-flex"
            >
              {t("Open workspace", "Abrir workspace")}
            </button>
            <button
              onClick={() => router.push(PUBLIC_PATHS.compliance)}
              className="hidden rounded-full border border-[rgba(216,192,139,0.72)] px-4 py-2 text-sm text-[var(--dashboard-text-secondary)] transition hover:border-cyan-300/50 hover:text-[var(--dashboard-text-primary)] sm:inline-flex"
            >
              {t("Compliance", "Cumplimiento")}
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("pricing")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="hidden rounded-full border border-[rgba(216,192,139,0.72)] px-4 py-2 text-sm text-[var(--dashboard-text-secondary)] transition hover:border-cyan-300/50 hover:text-[var(--dashboard-text-primary)] sm:inline-flex"
            >
              {t("Pricing", "Precios")}
            </button>
            <button
              onClick={() => router.push("/login")}
              className="rounded-full border border-[rgba(216,192,139,0.72)] px-4 py-2 text-sm text-[var(--dashboard-text-secondary)] transition hover:border-cyan-300/50 hover:text-[var(--dashboard-text-primary)]"
            >
              {t("Sign In", "Iniciar sesion")}
            </button>
            <button
              onClick={() => router.push("/get-started")}
              className="cerniq-button-primary"
            >
              {acquisition.primaryCta}
            </button>
          </div>
        </nav>

        <main className="space-y-6 pb-16">
          <section className="-mx-4 overflow-hidden rounded-b-[2.75rem] border-b border-[rgba(216,192,139,0.72)] sm:-mx-6 lg:-mx-8">
            <div className="relative isolate min-h-[calc(100svh-7rem)] overflow-hidden bg-[linear-gradient(180deg,rgba(255,248,235,0.98)_0%,rgba(254,241,215,0.97)_44%,rgba(249,236,208,0.98)_100%)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(216,192,139,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(216,192,139,0.14)_1px,transparent_1px)] bg-[size:9rem_9rem] opacity-40" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(255,251,239,0.96),transparent_24rem),radial-gradient(circle_at_82%_18%,rgba(27,58,107,0.1),transparent_24rem),radial-gradient(circle_at_72%_76%,rgba(211,154,43,0.12),transparent_20rem)]" />
              <div className="absolute right-[-5rem] top-12 h-72 w-72 rounded-full border border-white/40 bg-white/20 blur-3xl" />
              <div className="absolute left-[-4rem] bottom-[-6rem] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(247,228,188,0.7),rgba(247,228,188,0))]" />

              <div className="relative z-10 mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:min-h-[calc(100svh-7rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:items-center lg:px-8 lg:py-14">
                <div className="max-w-4xl animate-fade-in">
                  <span className="cerniq-kicker w-fit">
                    {t(
                      "Institutional treasury, risk, and portfolio intelligence",
                      "Inteligencia institucional de tesoreria, riesgo y portafolio",
                    )}
                  </span>
                  <div className="mt-6">
                    <CerniqLockup
                      tagline={t(
                        "Treasury and Risk Operating System",
                        "Sistema operativo de tesoreria y riesgo",
                      )}
                    />
                  </div>
                  <h1 className="mt-8 max-w-5xl font-display text-[clamp(2.7rem,6vw,5.3rem)] leading-[0.92] tracking-[-0.05em] text-[var(--dashboard-text-primary)]">
                    {t(
                      "Turn the quarterly ALM scramble into an institutional command center.",
                      "Convierta la carrera trimestral de ALM en un centro de mando institucional.",
                    )}
                  </h1>
                  <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--dashboard-text-secondary)] sm:text-lg">
                    {t(
                      "CERNIQ gives treasury, ALCO, and risk teams one operating layer for upload-to-report delivery, rate posture, liquidity coverage, and board-ready output.",
                      "CERNIQ le da a tesoreria, ALCO, riesgo e inversiones una sola capa operativa para entrega de reportes, postura de tasas, visibilidad de portafolio, revision de ejecucion y salidas listas para junta.",
                    )}
                  </p>

                  <div className="mt-5 h-6">
                    <p className="text-sm font-semibold text-[#8c6b31] transition-opacity duration-300">
                      {pulseHooks[pulseIndex]}
                    </p>
                  </div>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={() => router.push("/get-started")}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1B3A6B] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(27,58,107,0.24)] transition hover:-translate-y-0.5 hover:bg-[#163258]"
                    >
                      {acquisition.primaryCta}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => router.push("/demo")}
                      className="cerniq-button-secondary"
                    >
                      {acquisition.proofCta}
                    </button>
                  </div>

                  <div className="mt-8 flex flex-wrap gap-3 text-sm">
                    {heroMetrics.map((metric) => (
                      <span key={metric.value} className="cerniq-mini-stat">
                        <strong>{metric.value}</strong>
                        {lang === "en" ? metric.label : metric.labelEs}
                      </span>
                    ))}
                  </div>
                </div>

                <aside className="cerniq-shell p-6 sm:p-8">
                  <div className="cerniq-data-wave" />
                  <div className="relative z-10 space-y-5">
                    <div>
                      <p className="cerniq-section-label">
                        {t("Command surface", "Superficie de mando")}
                      </p>
                      <h2 className="mt-3 font-display text-3xl text-slate-950">
                        {t(
                          "Four connected finance surfaces.",
                          "Cuatro superficies financieras conectadas.",
                        )}
                      </h2>
                    </div>

                    <div className="space-y-3">
                      {platformPillars.map((pillar) => {
                        const Icon = pillar.icon;
                        return (
                          <button
                            key={pillar.href}
                            onClick={() => router.push(getPublicEntryHref(pillar.href))}
                            className="w-full rounded-[1.4rem] border border-[rgba(216,192,139,0.72)] bg-[rgba(255,251,239,0.88)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#1B3A6B]/30 hover:bg-white"
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50">
                                <Icon className="h-5 w-5 text-cyan-700" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-display text-lg text-slate-950">
                                  {lang === "en" ? pillar.title : pillar.titleEs}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-slate-600">
                                  {lang === "en" ? pillar.body : pillar.bodyEs}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-[1.5rem] border border-[rgba(216,192,139,0.72)] bg-[rgba(247,228,188,0.5)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[#7b6338]">
                        {t("Why now", "Por que ahora")}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-slate-700">
                        {t(
                          "The product still starts with CFO-grade reporting, but the relaunch makes portfolio, execution, and market context visible enough to support real institutional operating rhythms.",
                          "El producto sigue empezando con reportes de grado CFO, pero el relanzamiento hace visible portafolio, ejecucion y mercado para soportar ritmos operativos institucionales reales.",
                        )}
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <div className="cerniq-panel p-6 sm:p-8">
              <SectionHeading
                eyebrow={t("Platform scope", "Alcance de la plataforma")}
                title={t(
                  "One institutional system. Multiple working surfaces.",
                  "Un sistema institucional. Multiples superficies de trabajo.",
                )}
                body={t(
                  "CERNIQ stays focused on the upload-to-report and board-output workflow, then extends outward into the surfaces finance teams actually need around it.",
                  "CERNIQ se mantiene enfocado en el flujo de carga a informe y salida para junta, y luego se extiende hacia las superficies que los equipos financieros realmente necesitan alrededor.",
                )}
              />

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {audienceTracks.map((track) => (
                  <div key={track.title} className="cerniq-panel-soft rounded-[1.4rem] border border-[rgba(216,192,139,0.62)] p-4">
                    <p className="font-display text-xl text-slate-950">
                      {lang === "en" ? track.title : track.titleEs}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {lang === "en" ? track.body : track.bodyEs}
                    </p>
                  </div>
                ))}
                <a
                  href={PUBLIC_PATHS.compliance}
                  className="cerniq-panel-soft block rounded-[1.4rem] border border-[rgba(216,192,139,0.62)] p-4 transition hover:border-cyan-300/50 hover:bg-white"
                >
                  <p className="font-display text-xl text-slate-950">
                    {t("Board and compliance outputs", "Salidas para junta y cumplimiento")}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {t(
                      `${PUBLIC_COMPLIANCE_MATRIX.length} mapped compliance requirements remain visible as institutional proof, not the whole public identity.`,
                      `${PUBLIC_COMPLIANCE_MATRIX.length} requisitos mapeados siguen visibles como prueba institucional, no como toda la identidad publica.`,
                    )}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700">
                    {t("View compliance matrix", "Ver matriz de cumplimiento")}
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </a>
              </div>
            </div>

            <div className="space-y-4">
              <div className="cerniq-panel p-6">
                <p className="cerniq-section-label">
                  {t("Live entry points", "Puntos de entrada")}
                </p>
                <div className="mt-4 space-y-3">
                  {operatingLinks.map((link) => (
                    <button
                      key={link.href}
                      onClick={() => router.push(getPublicEntryHref(link.href))}
                      className="flex w-full items-center justify-between rounded-[1.2rem] border border-[rgba(216,192,139,0.68)] bg-[rgba(255,251,239,0.92)] px-4 py-3 text-left transition hover:border-cyan-300/50 hover:bg-white"
                    >
                      <span className="font-semibold text-slate-950">
                        {lang === "en" ? link.label : link.labelEs}
                      </span>
                      <ChevronRight className="h-4 w-4 text-cyan-700" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="cerniq-panel p-6">
                <p className="cerniq-section-label">
                  {t("Institutional proof", "Prueba institucional")}
                </p>
                <div className="mt-4 space-y-4">
                  <div className="cerniq-stat-line text-sm leading-7">
                    {t(
                      "Primary workflow stays CFO-first: upload, analyze, and ship committee-ready output.",
                      "El flujo primario sigue siendo CFO-first: cargar, analizar y entregar salidas listas para comite.",
                    )}
                  </div>
                  <div className="cerniq-stat-line text-sm leading-7">
                    {t(
                      "Portfolio, market, and execution surfaces make the platform feel operational instead of one-off.",
                      "Portafolio, mercado y ejecucion hacen que la plataforma se sienta operativa en vez de aislada.",
                    )}
                  </div>
                  <div className="cerniq-stat-line text-sm leading-7">
                    {t(
                      "Advisor and white-label support remain available without taking over the public narrative.",
                      "El soporte para asesores y white-label sigue disponible sin dominar la narrativa publica.",
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="cerniq-panel p-6 sm:p-8">
            <SectionHeading
              eyebrow={t("Operating workflow", "Flujo operativo")}
              title={t(
                "Ingest, model, and deliver from one finance operating layer.",
                "Ingerir, modelar y entregar desde una sola capa operativa financiera.",
              )}
              body={t(
                "The relaunch is not a product split. It is the same platform, tightened into a clearer institutional sequence for treasury, risk, and adjacent investment teams.",
                "El relanzamiento no es una division de producto. Es la misma plataforma, ajustada en una secuencia institucional mas clara para tesoreria, riesgo y equipos de inversion adyacentes.",
              )}
            />

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {workflowSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.label}
                    className="rounded-[1.5rem] border border-[rgba(216,192,139,0.68)] bg-[rgba(255,251,239,0.9)] p-5"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50">
                      <Icon className="h-5 w-5 text-cyan-700" />
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-[#7b6338]">
                      {lang === "en" ? step.label : step.labelEs}
                    </p>
                    <h3 className="mt-2 font-display text-2xl text-slate-950">
                      {lang === "en" ? step.title : step.titleEs}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {lang === "en" ? step.body : step.bodyEs}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="cerniq-panel p-6 sm:p-8">
              <SectionHeading
                eyebrow={t("What teams see", "Lo que ven los equipos")}
                title={t(
                  "Markets-style discipline without abandoning the CFO workflow.",
                  "Disciplina tipo mercados sin abandonar el flujo del CFO.",
                )}
              />
              <div className="mt-6 space-y-4">
                <div className="rounded-[1.4rem] border border-[rgba(216,192,139,0.64)] bg-[rgba(255,251,239,0.9)] p-4">
                  <div className="flex items-start gap-4">
                    <ShieldCheck className="mt-1 h-5 w-5 text-cyan-700" />
                    <div>
                      <p className="font-semibold text-slate-950">
                        {t("ALM and regulatory posture", "Postura ALM y regulatoria")}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-600">
                        {t(
                          "Keep board and regulator-facing output as the primary promise, but frame it as one surface inside a wider finance operating system.",
                          "Mantenga la salida para junta y regulador como promesa primaria, pero enmarquela como una superficie dentro de un sistema financiero mas amplio.",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-[1.4rem] border border-[rgba(216,192,139,0.64)] bg-[rgba(255,251,239,0.9)] p-4">
                  <div className="flex items-start gap-4">
                    <LineChart className="mt-1 h-5 w-5 text-cyan-700" />
                    <div>
                      <p className="font-semibold text-slate-950">
                        {t("Mandates and positions", "Mandatos y posiciones")}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-600">
                        {t(
                          "Expose the existing portfolio surface as institutional evidence that treasury and investment conversations share the same operating picture.",
                          "Exponga la superficie de portafolio existente como evidencia institucional de que tesoreria e inversiones comparten la misma vista operativa.",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-[1.4rem] border border-[rgba(216,192,139,0.64)] bg-[rgba(255,251,239,0.9)] p-4">
                  <div className="flex items-start gap-4">
                    <Target className="mt-1 h-5 w-5 text-cyan-700" />
                    <div>
                      <p className="font-semibold text-slate-950">
                        {t("Execution and market context", "Ejecucion y contexto de mercado")}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-600">
                        {t(
                          "Execution-quality and market/rate surfaces stay secondary in the story, but visible enough to make CERNIQ feel like a serious institutional stack.",
                          "Las superficies de calidad de ejecucion y mercado/tasas siguen secundarias en la historia, pero visibles para que CERNIQ se sienta como una pila institucional seria.",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="cerniq-panel p-6 sm:p-8">
              <SectionHeading
                eyebrow={t("Workflow proof", "Prueba del flujo")}
                title={t(
                  "A platform narrative that stays close to live routes.",
                  "Una narrativa de plataforma que se mantiene cerca de rutas reales.",
                )}
              />

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: "/dashboard",
                    title: t("Command center", "Centro de mando"),
                    body: t(
                      "CFO-first workspace shell for routing into reporting and adjacent finance surfaces.",
                      "Shell CFO-first para enrutar a reportes y superficies financieras adyacentes.",
                    ),
                  },
                  {
                    label: "/alm",
                    title: t("ALM and board outputs", "ALM y salidas para junta"),
                    body: t(
                      "The core reporting and institutional risk workflow remains the anchor.",
                      "El flujo principal de reporte y riesgo institucional sigue siendo el ancla.",
                    ),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[1.35rem] border border-[rgba(216,192,139,0.64)] bg-[rgba(255,251,239,0.92)] p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7b6338]">
                      {item.label}
                    </p>
                    <p className="mt-3 font-display text-xl text-slate-950">
                      {item.title}
                    </p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="cerniq-panel p-6 sm:p-8">
            <SectionHeading
              eyebrow={t("Walkthrough", "Demostracion")}
              title={t(
                "Show the platform as an operating system, not a one-off report generator.",
                "Muestre la plataforma como sistema operativo, no como generador aislado de informes.",
              )}
              body={t(
                "Use the walkthrough to prove the command-center narrative: workspace entry, upload flow, analysis sequence, and delivery of the board-ready report.",
                "Use la demostración para probar la narrativa de centro de mando: entrada al workspace, carga, secuencia de análisis y entrega del informe listo para junta.",
              )}
            />

            <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-[rgba(216,192,139,0.72)] bg-white">
              {hasVideo ? (
                <div className="w-full bg-slate-100" style={{ aspectRatio: "16/9" }}>
                  {isDirectVideoFile(DEMO_VIDEO_URL) ? (
                    <video
                      className="h-full w-full"
                      controls
                      preload="metadata"
                      playsInline
                      src={DEMO_VIDEO_URL}
                    />
                  ) : isHtmlPage(DEMO_VIDEO_URL) ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#ffffff_0%,#f4fbff_100%)] px-6 text-center">
                      <div className="rounded-full border border-cyan-200 bg-cyan-50 p-4">
                        <PlayCircle className="h-9 w-9 text-cyan-700" />
                      </div>
                      <p className="font-display text-2xl text-slate-950">
                        {t(
                          "Open the institutional walkthrough",
                          "Abra la demostracion institucional",
                        )}
                      </p>
                      <p className="max-w-2xl text-base leading-7 text-slate-600">
                        {t(
                          "This walkthrough is published as a standalone page, so CERNIQ opens it directly instead of embedding it inside the command-center homepage.",
                          "Esta demostracion se publica como pagina independiente, por lo que CERNIQ la abre directamente en vez de incrustarla dentro de la pagina principal.",
                        )}
                      </p>
                      <a
                        href={DEMO_VIDEO_URL}
                        className="inline-flex items-center gap-2 rounded-full bg-[#1B3A6B] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#163258]"
                      >
                        {t("Open walkthrough", "Abrir demostracion")}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                  ) : (
                    <iframe
                      className="h-full w-full"
                      src={embedUrl}
                      title="CERNIQ institutional walkthrough"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  )}
                </div>
              ) : (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#ffffff_0%,#f4fbff_100%)] px-6 text-center">
                  <div className="rounded-full border border-cyan-200 bg-cyan-50 p-4">
                    <PlayCircle className="h-9 w-9 text-cyan-700" />
                  </div>
                  <p className="font-display text-2xl text-slate-950">
                    {t(
                      "Institutional walkthrough video coming soon",
                      "Video institucional de demostracion proximamente",
                    )}
                  </p>
                  <p className="max-w-2xl text-base leading-7 text-slate-600">
                    {t(
                      "Full platform walkthrough coming soon. Contact us for a live demo.",
                      "Demostracion completa de la plataforma proximamente. Contactenos para una demo en vivo.",
                    )}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section id="pricing" className="cerniq-shell p-4 sm:p-6">
            <div className="mx-auto max-w-5xl">
              <SectionHeading
                eyebrow={t("Commercial path", "Ruta comercial")}
                title={t(
                  "Pilot first. Recurring access when the operating rhythm is trusted.",
                  "Primero piloto. Acceso recurrente cuando el ritmo operativo ya este validado.",
                )}
                body={t(
                  "The relaunch changes the narrative, not the commercial spine: validate on a live workflow, then move into recurring institutional use.",
                  "El relanzamiento cambia la narrativa, no la columna comercial: valide con un flujo real y luego pase a uso institucional recurrente.",
                )}
              />

              <div className="mt-8 grid gap-5 lg:grid-cols-3">
                <div className="cerniq-panel flex flex-col p-5">
                  <p className="font-display text-xl text-slate-950">
                    {t("Pilot report", "Informe piloto")}
                  </p>
                  <div className="mt-4">
                    <span className="font-display text-4xl text-slate-950">
                      {PRICING.SETUP.label}
                    </span>
                    <span className="ml-1 text-sm text-slate-500">
                      {t("one-time", "unico")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t(
                      "Use one real reporting cycle to validate board output, rate posture, and workflow quality.",
                      "Use un ciclo real de reporte para validar salida para junta, postura de tasas y calidad del flujo.",
                    )}
                  </p>
                  <div className="mt-5 flex-1 space-y-3">
                    {PRICING.SETUP.bullets.map((bullet) => (
                      <div key={bullet.en} className="flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-700" />
                        {t(bullet.en, bullet.es)}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => handleCheckout("one_time")}
                    disabled={checkoutTier === "one_time"}
                    className="mt-6 w-full cerniq-button-secondary disabled:opacity-60"
                  >
                    {checkoutTier === "one_time"
                      ? t("Processing...", "Procesando...")
                      : getCtaLabel("one_time", lang)}
                  </button>
                </div>

                <div className="cerniq-panel flex flex-col border-cyan-300/25 p-5 shadow-[0_20px_60px_rgba(27,58,107,0.14)]">
                  <span className="mb-3 w-fit rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] uppercase tracking-[0.26em] text-cyan-700">
                    {t("Recommended", "Recomendado")}
                  </span>
                  <p className="font-display text-xl text-slate-950">
                    {t("Recurring access", "Acceso recurrente")}
                  </p>
                  <div className="mt-4">
                    <span className="font-display text-4xl text-slate-950">
                      {PRICING.PILOT.label}
                    </span>
                    <span className="ml-1 text-sm text-slate-500">
                      {t(PRICING.PILOT.cadence, PRICING.PILOT.cadenceEs)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t(
                      "Activate the institutional command surface for recurring reporting, review, and operating visibility.",
                      "Active la superficie institucional para reportes recurrentes, revision y visibilidad operativa.",
                    )}
                  </p>
                  <div className="mt-5 flex-1 space-y-3">
                    {PRICING.PILOT.bullets.map((bullet) => (
                      <div key={bullet.en} className="flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-700" />
                        {t(bullet.en, bullet.es)}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => handleCheckout("monthly")}
                    disabled={checkoutTier === "monthly"}
                    className="mt-6 w-full cerniq-button-primary disabled:opacity-60"
                  >
                    {checkoutTier === "monthly"
                      ? t("Processing...", "Procesando...")
                      : getCtaLabel("monthly", lang)}
                  </button>
                </div>

                <div className="cerniq-panel flex flex-col p-5">
                  <p className="font-display text-xl text-slate-950">
                    {t("Annual access", "Acceso anual")}
                  </p>
                  <div className="mt-4">
                    <span className="font-display text-4xl text-slate-950">
                      {PRICING.STANDARD.label}
                    </span>
                    <span className="ml-1 text-sm text-slate-500">
                      {t(PRICING.STANDARD.cadence, PRICING.STANDARD.cadenceEs)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {t(
                      "For teams that want the full operating cadence across reporting, investment visibility, and stakeholder delivery.",
                      "Para equipos que quieren la cadencia operativa completa a traves de reportes, visibilidad de inversiones y entrega a stakeholders.",
                    )}
                  </p>
                  <div className="mt-5 flex-1 space-y-3">
                    {PRICING.STANDARD.bullets.map((bullet) => (
                      <div key={bullet.en} className="flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-700" />
                        {t(bullet.en, bullet.es)}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => handleCheckout("annual")}
                    disabled={checkoutTier === "annual"}
                    className="mt-6 w-full cerniq-button-secondary disabled:opacity-60"
                  >
                    {checkoutTier === "annual"
                      ? t("Processing...", "Procesando...")
                      : getCtaLabel("annual", lang)}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="cerniq-panel p-6 sm:p-8">
            <SectionHeading
              eyebrow="FAQ"
              title={t("Institutional positioning FAQ", "FAQ de posicionamiento institucional")}
            />

            <div className="mt-6 space-y-3">
              {institutionalFaqs.map((faq) => (
                <details
                  key={faq.q}
                  className="group rounded-2xl border border-[rgba(216,192,139,0.68)] bg-[rgba(255,251,239,0.92)]"
                >
                  <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-950 sm:text-base [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center justify-between gap-4">
                      <span>{lang === "en" ? faq.q : faq.qEs}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                    </div>
                  </summary>
                  <div className="border-t border-[rgba(216,192,139,0.58)] px-5 py-4">
                    <p className="text-sm leading-7 text-slate-700">
                      {lang === "en" ? faq.a : faq.aEs}
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section id="pilot-intake" className="cerniq-panel p-6 sm:p-8">
            <SectionHeading
              eyebrow={t("Pilot intake", "Ingreso al piloto")}
              title={t(
                "Tell us how your treasury and risk workflow runs today.",
                "Cuentenos como corre hoy su flujo de tesoreria y riesgo.",
              )}
              body={t(
                "Use the intake form to route your team into the pilot path. CERNIQ will keep the next step focused on real institution context instead of a generic demo handoff.",
                "Use el formulario para enrutar a su equipo al camino de piloto. CERNIQ mantendra el siguiente paso enfocado en contexto institucional real, no en una demo generica.",
              )}
            />

            <div className="mt-8">
              {submitted ? (
                <div className="rounded-[1.5rem] border border-emerald-300 bg-emerald-50 p-6 text-emerald-800">
                  <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                  <h3 className="mt-4 font-display text-2xl">
                    {t(
                      "Institution profile captured",
                      "Perfil institucional capturado",
                    )}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-emerald-700">
                    {t(
                      "We captured the operating context for your team and will use it to shape the next step of the pilot.",
                      "Capturamos el contexto operativo de su equipo y lo usaremos para dar forma al siguiente paso del piloto.",
                    )}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    className="hidden"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                    aria-hidden="true"
                  />

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-800">
                        {t("Name", "Nombre")}
                      </label>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="cerniq-field"
                        placeholder={t("Your name", "Su nombre")}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-800">
                        {t("Work email", "Correo laboral")}
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="cerniq-field"
                        placeholder="name@institution.com"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-800">
                        {t("Institution", "Institucion")}
                      </label>
                      <input
                        value={institutionName}
                        onChange={(event) => setInstitutionName(event.target.value)}
                        className="cerniq-field"
                        placeholder={t("Institution name", "Nombre de institucion")}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-800">
                        {t("Institution type", "Tipo de institucion")}
                      </label>
                      <select
                        value={institutionType}
                        onChange={(event) => setInstitutionType(event.target.value)}
                        className="cerniq-field cerniq-select"
                        required
                      >
                        {institutionOptions.map((option) => (
                          <option key={option.value || "placeholder"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="lg:col-span-2">
                      <label className="mb-2 block text-sm font-semibold text-slate-800">
                        {t("Asset range", "Rango de activos")}
                      </label>
                      <select
                        value={totalAssets}
                        onChange={(event) => setTotalAssets(event.target.value)}
                        className="cerniq-field cerniq-select"
                        required
                      >
                        {assetRanges.map((option) => (
                          <option key={option.value || "placeholder"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {submitError ? (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {submitError}
                    </p>
                  ) : null}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="submit"
                      disabled={loading}
                      className="cerniq-button-primary disabled:opacity-60"
                    >
                      {loading
                        ? t("Submitting...", "Enviando...")
                        : acquisition.pilotFormSubmit}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/demo")}
                      className="cerniq-button-secondary"
                    >
                      {acquisition.proofCta}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </main>
      </div>

      <Footer t={t} />
    </div>
  );
}
