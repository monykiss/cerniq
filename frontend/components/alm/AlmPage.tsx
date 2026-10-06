"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { useALM } from "@/components/alm/ALMProvider";
import { useTranslation, type Locale } from "@/lib/i18n";
import {
  useAlmEndpoint,
  formatAlmError,
  type UseAlmEndpointOptions,
  type AlmEndpointState,
} from "@/hooks/useAlmEndpoint";
import {
  getAlmModule,
  type AlmModule,
  type AlmModuleSlug,
} from "@/lib/alm/registry";
import { AlmModuleHeader, type AlmIconTint } from "./AlmModuleHeader";
import { AlmPageSkeleton } from "./AlmPageSkeleton";
import { NoInstitutionPrompt } from "./NoInstitutionPrompt";

/**
 * AlmPage — render-prop shell for every ALM module page.
 *
 * Removes ~50 LoC of boilerplate per module by handling:
 *   - Registry-derived header (icon, bilingual name, description, status badge)
 *   - useALM() institutionId wiring
 *   - useTranslation() locale wiring
 *   - useAlmEndpoint data fetch via registry endpoint
 *   - Loading state (spinner with role=status + aria-live)
 *   - Error state (bilingual message + retry button)
 *   - Demo banner when source === 'demo'
 *   - Controls slot in the header (for selectors like confidence/horizon)
 *
 * Usage:
 *
 *     export default function CeclPage() {
 *       const [method, setMethod] = useState<'warm' | 'vintage' | 'pd-lgd'>('warm');
 *       return (
 *         <AlmPage<CeclResult>
 *           slug="cecl"
 *           validate={validateCeclResult}
 *           queryParams={{ method }}
 *           deps={[method]}
 *           getDemo={() => makeDemoCecl(method)}
 *           controls={
 *             <MethodSelect value={method} onChange={setMethod} />
 *           }
 *         >
 *           {(data, { locale }) => (
 *             <>
 *               <MetricStrip items={...} locale={locale} />
 *               <DataTable ... />
 *             </>
 *           )}
 *         </AlmPage>
 *       );
 *     }
 *
 * Children receive `(data, ctx)` where `ctx` gives you `{ locale, mod, isDemo }`.
 * The children render-prop is ONLY called when state.status === 'success'.
 */

export interface AlmPageContext {
  readonly locale: Locale;
  readonly mod: AlmModule;
  readonly isDemo: boolean;
}

export interface AlmPageProps<T> extends Omit<
  UseAlmEndpointOptions<T>,
  "institutionId"
> {
  readonly slug: AlmModuleSlug;
  /**
   * Render prop invoked with the typed data once the fetch succeeds. Use a
   * separate child component if you need to call hooks (useMemo/useState)
   * on the data — the render prop itself cannot call hooks.
   */
  readonly children: (data: T, ctx: AlmPageContext) => ReactNode;
  /**
   * Optional controls (selectors, toggles) rendered in the top-right of the
   * header. Visible in all states (loading/error/success) so users can
   * adjust inputs even while the previous fetch is pending.
   */
  readonly controls?: ReactNode;
  /**
   * Optional tailwind class override for the outer container. Defaults to
   * `p-6 space-y-4 max-w-[1500px] mx-auto`.
   */
  readonly className?: string;
  /**
   * Icon tint for the header icon box. Accepts any tailwind color name
   * that has a {-50, -200, -700} set. Defaults to 'slate'.
   */
  readonly iconTint?: AlmIconTint;
  /**
   * Override the institutionId. By default reads from ALMProvider context.
   */
  readonly institutionIdOverride?: string | null;
}

export function AlmPage<T>({
  slug,
  validate,
  getDemo,
  deps,
  queryParams,
  init,
  children,
  controls,
  className,
  iconTint = "slate",
  institutionIdOverride,
}: AlmPageProps<T>) {
  const alm = useALM();
  const { locale } = useTranslation();
  const institutionId =
    institutionIdOverride !== undefined
      ? institutionIdOverride
      : alm.selectedId;

  // Resolve the module at the top so it's available to header / error screens
  // even when the fetch fails with `missing-endpoint`.
  const mod = getAlmModule(slug);

  const state = useAlmEndpoint<T>(slug, {
    institutionId,
    validate,
    getDemo,
    deps,
    queryParams,
    init,
  });

  // If the slug isn't registered at all, the hook will return a missing-endpoint
  // error — but we also can't render a sensible header. Show a hard-stop.
  if (!mod) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" role="alert">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertTriangle
            className="mx-auto h-10 w-10 text-rose-500"
            aria-hidden
          />
          <p className="mt-3 text-sm font-semibold text-rose-900">
            Module &quot;{slug}&quot; is not registered
          </p>
          <p className="mt-1 text-xs text-rose-700">
            Add an entry to <code>lib/alm/registry.ts</code> to render this
            page.
          </p>
        </div>
      </div>
    );
  }

  const containerClass = className ?? "p-6 space-y-4 max-w-[1500px] mx-auto";
  const isDemo = state.status === "success" && state.source === "demo";

  return (
    <div className={containerClass}>
      {isDemo ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          role="note"
        >
          <strong>
            {locale === "es" ? "Datos de muestra" : "Sample data"}
          </strong>
          {" — "}
          {locale === "es"
            ? "Conecte su institución para análisis en vivo."
            : "Connect your institution for live analysis."}
        </div>
      ) : null}

      {/* Header — present in every state. Controls stay interactive even when
          the main content area is loading or errored. */}
      <AlmModuleHeader slug={slug} controls={controls} iconTint={iconTint} />

      {/* Content area — swaps based on state */}
      <AlmPageContent state={state} locale={locale} mod={mod}>
        {(data, ctx) => children(data, ctx)}
      </AlmPageContent>
    </div>
  );
}

// ─── Content area — loading/error/success dispatcher ────────────────────────

interface AlmPageContentProps<T> {
  readonly state: AlmEndpointState<T>;
  readonly locale: Locale;
  readonly mod: AlmModule;
  readonly children: (data: T, ctx: AlmPageContext) => ReactNode;
}

function AlmPageContent<T>({
  state,
  locale,
  mod,
  children,
}: AlmPageContentProps<T>) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <AlmPageSkeleton
        label={
          locale === "es" ? `Cargando ${mod.name.es}` : `Loading ${mod.name.en}`
        }
      />
    );
  }

  if (state.status === "error") {
    // `no-institution` is not a failure of this panel — the workspace simply
    // has no book yet, and EVERY panel hits it simultaneously. Rendering it as
    // a red error with a Retry button is a dead end: retrying cannot conjure
    // an institution. Route it to an actionable empty state instead. Landing
    // it here means all ~35 AlmPage-backed panels get the affordance at once.
    if (state.error.kind === "no-institution") {
      return <NoInstitutionPrompt locale={locale} />;
    }

    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center"
          role="alert"
        >
          <AlertTriangle
            className="mx-auto h-10 w-10 text-rose-500"
            aria-hidden
          />
          <p className="mt-3 text-sm font-semibold text-rose-900">
            {locale === "es"
              ? `No se pudo cargar ${mod.name.es}`
              : `Could not load ${mod.name.en}`}
          </p>
          <p className="mt-1 text-xs text-rose-700">
            {formatAlmError(state.error, locale)}
          </p>
          {/* retry is a synchronous nonce-bump (useAlmEndpoint) that swaps this
              branch for the loading skeleton — there is no per-button async
              state to track, so aria-busy is a static false baseline. ~35 ALM
              pages render their error state through this shell, so the a11y
              parity lands for all of them here. */}
          <button
            type="button"
            onClick={state.retry}
            aria-busy={false}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {locale === "es" ? "Reintentar" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  // state.status === 'success'
  const ctx: AlmPageContext = {
    locale,
    mod,
    isDemo: state.source === "demo",
  };
  return <>{children(state.data, ctx)}</>;
}
