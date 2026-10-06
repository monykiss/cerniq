import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy — runs before cache/render on Fluid Compute.
 *
 * Two responsibilities:
 *   1. `/admin/*` — 404 when admin UI is disabled (env-gated).
 *   2. Legacy route redirects after the Phase 2 cockpit route
 *      reconciliation: `/decisions`, `/cockpit/*`, `/agents/*` collapse
 *      into the canonical `/alm/*` tree. Permanent 308 preserves method
 *      and body (matters for the decision-panel runId query string).
 *
 * Why 308 and not 301? 308 is the "method-preserving" permanent redirect
 * — browsers, crawlers, and Slack unfurl previews treat it as permanent
 * (so link-rot fixes propagate), while keeping POST/PUT bodies intact if
 * anything ever posts to an old URL. 301 is allowed to downgrade POST→GET.
 */

function isAdminEnabled(): boolean {
  const raw = (
    process.env.ENABLE_ADMIN ||
    process.env.NEXT_PUBLIC_ENABLE_ADMIN ||
    ''
  )
    .trim()
    .toLowerCase();

  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
}

// ─── Legacy route redirect table (Phase 2 reconciliation, 2026-04-16) ─────
//
// Maps a legacy prefix to the canonical destination. Longer prefixes are
// checked first so `/cockpit/decisions/:runId` matches before `/cockpit`.
// The redirect preserves:
//   • everything after the prefix (path suffix)
//   • the query string
// Decision panels in email alerts use `?runId=…`; those keep working.
const LEGACY_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  // Cockpit → ALM
  { from: '/cockpit/decisions', to: '/alm/decisions' },
  { from: '/cockpit/dashboard', to: '/alm/decisions' },
  { from: '/cockpit/alerts', to: '/alm/agents/alerts' },
  { from: '/cockpit/agents', to: '/alm/agents' },
  { from: '/cockpit', to: '/alm/decisions' },
  // Standalone agents → ALM
  { from: '/agents/alerts', to: '/alm/agents/alerts' },
  { from: '/agents/copilot', to: '/alm/copilot' },
  { from: '/agents', to: '/alm/agents' },
  // Standalone decisions → ALM
  { from: '/decisions', to: '/alm/decisions' },
];

/**
 * Exported for unit testing. Pure function — no request/response coupling.
 * Returns the canonical destination for a legacy path, or null when the
 * input is already canonical (or unknown).
 */
export function resolveLegacyRedirect(pathname: string): string | null {
  for (const { from, to } of LEGACY_REDIRECTS) {
    if (pathname === from || pathname.startsWith(`${from}/`)) {
      const suffix = pathname.slice(from.length);
      return `${to}${suffix}`;
    }
  }
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Admin gate
  if (pathname.startsWith('/admin')) {
    if (!isAdminEnabled()) {
      return new NextResponse('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
        },
      });
    }
    return NextResponse.next();
  }

  // 2. Legacy route redirects
  const canonical = resolveLegacyRedirect(pathname);
  if (canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    // search is preserved automatically via url.clone(); no-op but explicit:
    url.search = search;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/cockpit',
    '/cockpit/:path*',
    '/agents',
    '/agents/:path*',
    '/decisions',
    '/decisions/:path*',
  ],
};
