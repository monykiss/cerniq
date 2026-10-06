"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { createCheckoutSession } from "@/lib/billing";
import { analytics, EVENTS } from "@/lib/analytics";
import { CerniqMark } from "@/components/brand/CerniqLogo";
import { PRICING, PRICING_TIERS, formatTierPrice, getCtaLabel } from "@/lib/pricing";
import { getAcquisitionCopy } from "@/lib/acquisition-copy";
import { PUBLIC_PATHS } from "@/lib/public-links";
import { buildLoginUrlForReturnUrl } from "@/lib/auth-redirect";

export default function PricingPage() {
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "es">(() => {
    if (typeof window !== "undefined")
      return (localStorage.getItem("cerniq_lang") as "en" | "es") || "en";
    return "en";
  });

  const t = (en: string, es: string) => (lang === "en" ? en : es);
  const acquisition = getAcquisitionCopy(lang);
  const pilotEntryPrice = formatTierPrice(PRICING.SETUP, lang);
  const recurringPrice = formatTierPrice(PRICING.PILOT, lang);

  const costComparison =
    lang === "en"
      ? [
          {
            item: "Pilot entry workflow",
            consultant: "$8,000 - $12,000",
            cerniq: pilotEntryPrice,
          },
          {
            item: "Recurring command-center access",
            consultant: "$32,000 - $48,000 / year",
            cerniq: recurringPrice,
          },
          {
            item: "Board-output turnaround",
            consultant: "3-6 weeks",
            cerniq: "24 hours",
          },
          {
            item: "Portfolio + execution visibility",
            consultant: "Separate tools",
            cerniq: "Built in",
          },
          {
            item: "Bilingual board output",
            consultant: "Extra charge",
            cerniq: "Included",
          },
        ]
      : [
          {
            item: "Flujo de entrada al piloto",
            consultant: "$8,000 - $12,000",
            cerniq: pilotEntryPrice,
          },
          {
            item: "Acceso recurrente al centro de mando",
            consultant: "$32,000 - $48,000 / año",
            cerniq: recurringPrice,
          },
          {
            item: "Tiempo de salida para junta",
            consultant: "3-6 semanas",
            cerniq: "24 horas",
          },
          {
            item: "Visibilidad de portafolio y ejecucion",
            consultant: "Herramientas separadas",
            cerniq: "Integrado",
          },
          {
            item: "Salida bilingue para junta",
            consultant: "Cargo adicional",
            cerniq: "Incluido",
          },
        ];

  // Pricing tiers from single source of truth (lib/pricing.ts)
  const tiers = PRICING_TIERS.map((tier) => ({
    id: tier.id,
    name: t(tier.description, tier.descriptionEs),
    price: t(tier.label, tier.labelEs),
    cadence: t(tier.cadence, tier.cadenceEs),
    featured: tier.featured,
    bullets: tier.bullets.map((b) => t(b.en, b.es)),
  }));

  const faqItems = [
    {
      question: t("Why start with a pilot?", "¿Por que empezar con un piloto?"),
      answer: t(
        "A pilot report lets you validate the real operating workflow with institution data before committing to recurring access. It proves the reporting layer first, then gives your team a clean path into the broader treasury-and-risk surface.",
        "Un informe piloto permite validar el flujo operativo real con datos institucionales antes de comprometerse a acceso recurrente. Primero prueba la capa de reportes y luego da un camino limpio hacia la superficie mas amplia de tesoreria y riesgo.",
      ),
    },
    {
      question: t("What's in each report?", "¿Que incluye cada informe?"),
      answer: t(
        "Each report delivers the board-ready reporting core: 14+ pages, key COSSEC/NCUA ratios, duration gap, NII sensitivity, liquidity coverage, stress scenarios, and bilingual recommendations. The recurring plans add the wider workflow around that core.",
        "Cada informe entrega el nucleo listo para junta: 14+ paginas, ratios clave COSSEC/NCUA, gap de duracion, sensibilidad NII, cobertura de liquidez, escenarios de estres y recomendaciones bilingues. Los planes recurrentes agregan el flujo mas amplio alrededor de ese nucleo.",
      ),
    },
    {
      question: t(
        "How does the subscription work?",
        "¿Como funciona la suscripcion?",
      ),
      answer: t(
        "The subscription is billed through Stripe and keeps the team inside the recurring CERNIQ operating layer: upload cycles, analysis workflow, report delivery, and adjacent visibility surfaces. Pilot and annual tiers change commercial scope, not product direction.",
        "La suscripcion se factura a traves de Stripe y mantiene al equipo dentro de la capa operativa recurrente de CERNIQ: ciclos de carga, flujo de analisis, entrega de informes y superficies adyacentes de visibilidad. Los tiers piloto y anual cambian el alcance comercial, no la direccion del producto.",
      ),
    },
  ];

  async function handleCheckout(tier: string) {
    if (tier === "one_time") {
      router.push(PUBLIC_PATHS.getStarted);
      return;
    }

    analytics.track(EVENTS.CHECKOUT_STARTED, { tier, source: "pricing_page" });
    setLoadingTier(tier);
    try {
      const checkoutUrl = await createCheckoutSession({
        tier: tier as "one_time" | "monthly" | "annual" | "partner",
        successUrl: buildLoginUrlForReturnUrl("/portal?welcome=1", {
          billingSuccess: true,
          forceMagicLink: true,
        }),
        cancelUrl: PUBLIC_PATHS.pricing,
      });
      window.location.href = checkoutUrl;
    } catch {
      window.location.href = PUBLIC_PATHS.pricing;
    } finally {
      setLoadingTier(null);
    }
  }

  return (
    <div className="min-h-screen overflow-x-clip text-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-3 rounded-full border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-slate-500 transition hover:text-slate-950"
              aria-label={t("Back to home", "Volver al inicio")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <CerniqMark size="sm" />
            <div>
              <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">
                Cerniq
              </div>
              <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">
                {t("Plans & Pricing", "Planes y precios")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={PUBLIC_PATHS.demo}
              className="hidden rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 sm:inline-flex"
            >
              {acquisition.proofCta}
            </Link>

            {/* Language toggle */}
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
          </div>
        </div>

        <main className="space-y-6 pb-20">
          {/* -- HERO -- */}
          <section className="cerniq-shell p-4 sm:p-6 lg:p-8">
            <div className="cerniq-panel p-6 sm:p-8 lg:p-10">
              <div className="cerniq-data-wave opacity-55" />
              <div className="relative z-10 mx-auto max-w-4xl">
                <span className="cerniq-kicker mb-8 w-fit">
                  {t("Plans & Pricing", "Planes y precios")}
                </span>
                <h1 className="font-display text-3xl leading-tight text-slate-950 sm:text-5xl">
                  {t(
                    "Start with the pilot. Expand into the institutional operating surface once the workflow is trusted.",
                    "Comience con el piloto. Expanda hacia la superficie operativa institucional una vez que el flujo este validado.",
                  )}
                </h1>
                <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
                  {t(
                    "CERNIQ pricing is built around one sequence: validate the reporting workflow on real data first, then move into recurring treasury, risk, and portfolio visibility once the team wants the full operating cadence.",
                    "El pricing de CERNIQ esta construido alrededor de una secuencia: valide primero el flujo de reportes con datos reales y luego pase a tesoreria, riesgo y visibilidad de portafolio recurrentes cuando el equipo quiera la cadencia operativa completa.",
                  )}
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href={PUBLIC_PATHS.getStarted} className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-600 hover:-translate-y-0.5">
                    {acquisition.primaryCta}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                  <Link href={PUBLIC_PATHS.demo} className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300 bg-cyan-50 px-6 py-3 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100">
                    {acquisition.proofCta}
                  </Link>
                  <Link href={PUBLIC_PATHS.contact} className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                    {acquisition.salesCta}
                  </Link>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <span className="cerniq-mini-stat">
                    <strong>{t("Pilot", "Piloto")}</strong>{" "}
                    {t("to validate the workflow", "para validar el flujo")}
                  </span>
                  <span className="cerniq-mini-stat">
                    <strong>{t("Recurring", "Recurrente")}</strong>{" "}
                    {t("for ongoing finance operations", "para operaciones financieras continuas")}
                  </span>
                  <span className="cerniq-mini-stat">
                    <strong>Partner</strong>{" "}
                    {t("for multi-client firms", "para firmas multi-cliente")}
                  </span>
                </div>
              </div>

              {/* Platform Depth Strip */}
              <div className="relative z-10 mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 mx-auto max-w-4xl">
                <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-cyan-800">
                    1
                  </p>
                  <p className="text-[10px] text-cyan-600 font-semibold uppercase">
                    {t("Command Surface", "Superficie de Mando")}
                  </p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-violet-800">
                    4
                  </p>
                  <p className="text-[10px] text-violet-600 font-semibold uppercase">
                    {t("Finance Lanes", "Carriles Financieros")}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-amber-800">
                    EN/ES
                  </p>
                  <p className="text-[10px] text-amber-600 font-semibold uppercase">
                    {t("Board Output", "Salida para Junta")}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-emerald-800">
                    $750
                  </p>
                  <p className="text-[10px] text-emerald-600 font-semibold uppercase">
                    {t("Pilot Entry", "Entrada al Piloto")}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* -- TIER CARDS -- */}
          <section
            className="grid gap-6 lg:grid-cols-4"
            aria-label={t("Pricing tiers", "Niveles de precios")}
          >
            {tiers.map((tier) => (
              <article
                key={tier.id}
                aria-label={tier.name}
                className={`cerniq-panel cerniq-card-hover flex flex-col p-6 ${tier.featured ? "border-cyan-300/25 shadow-[0_20px_60px_rgba(34,211,238,0.12)]" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-2xl text-slate-950">
                    {tier.name}
                  </p>
                  {tier.featured ? (
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] uppercase tracking-[0.26em] text-cyan-700">
                      {t("Recommended", "Recomendado")}
                    </span>
                  ) : null}
                </div>

                <div className="mt-8">
                  <span className="font-display text-5xl text-slate-950">
                    {tier.price}
                  </span>
                  <span className="ml-2 text-sm uppercase tracking-[0.24em] text-slate-500">
                    {tier.cadence}
                  </span>
                </div>

                <div className="mt-8 flex-1 space-y-4">
                  {tier.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="flex items-start gap-3 text-sm leading-7 text-slate-700"
                    >
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-700" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>

                {tier.id === "partner" ? (
                  <a
                    href={PUBLIC_PATHS.contact}
                    rel="noopener noreferrer"
                    className="mt-8 w-full cerniq-button-secondary text-center"
                  >
                    {getCtaLabel(tier.id, lang)}
                  </a>
                ) : (
                  <button
                    onClick={() => handleCheckout(tier.id)}
                    disabled={loadingTier === tier.id}
                    className={`mt-8 w-full ${tier.featured ? "inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-600 hover:-translate-y-0.5" : "inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-600 hover:-translate-y-0.5"} disabled:opacity-60`}
                  >
                    {loadingTier === tier.id
                      ? t("Processing...", "Procesando...")
                      : getCtaLabel(tier.id, lang)}
                  </button>
                )}
              </article>
            ))}
          </section>

          {/* -- ROI / COST COMPARISON -- */}
          <section className="cerniq-panel cerniq-card-hover p-6 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-4xl space-y-6">
              <div>
                <p className="cerniq-section-label">
                  {t("Cost Comparison", "Comparacion de costos")}
                </p>
                <h2 className="mt-4 font-display text-3xl text-slate-950 sm:text-4xl">
                  {t(
                    "Compare CERNIQ to the fragmented operating model you already know.",
                    "Compare CERNIQ con el modelo operativo fragmentado que ya conoce.",
                  )}
                </h2>
                <p className="mt-4 text-base leading-8 text-slate-700">
                  {t(
                    "The value is not only lower cost. It is a cleaner treasury-and-risk workflow with one system covering ingest, review, delivery, and ongoing institutional visibility.",
                    "El valor no es solo menor costo. Es un flujo mas limpio de tesoreria y riesgo con un sistema cubriendo ingestion, revision, entrega y visibilidad institucional continua.",
                  )}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th
                        scope="col"
                        className="py-3 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500"
                      />
                      <th
                        scope="col"
                        className="py-3 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        {t("Traditional Consultant", "Consultor tradicional")}
                      </th>
                      <th
                        scope="col"
                        className="py-3 text-xs font-semibold uppercase tracking-wider text-cyan-700"
                      >
                        CERNIQ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {costComparison.map((row) => (
                      <tr key={row.item} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-700">
                          {row.item}
                        </td>
                        <td className="py-3 pr-4 text-slate-500">
                          {row.consultant}
                        </td>
                        <td className="py-3 font-semibold text-cyan-700">
                          {row.cerniq}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">
                  {t("ESTIMATED SAVINGS: 83-93%", "AHORRO ESTIMADO: 83-93%")}
                </p>
              </div>
            </div>
          </section>


          {/* -- FAQ -- */}
          <section className="cerniq-panel cerniq-card-hover p-6 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="flex items-center gap-3">
                <HelpCircle className="h-5 w-5 text-cyan-700" />
                <p className="cerniq-section-label">FAQ</p>
              </div>

              <div className="space-y-3">
                {faqItems.map((item) => (
                  <details
                    key={item.question}
                    className="group rounded-2xl border border-slate-200 bg-white/86"
                  >
                    <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-950 sm:text-base [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center justify-between gap-4">
                        <span>{item.question}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                      </div>
                    </summary>
                    <div className="border-t border-slate-100 px-5 py-4">
                      <p className="text-sm leading-7 text-slate-700">
                        {item.answer}
                      </p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* -- BOTTOM CTA -- */}
          <section className="cerniq-panel cerniq-card-hover overflow-hidden px-6 py-8 sm:px-8 lg:px-10">
            <div className="cerniq-data-wave opacity-90" />
            <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="cerniq-section-label">CERNIQ</p>
                <h2 className="mt-4 font-display text-3xl text-slate-950 sm:text-4xl">
                  {t(
                    "One pilot-first path. One recurring upgrade when you are ready.",
                    "Un camino pilot-first. Una ruta de acceso recurrente cuando este listo.",
                  )}
                </h2>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={PUBLIC_PATHS.getStarted}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300 bg-cyan-50 px-6 py-3 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100"
                >
                  {acquisition.primaryCta}
                  <ChevronRight className="h-4 w-4" />
                </Link>
                <Link href={PUBLIC_PATHS.demo} className="cerniq-button-secondary">
                  {acquisition.proofCta}
                </Link>
                <Link href={PUBLIC_PATHS.contact} className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950">
                  {acquisition.salesCta}
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
