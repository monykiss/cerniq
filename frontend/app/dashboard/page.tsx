'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useEffect } from 'react';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  LineChart,
  LockKeyhole,
  ShieldCheck,
  Target,
  Upload,
} from 'lucide-react';
import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/lib/store';

const PORTAL_WORKSPACE_HREF = '/portal/submit?createCycle=1';
const GATED_MODULE_HREFS = new Set(['/alm']);

function SurfaceCard({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="cerniq-dashboard-elevated-surface w-full rounded-[2rem] border p-6 shadow-[0_30px_120px_rgba(113,88,40,0.14)] sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700/80">
        {eyebrow}
      </p>
      <h1 className="mt-4 font-display text-3xl text-[var(--dashboard-text-primary)] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--dashboard-text-secondary)] sm:text-base">
        {description}
      </p>
      {children ? <div className="mt-8">{children}</div> : null}
      {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}

function ModuleLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-[1.4rem] border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.9)] p-5 transition hover:-translate-y-0.5 hover:border-[#1B3A6B]/30 hover:bg-white"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 text-cyan-700">
          {icon}
        </div>
        <div>
          <h2 className="font-display text-xl text-[var(--dashboard-text-primary)]">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-7 text-[var(--dashboard-text-secondary)]">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const {
    initialized,
    isAuthenticated,
    onboardingComplete,
    hydrateFromStorage,
  } = useAuthStore();
  const { locale } = useTranslation();
  const t = (en: string, es: string) => (locale === 'en' ? en : es);
  const getModuleHref = (href: string) =>
    !isAuthenticated && GATED_MODULE_HREFS.has(href)
      ? buildLoginUrlForReturnUrl(href)
      : href;

  useEffect(() => {
    if (!initialized) {
      void hydrateFromStorage();
    }
  }, [hydrateFromStorage, initialized]);

  // NOTE: this deliberately does NOT redirect onboarded users into the portal.
  // It used to `router.replace(PORTAL_WORKSPACE_HREF)`, which made /dashboard
  // unreachable for every signed-in user — the module shortcuts below rendered
  // for a frame and then vanished. dd61e57c kept /dashboard as a compatibility
  // surface; a surface you cannot open is not a compatibility surface. The
  // portal remains the primary call-to-action on the page instead.

  if (!initialized) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center px-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          <p className="text-sm text-[var(--dashboard-text-secondary)]">
            {t('Loading treasury workspace...', 'Cargando workspace de tesoreria...')}
          </p>
        </div>
      </div>
    );
  }

  const moduleLinks = (
    <div className="grid gap-4 lg:grid-cols-2">
      <ModuleLink
        href="/portal"
        icon={<Upload className="h-5 w-5" />}
        title={t('Reporting workspace', 'Workspace de reportes')}
        description={t(
          'Start the upload-to-report cycle, manage jobs, and retrieve board-ready output.',
          'Inicie el ciclo de carga a informe, administre jobs y recupere salidas listas para junta.',
        )}
      />
      <ModuleLink
        href={getModuleHref('/alm')}
        icon={<ShieldCheck className="h-5 w-5" />}
        title={t('ALM and risk models', 'Modelos ALM y de riesgo')}
        description={t(
          'Keep rate, liquidity, and board narrative workflows inside the same institutional shell.',
          'Mantenga los flujos de tasas, liquidez y narrativa para junta dentro del mismo shell institucional.',
        )}
      />
    </div>
  );

  if (isAuthenticated && onboardingComplete) {
    return (
      <div className="cerniq-dashboard-page min-h-screen px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <SurfaceCard
            eyebrow={t('Command center', 'Centro de mando')}
            title={t(
              'Your institutional command center',
              'Su centro de mando institucional',
            )}
            description={t(
              'Every CERNIQ module in one place. Start with the reporting workspace to turn a balance-sheet upload into a board-ready COSSEC report, or jump straight into ALM, portfolio, and execution analytics.',
              'Todos los modulos de CERNIQ en un solo lugar. Comience con el workspace de reportes para convertir una carga de balance en un informe COSSEC listo para junta, o vaya directo a analitica ALM, de portafolio y de ejecucion.',
            )}
            actions={
              <>
                <Link
                  href={PORTAL_WORKSPACE_HREF}
                  className="inline-flex items-center gap-2 rounded-full bg-[#1B3A6B] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#163258]"
                >
                  <Upload className="h-4 w-4" />
                  {t('Continue to reporting workspace', 'Continuar al workspace de reportes')}
                </Link>
                <Link
                  href="/portal"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-6 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white"
                >
                  {t('Open report portal', 'Abrir portal de reportes')}
                </Link>
              </>
            }
          >
            {moduleLinks}
          </SurfaceCard>
        </div>
      </div>
    );
  }

  if (isAuthenticated && !onboardingComplete) {
    return (
      <div className="cerniq-dashboard-page min-h-screen px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <SurfaceCard
            eyebrow={t('Setup required', 'Configuracion requerida')}
            title={t(
              'Finish institution setup before opening the command center',
              'Complete la configuracion antes de abrir el centro de mando',
            )}
            description={t(
              'CERNIQ now behaves like a real institutional workspace, which means the institution profile needs to exist before upload, review, and delivery lanes can open.',
              'CERNIQ ahora se comporta como un workspace institucional real, lo que significa que el perfil institucional debe existir antes de abrir las rutas de carga, revision y entrega.',
            )}
            actions={
              <>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t('Complete setup', 'Completar configuracion')}
                </Link>
                <Link
                  href="/get-started"
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-6 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white"
                >
                  {t('Review pilot steps', 'Revisar pasos del piloto')}
                </Link>
              </>
            }
          >
            {moduleLinks}
          </SurfaceCard>
        </div>
      </div>
    );
  }

  return (
    <div className="cerniq-dashboard-page min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <SurfaceCard
          eyebrow={t('Institutional workspace', 'Workspace institucional')}
          title={t(
            'Open the treasury and risk command center',
            'Abra el centro de mando de tesoreria y riesgo',
          )}
          description={t(
            'CERNIQ now presents the reporting workflow as the anchor of a wider finance operating system. Sign in, open the reporting cycle, and move into portfolio, execution, and ALM surfaces from the same shell.',
            'CERNIQ ahora presenta el flujo de reportes como el ancla de un sistema financiero mas amplio. Inicie sesion, abra el ciclo de reportes y muévase hacia portafolio, ejecucion y ALM desde el mismo shell.',
          )}
          actions={
            <>
              <Link
                href={buildLoginUrlForReturnUrl('/dashboard', {
                  forceMagicLink: true,
                })}
                className="inline-flex items-center gap-2 rounded-full bg-[#1B3A6B] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#163258]"
              >
                <LockKeyhole className="h-4 w-4" />
                {t('Sign in to open workspace', 'Inicie sesion para abrir el workspace')}
              </Link>
              <Link
                href="/get-started"
                className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                {t('Start pilot', 'Comenzar piloto')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-6 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white"
              >
                {t('View interactive demo', 'Ver demo interactivo')}
              </Link>
            </>
          }
        >
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.3rem] border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7b6338]">
                {t('Primary workflow', 'Flujo primario')}
              </p>
              <p className="mt-3 font-display text-2xl text-[var(--dashboard-text-primary)]">
                {t('Upload -> Report', 'Carga -> Informe')}
              </p>
            </div>
            <div className="rounded-[1.3rem] border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7b6338]">
                {t('Secondary surfaces', 'Superficies secundarias')}
              </p>
              <p className="mt-3 font-display text-2xl text-[var(--dashboard-text-primary)]">
                {t('Portfolios + Execution', 'Portafolio + Ejecucion')}
              </p>
            </div>
            <div className="rounded-[1.3rem] border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7b6338]">
                {t('Institutional tone', 'Tono institucional')}
              </p>
              <p className="mt-3 font-display text-2xl text-[var(--dashboard-text-primary)]">
                {t('Treasury + Risk', 'Tesoreria + Riesgo')}
              </p>
            </div>
          </div>

          {moduleLinks}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.35rem] border border-[var(--dashboard-border)] bg-[rgba(247,228,188,0.48)] p-5">
              <div className="flex items-start gap-3">
                <LineChart className="mt-1 h-5 w-5 text-cyan-700" />
                <div>
                  <p className="font-semibold text-[var(--dashboard-text-primary)]">
                    {t('Why this entrypoint changed', 'Por que cambio este punto de entrada')}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--dashboard-text-secondary)]">
                    {t(
                      'The old dashboard behaved like a portal handoff. The new shell makes the reporting workflow feel like part of a broader institutional operating system.',
                      'El dashboard anterior se sentia como handoff al portal. El nuevo shell hace que el flujo de reportes se sienta parte de un sistema operativo institucional mas amplio.',
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-[1.35rem] border border-[var(--dashboard-border)] bg-[rgba(247,228,188,0.48)] p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-cyan-700" />
                <div>
                  <p className="font-semibold text-[var(--dashboard-text-primary)]">
                    {t('What stays true', 'Lo que sigue siendo cierto')}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--dashboard-text-secondary)]">
                    {t(
                      'Board-ready ALM output remains the anchor. Portfolio and execution modules now support that story instead of hiding off to the side.',
                      'La salida ALM lista para junta sigue siendo el ancla. Los modulos de portafolio y ejecucion ahora apoyan esa historia en vez de quedar escondidos.',
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
