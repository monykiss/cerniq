'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import { PUBLIC_PATHS } from '@/lib/public-links';

export default function TermsPage() {
  const [lang, setLang] = useState<'en' | 'es'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('cerniq_lang') as 'en' | 'es') || 'en';
    return 'en';
  });
  const t = (en: string, es: string) => lang === 'en' ? en : es;

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">CERNIQ</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">{t('Terms of Service', 'Terminos de Servicio')}</div>
          </div>
        </div>
        <div className="flex items-center rounded-full border border-slate-200 text-xs">
          <button onClick={() => setLang('en')} className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Switch to English" aria-pressed={lang === 'en'}>EN</button>
          <button onClick={() => setLang('es')} className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Cambiar a Espanol" aria-pressed={lang === 'es'}>ES</button>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-xs text-slate-400 mb-8">{t('Last updated: March 23, 2026', 'Ultima actualizacion: 23 de marzo de 2026')}</p>

        <div className="prose prose-slate prose-sm max-w-none space-y-6 text-sm leading-7 text-slate-700">
          <h2 className="text-lg font-bold text-slate-950">{t('1. Acceptance of Terms', '1. Aceptacion de Terminos')}</h2>
          <p>{t(
            'By accessing or using the CERNIQ platform ("Service"), operated by KLYTICS LLC ("Company"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.',
            'Al acceder o utilizar la plataforma CERNIQ ("Servicio"), operada por KLYTICS LLC ("Empresa"), usted acepta estos Terminos de Servicio. Si no esta de acuerdo, no utilice el Servicio.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('2. Service Description', '2. Descripcion del Servicio')}</h2>
          <p>{t(
            'CERNIQ provides asset-liability management (ALM) analytics, regulatory compliance reporting, and risk intelligence tools for financial institutions including credit unions, cooperativas, and community banks.',
            'CERNIQ proporciona herramientas de analisis de gestion de activos y pasivos (ALM), informes de cumplimiento regulatorio e inteligencia de riesgos para instituciones financieras incluyendo credit unions, cooperativas y bancos comunitarios.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('3. User Accounts', '3. Cuentas de Usuario')}</h2>
          <p>{t(
            'You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You must be authorized by your institution to use the Service on its behalf.',
            'Usted es responsable de mantener la confidencialidad de sus credenciales y de todas las actividades bajo su cuenta. Debe estar autorizado por su institucion para usar el Servicio en su nombre.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('4. Data Ownership', '4. Propiedad de Datos')}</h2>
          <p>{t(
            'You retain all ownership rights to your institution\'s financial data. CERNIQ processes your data solely to provide the Service. We do not sell, share, or use your data for purposes other than delivering the agreed-upon analytics and reports.',
            'Usted retiene todos los derechos de propiedad sobre los datos financieros de su institucion. CERNIQ procesa sus datos unicamente para proporcionar el Servicio. No vendemos, compartimos ni usamos sus datos para propositos distintos a la entrega de los analisis y reportes acordados.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('5. Billing & Subscriptions', '5. Facturacion y Suscripciones')}</h2>
          <p>{t(
            'Subscription fees are billed in advance. You may cancel at any time; cancellation takes effect at the end of the current billing period. Refunds are not provided for partial periods. All amounts are in USD.',
            'Las tarifas de suscripcion se facturan por adelantado. Puede cancelar en cualquier momento; la cancelacion toma efecto al final del periodo de facturacion actual. No se proporcionan reembolsos por periodos parciales. Todos los montos son en USD.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('6. Disclaimer', '6. Descargo de Responsabilidad')}</h2>
          <p>{t(
            'CERNIQ provides analytical tools and does NOT constitute financial, legal, or regulatory advice. All reports are informational. You should consult qualified professionals before making financial decisions based on CERNIQ outputs. The Service is provided "as is" without warranties of any kind.',
            'CERNIQ proporciona herramientas analiticas y NO constituye asesoramiento financiero, legal o regulatorio. Todos los informes son informativos. Debe consultar profesionales calificados antes de tomar decisiones financieras basadas en los resultados de CERNIQ. El Servicio se proporciona "tal cual" sin garantias de ningun tipo.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('7. Limitation of Liability', '7. Limitacion de Responsabilidad')}</h2>
          <p>{t(
            'KLYTICS LLC shall not be liable for indirect, incidental, or consequential damages arising from use of the Service. Our total liability shall not exceed the amount paid by you in the 12 months preceding the claim.',
            'KLYTICS LLC no sera responsable por danos indirectos, incidentales o consecuentes derivados del uso del Servicio. Nuestra responsabilidad total no excedera el monto pagado por usted en los 12 meses anteriores a la reclamacion.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('8. Governing Law', '8. Ley Aplicable')}</h2>
          <p>{t(
            'These terms are governed by the laws of the Commonwealth of Puerto Rico. Any disputes shall be resolved in the courts of San Juan, Puerto Rico.',
            'Estos terminos se rigen por las leyes del Estado Libre Asociado de Puerto Rico. Cualquier disputa se resolvera en los tribunales de San Juan, Puerto Rico.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('9. Contact', '9. Contacto')}</h2>
          <p>{t(
            'For questions about these terms, contact us at hello@cerniq.io or visit ',
            'Para preguntas sobre estos terminos, contactenos en hello@cerniq.io o visite '
          )}<a href={PUBLIC_PATHS.contact} className="text-cyan-700 hover:underline">{t('our contact page', 'nuestra pagina de contacto')}</a>.</p>
        </div>
      </main>
    </div>
  );
}
