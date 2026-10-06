'use client';

import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';
import { getAcquisitionCopy } from '@/lib/acquisition-copy';
import { PUBLIC_PATHS } from '@/lib/public-links';

interface FooterProps {
  t: (en: string, es: string) => string;
  compact?: boolean;
}

export default function Footer({ t, compact }: FooterProps) {
  const acquisition = getAcquisitionCopy(
    t('en', 'es') === 'en' ? 'en' : 'es',
  );
  const almHref = buildLoginUrlForReturnUrl('/alm');

  if (compact) {
    return (
      <footer className="border-t border-slate-200 bg-slate-50 py-4 px-6">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] text-slate-400">
          <span>&copy; {new Date().getFullYear()} KLYTICS LLC. CERNIQ&trade;</span>
          <div className="flex items-center gap-4">
            <a href={PUBLIC_PATHS.terms} className="hover:text-slate-600">{t('Terms', 'Terminos')}</a>
            <a href={PUBLIC_PATHS.privacy} className="hover:text-slate-600">{t('Privacy', 'Privacidad')}</a>
            <a href={PUBLIC_PATHS.security} className="hover:text-slate-600">{t('Security', 'Seguridad')}</a>
            <a href="mailto:hello@cerniq.io" className="hover:text-slate-600">hello@cerniq.io</a>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-slate-200 bg-slate-50 py-8 px-6">
      <div className="mx-auto max-w-6xl grid grid-cols-2 sm:grid-cols-4 gap-6 text-xs">
        <div>
          <p className="font-bold text-slate-800 mb-3 uppercase tracking-wider text-[10px]">{t('Workspace', 'Workspace')}</p>
          <div className="space-y-2">
            <a href={PUBLIC_PATHS.getStarted} className="block text-slate-500 hover:text-slate-800">{acquisition.primaryCta}</a>
            <a href={PUBLIC_PATHS.demo} className="block text-slate-500 hover:text-slate-800">{acquisition.proofCta}</a>
            <a href="/dashboard" className="block text-slate-500 hover:text-slate-800">{t('Command Center', 'Centro de Mando')}</a>
            <a href={PUBLIC_PATHS.pricing} className="block text-slate-500 hover:text-slate-800">{t('Pricing', 'Precios')}</a>
            <a href={almHref} className="block text-slate-500 hover:text-slate-800">{t('ALM Workspace', 'Espacio ALM')}</a>
          </div>
        </div>
        <div>
          <p className="font-bold text-slate-800 mb-3 uppercase tracking-wider text-[10px]">{t('Platform', 'Plataforma')}</p>
          <div className="space-y-2">
            <a href={PUBLIC_PATHS.whyCerniq} className="block text-slate-500 hover:text-slate-800">{t('Treasury + Risk Positioning', 'Posicionamiento Tesoreria + Riesgo')}</a>
            <a href={PUBLIC_PATHS.compliance} className="block text-slate-500 hover:text-slate-800">{t('Compliance Matrix', 'Matriz de Cumplimiento')}</a>
            <a href={PUBLIC_PATHS.developers} className="block text-slate-500 hover:text-slate-800">{t('API Docs', 'Documentacion API')}</a>
            <a href={PUBLIC_PATHS.changelog} className="block text-slate-500 hover:text-slate-800">{t("What's New", 'Novedades')}</a>
          </div>
        </div>
        <div>
          <p className="font-bold text-slate-800 mb-3 uppercase tracking-wider text-[10px]">{t('Coverage', 'Cobertura')}</p>
          <div className="space-y-2">
            <span className="block text-slate-500">{t('Treasury intelligence', 'Inteligencia de tesoreria')}</span>
            <span className="block text-slate-500">{t('Risk operating system', 'Sistema operativo de riesgo')}</span>
            <span className="block text-slate-500">{t('Portfolio visibility', 'Visibilidad de portafolio')}</span>
            <span className="block text-slate-500">{t('Board and compliance outputs', 'Salidas para junta y cumplimiento')}</span>
          </div>
        </div>
        <div>
          <p className="font-bold text-slate-800 mb-3 uppercase tracking-wider text-[10px]">{t('Company', 'Empresa')}</p>
          <div className="space-y-2">
            <span className="block text-slate-500">KLYTICS LLC</span>
            <span className="block text-slate-500">San Juan, PR</span>
            <a href={PUBLIC_PATHS.contact} className="block text-cyan-600 hover:text-cyan-800">{acquisition.salesCta}</a>
            <a href="mailto:hello@cerniq.io" className="block text-slate-500 hover:text-slate-800">hello@cerniq.io</a>
            <a href={PUBLIC_PATHS.status} className="block text-slate-500 hover:text-slate-800">{t('System Status', 'Estado del Sistema')}</a>
          </div>
        </div>
      </div>
      {/* Legal + Social */}
      <div className="mx-auto max-w-6xl mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-400">
          <span>&copy; {new Date().getFullYear()} KLYTICS LLC. CERNIQ&trade;</span>
          <a href={PUBLIC_PATHS.terms} className="hover:text-slate-600">{t('Terms of Service', 'Terminos de Servicio')}</a>
          <a href={PUBLIC_PATHS.privacy} className="hover:text-slate-600">{t('Privacy Policy', 'Politica de Privacidad')}</a>
          <a href={PUBLIC_PATHS.security} className="hover:text-slate-600">{t('Security', 'Seguridad')}</a>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://linkedin.com/company/cerniq" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-600" aria-label="LinkedIn">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
