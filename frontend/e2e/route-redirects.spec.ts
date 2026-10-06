/**
 * Phase-2 route reconciliation — 308 redirect integration spec.
 *
 * The `proxy.test.ts` unit spec already locks `resolveLegacyRedirect()` as
 * pure data. This spec verifies the FULL chain: request hits Next.js
 * middleware/proxy → proxy calls `NextResponse.redirect(url, 308)` →
 * the 308 + Location headers are actually emitted on the wire.
 *
 * Uses `request.fetch` with `maxRedirects: 0` so we test the REDIRECT
 * response itself, not whatever the final destination returns. That means
 * the canonical pages' auth requirements don't matter here — we only care
 * that the proxy correctly 308s to the canonical URL with query preserved.
 */

import { test, expect } from '@playwright/test';

type RedirectCase = {
  from: string;
  expected: string;
  description: string;
};

const REDIRECT_CASES: RedirectCase[] = [
  // Cockpit → ALM
  {
    from: '/decisions',
    expected: '/alm/decisions',
    description: 'legacy standalone decisions root',
  },
  {
    from: '/cockpit',
    expected: '/alm/decisions',
    description: 'cockpit root defaults to decisions',
  },
  {
    from: '/cockpit/decisions',
    expected: '/alm/decisions',
    description: 'cockpit decisions root',
  },
  {
    from: '/cockpit/dashboard',
    expected: '/alm/decisions',
    description: 'cockpit dashboard (alias for decisions)',
  },
  {
    from: '/cockpit/agents',
    expected: '/alm/agents',
    description: 'cockpit agents',
  },
  {
    from: '/cockpit/alerts',
    expected: '/alm/agents/alerts',
    description: 'cockpit alerts → agent alerts sub-route',
  },
  // Standalone agents → ALM
  {
    from: '/agents',
    expected: '/alm/agents',
    description: 'standalone agents root',
  },
  {
    from: '/agents/alerts',
    expected: '/alm/agents/alerts',
    description: 'standalone agents/alerts',
  },
  {
    from: '/agents/copilot',
    expected: '/alm/copilot',
    description: 'standalone agents/copilot',
  },
];

test.describe('Phase-2 route reconciliation (308 redirects)', () => {
  for (const { from, expected, description } of REDIRECT_CASES) {
    test(`${from} → ${expected} (${description})`, async ({ request }) => {
      const response = await request.fetch(from, { maxRedirects: 0 });

      // 308 = method-preserving permanent redirect (vs 301 which may
      // downgrade POST→GET). We pick 308 in proxy.ts for email deep-link
      // compatibility with any future POST flows.
      expect(response.status()).toBe(308);

      const location = response.headers()['location'];
      expect(location).toBeTruthy();

      // Location may be absolute or relative; normalize to pathname.
      const pathname = new URL(location!, 'http://localhost').pathname;
      expect(pathname).toBe(expected);
    });
  }

  test('preserves a path suffix after the legacy prefix (runId)', async ({
    request,
  }) => {
    const response = await request.fetch('/cockpit/decisions/run-abc123', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    const location = response.headers()['location'];
    const pathname = new URL(location!, 'http://localhost').pathname;
    expect(pathname).toBe('/alm/decisions/run-abc123');
  });

  test('preserves a query string through the redirect', async ({ request }) => {
    // The email-alert → deep-link flow: user clicks a link with
    // institutionId + runId. Both must survive the redirect.
    const response = await request.fetch(
      '/cockpit/decisions/run-xyz?institutionId=inst-42&foo=bar',
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(308);
    const location = response.headers()['location'];
    const url = new URL(location!, 'http://localhost');
    expect(url.pathname).toBe('/alm/decisions/run-xyz');
    expect(url.searchParams.get('institutionId')).toBe('inst-42');
    expect(url.searchParams.get('foo')).toBe('bar');
  });

  test('does NOT redirect an already-canonical path (/alm/decisions)', async ({
    request,
  }) => {
    const response = await request.fetch('/alm/decisions', {
      maxRedirects: 0,
    });
    // Canonical route: whatever status (200 / auth-gated / etc), must NOT
    // be 308. A 308 here would indicate a redirect loop.
    expect(response.status()).not.toBe(308);
  });

  test('does NOT redirect a partial-prefix match (/decisions-archive)', async ({
    request,
  }) => {
    // Guard against naive startsWith('/decisions') — if the resolver
    // regresses, /decisions-archive would redirect to /alm/decisions-archive
    // (a 404 at the destination). The `startsWith(from + '/')` guard in
    // resolveLegacyRedirect prevents this.
    const response = await request.fetch('/decisions-archive', {
      maxRedirects: 0,
    });
    expect(response.status()).not.toBe(308);
  });

  test('does NOT redirect an unrelated path (/pricing)', async ({ request }) => {
    const response = await request.fetch('/pricing', { maxRedirects: 0 });
    expect(response.status()).not.toBe(308);
  });
});
