'use client';

import Link from 'next/link';
import { CheckCircle2, Clock, FileText, Sparkles, Upload } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export interface DemoSeatBannerProps {
  institutionName: string | null;
  publicDataSource: string | null;
  daysRemaining: number | null;
  expiresAt: string | null;
  reportJobId: string | null;
  /** When true, the underlying report is still QUEUED/PROCESSING */
  isProcessing?: boolean;
}

function formatExpiry(expiresAt: string | null, locale: string) {
  if (!expiresAt) return null;
  try {
    const date = new Date(expiresAt);
    return date.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

function describeSource(source: string | null, locale: string): string {
  const isEs = locale === 'es';
  switch (source) {
    case 'cossec':
    case 'cossec_public_filings':
      return isEs
        ? 'COSSEC — Estadísticas trimestrales públicas'
        : 'COSSEC — Public quarterly statistics';
    case 'ncua':
    case 'ncua_5300':
      return isEs
        ? 'NCUA — Reporte de Llamada 5300'
        : 'NCUA — 5300 Call Report';
    default:
      return isEs ? 'Filings públicos' : 'Public filings';
  }
}

export default function DemoSeatBanner({
  institutionName,
  publicDataSource,
  daysRemaining,
  expiresAt,
  reportJobId,
  isProcessing = false,
}: DemoSeatBannerProps) {
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);

  const expiryLabel = formatExpiry(expiresAt, locale);
  const sourceLabel = describeSource(publicDataSource, locale);

  const daysLabel =
    typeof daysRemaining === 'number'
      ? daysRemaining <= 1
        ? t('Less than 1 day left', 'Menos de 1 día restante')
        : t(`${daysRemaining} days left`, `${daysRemaining} días restantes`)
      : null;

  return (
    <section
      aria-labelledby="demo-seat-headline"
      className="relative overflow-hidden rounded-3xl border border-cyan-200/60 bg-gradient-to-br from-[#0b1d36] via-[#1B3A6B] to-[#0e2340] p-7 sm:p-9 shadow-[0_24px_70px_rgba(11,29,54,0.35)]"
    >
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-amber-300/10 blur-3xl" />

      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT — provenance + headline */}
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
            {t('Preview built for you', 'Vista preparada para usted')}
          </div>

          <h2
            id="demo-seat-headline"
            className="mt-5 font-display text-3xl font-semibold text-white sm:text-4xl"
          >
            {institutionName
              ? t(
                  `${institutionName} — your CERNIQ analysis is ready.`,
                  `${institutionName} — su análisis CERNIQ está listo.`,
                )
              : t(
                  'Your CERNIQ analysis is ready.',
                  'Su análisis CERNIQ está listo.',
                )}
          </h2>

          <p className="mt-4 max-w-xl text-sm leading-7 text-white/70">
            {t(
              "We built this report from public regulatory filings — nothing for you to upload. Everything you'd see in a paid CERNIQ engagement is already in your portal.",
              'Construimos este informe con datos públicos regulatorios — usted no tiene que cargar nada. Todo lo que vería en un análisis CERNIQ pagado ya está en su portal.',
            )}
          </p>

          <dl className="mt-6 grid gap-3 text-xs text-white/80 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                {t('Data source', 'Fuente de datos')}
              </dt>
              <dd className="mt-1.5 text-sm font-medium text-white">{sourceLabel}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                {t('Access window', 'Ventana de acceso')}
              </dt>
              <dd className="mt-1.5 flex items-center gap-2 text-sm font-medium text-white">
                <Clock className="h-3.5 w-3.5 text-cyan-300" />
                {daysLabel || expiryLabel || t('Unlimited', 'Ilimitada')}
              </dd>
            </div>
          </dl>
        </div>

        {/* RIGHT — primary CTA */}
        <div className="flex flex-col justify-between gap-5">
          <ul className="space-y-2.5 text-sm text-white/80">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              {t('Full ALM report — duration gap, NII, EVE, Monte Carlo', 'Informe ALM completo — brecha, NII, EVE, Monte Carlo')}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              {t('All 12 regulatory ratios scored', 'Los 12 ratios regulatorios calculados')}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              {t('Print-ready Board (ALCO) pack', 'Paquete de Junta (ALCO) listo para imprimir')}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              {t('Sector benchmarking', 'Comparación con la mediana del sector')}
            </li>
          </ul>

          <div className="flex flex-col gap-3">
            {reportJobId && !isProcessing ? (
              <Link
                href={`/portal/reports/${reportJobId}`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#E8A020] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 transition hover:bg-[#d19218]"
              >
                <FileText className="h-4 w-4" />
                {t('Open your report', 'Abrir su informe')}
              </Link>
            ) : (
              <div className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-medium text-white/80">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-300/50 border-t-cyan-200" />
                {t('Building your report — refresh in a minute', 'Generando su informe — actualice en un minuto')}
              </div>
            )}

            <Link
              href={
                reportJobId
                  ? `/portal/submit?jobId=${reportJobId}`
                  : '/portal/submit'
              }
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/0 px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/5"
            >
              <Upload className="h-3.5 w-3.5" />
              {t('Refine with your real numbers', 'Refinar con sus números reales')}
            </Link>
          </div>
        </div>
      </div>

      {/* Disclosure footer */}
      <p className="relative z-10 mt-7 border-t border-white/10 pt-4 text-[11px] leading-5 text-white/50">
        {t(
          'PRELIMINARY — Built from public filings. Asset/liability mix synthesized from sector medians where granular data is not published. Refine with your real balance-sheet data any time.',
          'PRELIMINAR — Construido con filings públicos. Composición de activos/pasivos sintetizada con medianas del sector donde no hay datos granulares. Puede refinar con sus números reales en cualquier momento.',
        )}
      </p>
    </section>
  );
}
