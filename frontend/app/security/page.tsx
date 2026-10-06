'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield, Lock, Server, Eye, FileCheck, Users } from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';

export default function SecurityPage() {
  const [lang, setLang] = useState<'en' | 'es'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('cerniq_lang') as 'en' | 'es') || 'en';
    return 'en';
  });
  const t = (en: string, es: string) => lang === 'en' ? en : es;

  const controls = [
    { icon: Lock, title: t('Encryption', 'Cifrado'), desc: t('AES-256 at rest, TLS 1.3 in transit. All financial data encrypted before storage.', 'AES-256 en reposo, TLS 1.3 en transito. Todos los datos financieros cifrados antes del almacenamiento.') },
    { icon: Users, title: t('Access Control', 'Control de Acceso'), desc: t('Role-based access (RBAC) with 12 institutional roles. API keys with SHA-256 hashing and automatic expiration.', 'Acceso basado en roles (RBAC) con 12 roles institucionales. Claves API con hash SHA-256 y expiracion automatica.') },
    { icon: Eye, title: t('Audit Logging', 'Registro de Auditoria'), desc: t('Every data access, modification, and report generation is logged with user ID, IP, and timestamp. Logs retained for 7 years.', 'Cada acceso, modificacion y generacion de informe se registra con ID de usuario, IP y marca de tiempo. Registros retenidos por 7 anos.') },
    { icon: Server, title: t('Infrastructure', 'Infraestructura'), desc: t('Hosted on SOC 2-compliant infrastructure with automated backups, DDoS protection, and geo-redundancy.', 'Alojado en infraestructura compatible con SOC 2 con copias de seguridad automaticas, proteccion DDoS y geo-redundancia.') },
    { icon: FileCheck, title: t('Compliance', 'Cumplimiento'), desc: t('Platform designed for COSSEC, NCUA, and Basel III regulatory frameworks. Reports meet examiner requirements.', 'Plataforma disenada para marcos regulatorios COSSEC, NCUA y Basilea III. Los informes cumplen requisitos de examinadores.') },
    { icon: Shield, title: t('Vulnerability Management', 'Gestion de Vulnerabilidades'), desc: t('Regular dependency scanning, penetration testing, and security code reviews. Responsible disclosure program available.', 'Escaneo regular de dependencias, pruebas de penetracion y revisiones de codigo de seguridad. Programa de divulgacion responsable disponible.') },
  ];

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">CERNIQ</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">{t('Security', 'Seguridad')}</div>
          </div>
        </div>
        <div className="flex items-center rounded-full border border-slate-200 text-xs">
          <button onClick={() => setLang('en')} className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Switch to English" aria-pressed={lang === 'en'}>EN</button>
          <button onClick={() => setLang('es')} className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Cambiar a Espanol" aria-pressed={lang === 'es'}>ES</button>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 mb-4">
            <Shield className="h-7 w-7 text-cyan-700" />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">{t('Security at CERNIQ', 'Seguridad en CERNIQ')}</h1>
          <p className="mt-3 text-sm text-slate-600 max-w-xl mx-auto">
            {t(
              'Your institution\'s financial data deserves the highest level of protection. Here\'s how we safeguard it.',
              'Los datos financieros de su institucion merecen el mas alto nivel de proteccion. Asi es como los protegemos.'
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {controls.map((c) => (
            <div key={c.title} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 transition">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50">
                  <c.icon className="h-4 w-4 text-cyan-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-950">{c.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{c.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
          <h3 className="text-sm font-bold text-slate-950 mb-2">{t('Report a Vulnerability', 'Reportar una Vulnerabilidad')}</h3>
          <p className="text-xs text-slate-600 mb-4">
            {t(
              'If you discover a security vulnerability, please report it responsibly.',
              'Si descubre una vulnerabilidad de seguridad, reportela de manera responsable.'
            )}
          </p>
          <a href="mailto:security@cerniq.io" className="inline-flex items-center gap-2 rounded-full bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-800">
            security@cerniq.io
          </a>
        </div>
      </main>
    </div>
  );
}
