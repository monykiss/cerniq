'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Shield, Zap, DollarSign,
  Brain, Layers, Globe, ChevronRight, TrendingUp, Cpu,
} from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import { getAcquisitionCopy } from '@/lib/acquisition-copy';
import { PUBLIC_PATHS } from '@/lib/public-links';

export default function WhyCerniqPage() {
  const [lang, setLang] = useState<'en' | 'es'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('cerniq_lang') as 'en' | 'es') || 'en';
    return 'en';
  });
  const t = (en: string, es: string) => lang === 'en' ? en : es;
  const acquisition = getAcquisitionCopy(lang);

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">CERNIQ</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">{t('Why CERNIQ', 'Por qué CERNIQ')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={PUBLIC_PATHS.demo} className="hidden sm:inline-flex rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition">
            {acquisition.proofCta}
          </Link>
          <div className="flex items-center rounded-full border border-slate-200 text-xs">
            <button onClick={() => setLang('en')} className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Switch to English" aria-pressed={lang === 'en'}>EN</button>
            <button onClick={() => setLang('es')} className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Cambiar a Espanol" aria-pressed={lang === 'es'}>ES</button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        {/* Hero */}
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-slate-950 leading-tight">
            {t(
              'The finance operating system that makes treasury, risk, and board delivery feel coordinated again',
              'El sistema operativo financiero que vuelve a coordinar tesoreria, riesgo y entrega a junta',
            )}
          </h1>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">
            {t(
              'CERNIQ keeps ALM and reporting as the anchor, then connects that workflow to liquidity posture, exam readiness, and institutional stakeholder output in one command surface.',
              'CERNIQ mantiene ALM y reportes como ancla, y luego conecta ese flujo con visibilidad de portafolio, revision de ejecucion y salida institucional en una sola superficie de mando.'
            )}
          </p>
        </section>

        {/* Platform Numbers */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { value: '1', label: t('Command Surface', 'Superficie de Mando'), icon: Layers, color: 'cyan' },
            { value: '4', label: t('Finance Lanes', 'Carriles Financieros'), icon: Cpu, color: 'violet' },
            { value: 'EN/ES', label: t('Board Output', 'Salida para Junta'), icon: Zap, color: 'amber' },
            { value: '$750', label: t('Pilot Entry', 'Entrada al Piloto'), icon: DollarSign, color: 'emerald' },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border border-${s.color}-200 bg-${s.color}-50/50 p-5 text-center`}>
              <s.icon className={`h-5 w-5 text-${s.color}-600 mx-auto mb-2`} />
              <p className="text-3xl font-bold tabular-nums text-slate-950">{s.value}</p>
              <p className="text-xs text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </section>

        {/* 6 Reasons */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-950 text-center">{t('6 reasons finance teams choose CERNIQ', '6 razones por las que los equipos financieros eligen CERNIQ')}</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Shield,
                title: t('Board and regulator ready', 'Listo para junta y regulador'),
                body: t(
                  'CERNIQ keeps committee, board, and regulator-facing outputs inside the same operating workflow instead of forcing teams to rebuild the story by hand every quarter.',
                  'CERNIQ mantiene las salidas para comite, junta y regulador dentro del mismo flujo operativo en vez de obligar a reconstruir la historia a mano cada trimestre.'
                ),
              },
              {
                icon: Cpu,
                title: t('Institutional models under the hood', 'Modelos institucionales bajo el capó'),
                body: t(
                  'The model layer remains serious: yield-curve work, Monte Carlo, credit, liquidity, and allocation tooling all support the same finance operating surface.',
                  'La capa de modelos sigue siendo seria: curvas, Monte Carlo, credito, liquidez y asignacion apoyan la misma superficie operativa financiera.'
                ),
              },
              {
                icon: Globe,
                title: t('Bilingual output by default', 'Salida bilingue por defecto'),
                body: t(
                  'English and Spanish are built into the reporting and delivery layer from the start, so stakeholder output is presentation-ready without translation cleanup.',
                  'Ingles y espanol estan integrados en la capa de reportes y entrega desde el inicio, para que la salida sea presentable sin limpieza de traduccion.'
                ),
              },
              {
                icon: DollarSign,
                title: t('Replace fragmented operating cost', 'Reemplace costo operativo fragmentado'),
                body: t(
                  "The point is not just cheaper reports. The point is one repeatable operating rhythm across reporting, review, and delivery instead of consultant cycles plus spreadsheet overhead.",
                  "El punto no es solo reportes mas baratos. El punto es un ritmo operativo repetible para reportar, revisar y entregar en vez de ciclos de consultoria mas sobrecarga en hojas de calculo."
                ),
              },
              {
                icon: TrendingUp,
                title: t('Finance-team-first positioning', 'Posicionamiento centrado en equipos financieros'),
                body: t(
                  'Puerto Rico remains an important wedge, but the product now presents itself as a treasury, risk, and portfolio intelligence platform for finance teams more broadly.',
                  'Puerto Rico sigue siendo un wedge importante, pero el producto ahora se presenta como plataforma de tesoreria, riesgo e inteligencia de portafolio para equipos financieros mas amplios.'
                ),
              },
              {
                icon: Brain,
                title: t('Operator-style guidance', 'Guia estilo operador'),
                body: t(
                  'AI and workflow layers help teams interrogate the institution context faster, but the product story stays grounded in operator usefulness rather than AI theater.',
                  'Las capas de IA y flujo ayudan a interrogar el contexto institucional mas rapido, pero la historia del producto sigue anclada en utilidad operativa, no en teatro de IA.'
                ),
              },
            ].map((reason, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-5 hover:shadow-sm transition">
                <reason.icon className="h-6 w-6 text-cyan-600 mb-3" />
                <h3 className="text-sm font-bold text-slate-950 mb-2">{reason.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{reason.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Social Proof */}
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{t('Built for institutional finance teams', 'Construido para equipos financieros institucionales')}</p>
          <div className="flex flex-wrap justify-center gap-6">
            {[
              { label: t('Primary buyer', 'Comprador primario'), value: t('Treasury + Risk', 'Tesoreria + Riesgo') },
              { label: t('Secondary buyer', 'Comprador secundario'), value: t('PM + Analyst', 'PM + Analista') },
              { label: t('Delivery language', 'Idioma de entrega'), value: 'EN/ES' },
              { label: t('Workflow anchor', 'Ancla del flujo'), value: t('Upload -> Report', 'Carga -> Informe') },
            ].map(s => (
              <div key={s.label}>
                <p className="text-xl font-bold text-slate-950 tabular-nums">{s.value}</p>
                <p className="text-[10px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTAs */}
        <section className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href={PUBLIC_PATHS.getStarted} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-8 py-4 text-sm font-semibold text-white shadow-lg hover:bg-amber-600 transition">
            {acquisition.primaryCta} <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={PUBLIC_PATHS.demo} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
            {acquisition.proofCta} <ChevronRight className="h-4 w-4" />
          </Link>
          <Link href={PUBLIC_PATHS.pricing} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
            {t('View Pricing', 'Ver Precios')} <ChevronRight className="h-4 w-4" />
          </Link>
          <Link href={PUBLIC_PATHS.contact} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
            {acquisition.salesCta} <Shield className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
