'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import { PUBLIC_PATHS } from '@/lib/public-links';

export default function PrivacyPage() {
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
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">{t('Privacy Policy', 'Politica de Privacidad')}</div>
          </div>
        </div>
        <div className="flex items-center rounded-full border border-slate-200 text-xs">
          <button onClick={() => setLang('en')} className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Switch to English" aria-pressed={lang === 'en'}>EN</button>
          <button onClick={() => setLang('es')} className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Cambiar a Espanol" aria-pressed={lang === 'es'}>ES</button>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-6 w-6 text-cyan-700" />
          <p className="text-xs text-slate-400">{t('Last updated: March 23, 2026', 'Ultima actualizacion: 23 de marzo de 2026')}</p>
        </div>

        <div className="prose prose-slate prose-sm max-w-none space-y-6 text-sm leading-7 text-slate-700">
          <h2 className="text-lg font-bold text-slate-950">{t('1. Information We Collect', '1. Informacion que Recopilamos')}</h2>
          <p>{t(
            'We collect information you provide directly: name, email address, institution name, asset size, and financial data uploaded for analysis. We also collect usage data (pages visited, features used) through analytics services.',
            'Recopilamos informacion que usted proporciona directamente: nombre, correo electronico, nombre de la institucion, tamano de activos y datos financieros cargados para analisis. Tambien recopilamos datos de uso (paginas visitadas, funciones utilizadas) mediante servicios de analisis.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('2. How We Use Your Data', '2. Como Usamos sus Datos')}</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('To provide ALM analytics, reports, and regulatory compliance tools', 'Para proporcionar analisis ALM, informes y herramientas de cumplimiento regulatorio')}</li>
            <li>{t('To communicate about your account and service updates', 'Para comunicarnos sobre su cuenta y actualizaciones del servicio')}</li>
            <li>{t('To improve the platform and develop new features', 'Para mejorar la plataforma y desarrollar nuevas funcionalidades')}</li>
            <li>{t('To process billing and subscription management', 'Para procesar facturacion y gestion de suscripciones')}</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-950">{t('3. Data Protection', '3. Proteccion de Datos')}</h2>
          <p>{t(
            'Your financial data is encrypted at rest (AES-256) and in transit (TLS 1.3). We implement role-based access controls, audit logging, and regular security reviews. Data is stored in SOC 2-compliant infrastructure.',
            'Sus datos financieros se cifran en reposo (AES-256) y en transito (TLS 1.3). Implementamos controles de acceso basados en roles, registro de auditoria y revisiones de seguridad regulares. Los datos se almacenan en infraestructura compatible con SOC 2.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('4. Data Sharing', '4. Compartir Datos')}</h2>
          <p>{t(
            'We do NOT sell your data. We share data only with: (a) service providers necessary to operate the platform (hosting, payment processing, email delivery), (b) as required by law or regulatory authorities, (c) with your explicit consent.',
            'NO vendemos sus datos. Compartimos datos solo con: (a) proveedores de servicios necesarios para operar la plataforma (hosting, procesamiento de pagos, envio de correo), (b) segun lo requiera la ley o autoridades regulatorias, (c) con su consentimiento explicito.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('5. Data Retention', '5. Retencion de Datos')}</h2>
          <p>{t(
            'We retain your data for the duration of your subscription plus 90 days. After cancellation, you may request full data deletion. Audit logs are retained for 7 years per regulatory requirements.',
            'Retenemos sus datos durante la duracion de su suscripcion mas 90 dias. Despues de la cancelacion, puede solicitar la eliminacion completa de datos. Los registros de auditoria se retienen por 7 anos segun requisitos regulatorios.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('6. Your Rights', '6. Sus Derechos')}</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('Access: Request a copy of your data at any time', 'Acceso: Solicite una copia de sus datos en cualquier momento')}</li>
            <li>{t('Correction: Request corrections to inaccurate data', 'Correccion: Solicite correcciones a datos inexactos')}</li>
            <li>{t('Deletion: Request deletion of your data', 'Eliminacion: Solicite la eliminacion de sus datos')}</li>
            <li>{t('Portability: Export your data in standard formats (CSV, JSON)', 'Portabilidad: Exporte sus datos en formatos estandar (CSV, JSON)')}</li>
          </ul>

          <h2 className="text-lg font-bold text-slate-950">{t('7. Cookies & Analytics', '7. Cookies y Analisis')}</h2>
          <p>{t(
            'We use essential cookies for authentication and session management. We use Segment for analytics, which may set performance cookies. You can disable non-essential cookies in your browser settings.',
            'Usamos cookies esenciales para autenticacion y gestion de sesiones. Usamos Segment para analisis, que puede establecer cookies de rendimiento. Puede desactivar cookies no esenciales en la configuracion de su navegador.'
          )}</p>

          <h2 className="text-lg font-bold text-slate-950">{t('8. Contact', '8. Contacto')}</h2>
          <p>{t(
            'For privacy inquiries or data requests, contact our Data Protection Officer at hello@cerniq.io or visit ',
            'Para consultas de privacidad o solicitudes de datos, contacte a nuestro Oficial de Proteccion de Datos en hello@cerniq.io o visite '
          )}<a href={PUBLIC_PATHS.contact} className="text-cyan-700 hover:underline">{t('our contact page', 'nuestra pagina de contacto')}</a>.</p>
        </div>
      </main>
    </div>
  );
}
