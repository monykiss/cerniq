'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  FileCheck,
  Files,
  ShieldCheck,
} from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import {
  getPublicComplianceCoverageCounts,
  PUBLIC_COMPLIANCE_FRAMEWORKS,
  PUBLIC_COMPLIANCE_MATRIX,
  type PublicComplianceFramework,
  type PublicComplianceRow,
  type PublicCoverageStatus,
} from '@/lib/public-compliance-matrix';
import { PUBLIC_PATHS } from '@/lib/public-links';

const COVERAGE_STYLES: Record<
  PublicCoverageStatus,
  { badge: string; label: { en: string; es: string } }
> = {
  supported: {
    badge:
      'border-emerald-200 bg-emerald-50 text-emerald-700',
    label: { en: 'Supported', es: 'Soportado' },
  },
  partial: {
    badge:
      'border-amber-200 bg-amber-50 text-amber-700',
    label: { en: 'Partial', es: 'Parcial' },
  },
  not_claimed: {
    badge:
      'border-slate-200 bg-slate-100 text-slate-500',
    label: { en: 'Not currently claimed', es: 'No reclamado actualmente' },
  },
};

function CoverageBadge({
  status,
  lang,
}: {
  status: PublicCoverageStatus;
  lang: 'en' | 'es';
}) {
  const config = COVERAGE_STYLES[status];

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${config.badge}`}
    >
      {config.label[lang]}
    </span>
  );
}

function CoverageRow({
  row,
  lang,
}: {
  row: PublicComplianceRow;
  lang: 'en' | 'es';
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            {row.id}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-slate-950">
            {row.requirement[lang]}
          </h3>
        </div>
        <Link
          href={row.module.href}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700 transition hover:text-cyan-900"
        >
          {row.module.label[lang]}
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">
        {row.buyerOutcome[lang]}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {PUBLIC_COMPLIANCE_FRAMEWORKS.map((framework) => (
          <div
            key={framework.key}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {framework.label[lang]}
            </p>
            <div className="mt-2">
              <CoverageBadge
                status={row.coverage[framework.key]}
                lang={lang}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {lang === 'en' ? 'Current claim basis' : 'Base actual del claim'}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {row.evidence[lang]}
        </p>
      </div>
    </article>
  );
}

export default function CompliancePage() {
  const [lang, setLang] = useState<'en' | 'es'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cerniq_lang') as 'en' | 'es') || 'en';
    }

    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('cerniq_lang', lang);
  }, [lang]);

  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_22%,#ffffff_100%)]">
      <nav className="border-b border-slate-200/90 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={PUBLIC_PATHS.home}
              className="text-slate-400 transition hover:text-slate-700"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <CerniqMark size="sm" />
            <div>
              <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">
                CERNIQ
              </div>
              <div className="text-[10px] uppercase tracking-[0.32em] text-cyan-700/70">
                {t('Public Compliance Matrix', 'Matriz Publica de Cumplimiento')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-full border border-slate-200 text-xs">
              <button
                onClick={() => setLang('en')}
                className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${
                  lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'
                }`}
                aria-label="Switch to English"
                aria-pressed={lang === 'en'}
              >
                EN
              </button>
              <button
                onClick={() => setLang('es')}
                className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${
                  lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'
                }`}
                aria-label="Cambiar a Espanol"
                aria-pressed={lang === 'es'}
              >
                ES
              </button>
            </div>
            <Link
              href={PUBLIC_PATHS.contact}
              className="hidden rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 sm:inline-flex"
            >
              {t('Contact sales', 'Contactar ventas')}
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-10 sm:py-14">
        <section className="rounded-[2rem] border border-slate-200 bg-white px-6 py-8 shadow-[0_18px_60px_rgba(15,23,42,0.06)] sm:px-8 sm:py-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">
                <FileCheck className="h-3.5 w-3.5" />
                {t(
                  'Buyer review artifact',
                  'Artefacto para revision de compra',
                )}
              </div>
              <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                {t(
                  'Public compliance matrix for COSSEC, NCUA, Basel IRRBB, and CECL.',
                  'Matriz publica de cumplimiento para COSSEC, NCUA, Basel IRRBB y CECL.',
                )}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700 sm:text-lg">
                {t(
                  'This page maps the current public CERNIQ scope already claimed in this repo across 20 buyer-facing requirements. It is designed for procurement review, security questionnaires, and examiner-prep conversations.',
                  'Esta pagina mapea el scope publico actual de CERNIQ ya reclamado en este repo a traves de 20 requisitos buyer-facing. Esta pensada para revision de procurement, cuestionarios de seguridad y conversaciones de preparacion para examinadores.',
                )}
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-600">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2">
                  {t(
                    `${PUBLIC_COMPLIANCE_MATRIX.length} mapped requirements`,
                    `${PUBLIC_COMPLIANCE_MATRIX.length} requisitos mapeados`,
                  )}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2">
                  {t(
                    `${PUBLIC_COMPLIANCE_FRAMEWORKS.length} frameworks in scope`,
                    `${PUBLIC_COMPLIANCE_FRAMEWORKS.length} marcos en scope`,
                  )}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2">
                  {t(
                    'Current public routes only',
                    'Solo rutas publicas actuales',
                  )}
                </span>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {t('How to read this page', 'Como leer esta pagina')}
              </p>
              <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
                <p>
                  {t(
                    'Supported means the current public product copy or module registry explicitly claims that workflow.',
                    'Soportado significa que la copia publica actual del producto o el registro de modulos reclama explicitamente ese flujo.',
                  )}
                </p>
                <p>
                  {t(
                    'Partial means the current public scope claims a narrower or adjacent workflow, but not a full end-to-end regulatory package.',
                    'Parcial significa que el scope publico actual reclama un flujo mas estrecho o adyacente, pero no un paquete regulatorio end-to-end completo.',
                  )}
                </p>
                <p>
                  {t(
                    'Not currently claimed means we are intentionally not representing direct public coverage today.',
                    'No reclamado actualmente significa que intencionalmente no estamos representando cobertura publica directa hoy.',
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {t('Scope and methodology', 'Scope y metodologia')}
            </p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
              <p>
                {t(
                  'The row set intentionally stays at the publicly promised 20 requirements already referenced on the homepage, changelog, and sales materials.',
                  'El set de filas se mantiene intencionalmente en los 20 requisitos publicamente prometidos que ya se referencian en la pagina principal, el changelog y materiales de ventas.',
                )}
              </p>
              <p>
                {t(
                  'Each requirement links to a live public CERNIQ route and records the claim basis used to justify the coverage label on this page.',
                  'Cada requisito enlaza a una ruta publica viva de CERNIQ y registra la base del claim usada para justificar la etiqueta de cobertura en esta pagina.',
                )}
              </p>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50/70 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-800">
                  {t('Important disclaimer', 'Disclaimer importante')}
                </p>
                <p className="mt-3 text-sm leading-6 text-amber-900">
                  {t(
                    'This matrix is a capability map and workflow summary. CERNIQ supports reporting, analytics, and governance workflows; it does not certify regulatory compliance or replace management, examiner, auditor, or legal judgment.',
                    'Esta matriz es un mapa de capacidades y un resumen de flujos. CERNIQ apoya flujos de reportes, analitica y gobierno; no certifica cumplimiento regulatorio ni reemplaza el criterio de gerencia, examinadores, auditores o asesoria legal.',
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center gap-3">
            <Files className="h-5 w-5 text-cyan-700" />
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">
                {t('Framework summary', 'Resumen por marco')}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t(
                  'Coverage counts reflect the current public claim set on this page only.',
                  'Los conteos de cobertura reflejan solo el set de claims publicos actual de esta pagina.',
                )}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PUBLIC_COMPLIANCE_FRAMEWORKS.map((framework) => {
              const counts = getPublicComplianceCoverageCounts(
                framework.key as PublicComplianceFramework,
              );

              return (
                <article
                  key={framework.key}
                  className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        {framework.label[lang]}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-950">
                        {framework.audience[lang]}
                      </h3>
                    </div>
                    <span className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-right">
                      <span className="block text-2xl font-semibold text-slate-950">
                        {counts.supported}
                      </span>
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">
                        {t('supported', 'soportado')}
                      </span>
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {framework.summary[lang]}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                      {t(`${counts.partial} partial`, `${counts.partial} parciales`)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                      {t(
                        `${counts.notClaimed} not claimed`,
                        `${counts.notClaimed} no reclamados`,
                      )}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                      {t(
                        `${counts.total} total rows`,
                        `${counts.total} filas totales`,
                      )}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">
                {t('Requirement matrix', 'Matriz de requisitos')}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t(
                  'Each row maps a buyer-facing requirement to current public coverage, a live workflow, and the claim basis used here.',
                  'Cada fila mapea un requisito buyer-facing a la cobertura publica actual, un flujo vivo y la base del claim usada aqui.',
                )}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:hidden">
            {PUBLIC_COMPLIANCE_MATRIX.map((row) => (
              <CoverageRow key={row.id} row={row} lang={lang} />
            ))}
          </div>

          <div className="mt-6 hidden overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.05)] lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1220px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90 text-left">
                    <th className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      #
                    </th>
                    <th className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('Requirement', 'Requisito')}
                    </th>
                    <th className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('Buyer outcome', 'Resultado buyer-facing')}
                    </th>
                    {PUBLIC_COMPLIANCE_FRAMEWORKS.map((framework) => (
                      <th
                        key={framework.key}
                        className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                      >
                        {framework.label[lang]}
                      </th>
                    ))}
                    <th className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('CERNIQ workflow', 'Flujo CERNIQ')}
                    </th>
                    <th className="px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('Current claim basis', 'Base actual del claim')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PUBLIC_COMPLIANCE_MATRIX.map((row, index) => (
                    <tr
                      key={row.id}
                      className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}
                    >
                      <td className="whitespace-nowrap px-4 py-4 align-top font-mono text-xs text-slate-400">
                        {row.id}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p className="font-semibold text-slate-950">
                          {row.requirement[lang]}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top text-slate-700">
                        {row.buyerOutcome[lang]}
                      </td>
                      {PUBLIC_COMPLIANCE_FRAMEWORKS.map((framework) => (
                        <td
                          key={framework.key}
                          className="whitespace-nowrap px-4 py-4 align-top"
                        >
                          <CoverageBadge
                            status={row.coverage[framework.key]}
                            lang={lang}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-4 align-top">
                        <Link
                          href={row.module.href}
                          className="inline-flex items-center gap-1 font-semibold text-cyan-700 transition hover:text-cyan-900"
                        >
                          {row.module.label[lang]}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                      <td className="px-4 py-4 align-top text-slate-700">
                        {row.evidence[lang]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-10 rounded-[2rem] border border-slate-900 bg-slate-950 px-6 py-7 text-white shadow-[0_22px_60px_rgba(2,6,23,0.26)] sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
                {t(
                  'Next step for buyers',
                  'Siguiente paso para compradores',
                )}
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                {t(
                  'Review the live workflow, then move into a pilot report.',
                  'Revise el flujo vivo y luego pase a un informe piloto.',
                )}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {t(
                  'If your team is evaluating CERNIQ for procurement or exam-prep use, pair this matrix with the live module routes above and the pilot workflow on the pricing page.',
                  'Si su equipo esta evaluando CERNIQ para procurement o uso de exam prep, combine esta matriz con las rutas vivas de modulos arriba y el flujo piloto en la pagina de precios.',
                )}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={PUBLIC_PATHS.pricing}
                className="inline-flex items-center justify-center rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
              >
                {t('Review pilot pricing', 'Revisar precios del piloto')}
              </Link>
              <Link
                href={PUBLIC_PATHS.contact}
                className="inline-flex items-center justify-center rounded-full border border-slate-700 px-5 py-3 text-sm font-semibold text-white transition hover:border-slate-500"
              >
                {t('Book a review call', 'Agendar llamada de revision')}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
