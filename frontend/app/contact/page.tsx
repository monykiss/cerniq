'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, CheckCircle2, Calendar, Mail, Building2 } from 'lucide-react';
import { analytics, EVENTS } from '@/lib/analytics';
import { CerniqMark } from '@/components/brand/CerniqLogo';
import { getAcquisitionCopy } from '@/lib/acquisition-copy';

export default function ContactPage() {
  const [lang, setLang] = useState<'en' | 'es'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('cerniq_lang') as 'en' | 'es') || 'en';
    return 'en';
  });
  const [form, setForm] = useState({ name: '', email: '', institution: '', assets: '', message: '' });
  const [honeypot, setHoneypot] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const t = (en: string, es: string) => lang === 'en' ? en : es;
  const acquisition = getAcquisitionCopy(lang);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (honeypot) return; // Bot trap — real users never fill this
    setSubmitError('');
    setLoading(true);
    try {
      const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
      const response = await fetch(`${NODE}/api/demo-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          institutionName: form.institution,
          totalAssets: form.assets,
          message: form.message,
          source: 'contact_sales_page',
        }),
      });
      if (!response.ok) {
        throw new Error('submit_failed');
      }
      analytics.track(EVENTS.LEAD_FORM_SUBMITTED, { source: 'contact_sales_page', institution: form.institution, assets: form.assets });
      setSubmitted(true);
    } catch {
      setSubmitError(
        t(
          'We could not submit your request. Please email hello@cerniq.io and we will get back to you.',
          'No pudimos enviar su solicitud. Escriba a hello@cerniq.io y le responderemos.'
        ),
      );
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">CERNIQ</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">{acquisition.contactKicker}</div>
          </div>
        </div>
        <div className="flex items-center rounded-full border border-slate-200 text-xs">
          <button onClick={() => setLang('en')} className={`rounded-l-full px-2.5 py-1.5 font-semibold transition ${lang === 'en' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Switch to English" aria-pressed={lang === 'en'}>EN</button>
          <button onClick={() => setLang('es')} className={`rounded-r-full px-2.5 py-1.5 font-semibold transition ${lang === 'es' ? 'bg-cyan-700 text-white' : 'text-slate-500'}`} aria-label="Cambiar a Espanol" aria-pressed={lang === 'es'}>ES</button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-2 gap-12">
          {/* Left: Info */}
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">{acquisition.contactHeading}</h1>
              <p className="mt-3 text-slate-600 leading-relaxed">
                {t(
                  "Use this path when the conversation is broader than the pilot: partner workflow, advisor support, assisted rollout, procurement review, or treasury-and-risk deployment planning.",
                  "Use esta ruta cuando la conversacion sea mas amplia que el piloto: flujo para partners, soporte a asesores, implementacion asistida, revision de compras o plan de despliegue de tesoreria y riesgo.",
                )}
              </p>
            </div>

            <div className="space-y-4">
              {[
                { icon: Building2, title: t('Partner & Multi-Institution Fit', 'Partner y multi-institucion'), desc: t('Use this route if you manage multiple institutions, need white-label support, or want to discuss the partner workflow.', 'Use esta ruta si gestiona multiples instituciones, necesita soporte white-label o quiere discutir el flujo para partners.') },
                { icon: Calendar, title: t('Assisted Rollout Planning', 'Plan de implementacion asistida'), desc: t('We can map onboarding, data readiness, reporting cadence, and the right operating rollout after the pilot for your institution.', 'Podemos definir onboarding, readiness de datos, cadencia de reportes y el despliegue operativo correcto despues del piloto para su institucion.') },
                { icon: Mail, title: t('Security, Procurement, and Board Review', 'Seguridad, compras y revision de junta'), desc: t('Bring security questionnaires, procurement constraints, or board approval needs into a direct sales conversation built for institutional rollout.', 'Traiga cuestionarios de seguridad, restricciones de compras o aprobaciones de junta a una conversacion comercial pensada para despliegue institucional.') },
              ].map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50">
                    <item.icon className="h-5 w-5 text-cyan-700" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{item.title}</p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{t('Sales Contact', 'Contacto Comercial')}</p>
              <p className="text-sm text-slate-700">CERNIQ Team</p>
              <p className="text-sm text-slate-500">Founder, KLYTICS LLC</p>
              <a href="mailto:hello@cerniq.io" className="text-sm text-cyan-600 hover:text-cyan-800 mt-1 block">hello@cerniq.io</a>
            </div>
          </div>

          {/* Right: Form */}
          <div>
            {submitted ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-950">{acquisition.contactSuccessTitle}</h2>
                <p className="mt-2 text-sm text-slate-600">{acquisition.contactSuccessBody}</p>
                <div className="mt-6 flex justify-center gap-3">
                  <Link href="/get-started" className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition">
                    {acquisition.primaryCta}
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 p-6 space-y-4">
                {/* Honeypot anti-spam field — hidden from real users */}
                <div className="absolute -left-[9999px]" aria-hidden="true">
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={e => setHoneypot(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="contact-name" className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">{t('Your Name', 'Su Nombre')}</label>
                  <input id="contact-name" type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300 outline-none"
                    placeholder={t('John Rivera', 'Juan Rivera')} autoComplete="name" />
                </div>
                <div>
                  <label htmlFor="contact-email" className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">{t('Work Email', 'Email Laboral')}</label>
                  <input id="contact-email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300 outline-none"
                    placeholder="name@institution.com" autoComplete="email" />
                </div>
                <div>
                  <label htmlFor="contact-institution" className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">{t('Institution Name', 'Nombre Institución')}</label>
                  <input id="contact-institution" type="text" required value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300 outline-none"
                    placeholder={t('Cooperativa Ejemplo Este', 'Cooperativa Ejemplo Este')} autoComplete="organization" />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">{t('Asset Size', 'Tamaño de Activos')}</label>
                  <select value={form.assets} onChange={e => setForm({ ...form, assets: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300 outline-none">
                    <option value="">{t('Select range', 'Seleccione rango')}</option>
                    <option value="< $100M">&lt; $100M</option>
                    <option value="$100M - $500M">$100M - $500M</option>
                    <option value="$500M - $1B">$500M - $1B</option>
                    <option value="$1B - $5B">$1B - $5B</option>
                    <option value="$5B+">$5B+</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">{t('Message (optional)', 'Mensaje (opcional)')}</label>
                  <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={3}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300 outline-none resize-none"
                    placeholder={t('Interested in CECL compliance and stress testing...', 'Interesado en cumplimiento CECL y pruebas de estrés...')} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full rounded-xl bg-amber-500 py-3.5 text-sm font-semibold text-white hover:bg-amber-600 transition disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? t('Sending...', 'Enviando...') : <><Send className="h-4 w-4" /> {acquisition.contactSubmit}</>}
                </button>
                {submitError && (
                  <p className="text-xs text-red-600 text-center">{submitError}</p>
                )}
                <p className="text-[10px] text-slate-400 text-center">{t('Pilot evaluation belongs in /get-started. We respond within 24 hours.', 'La evaluacion del piloto vive en /get-started. Respondemos en 24 horas.')}</p>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
