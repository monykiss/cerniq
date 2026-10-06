import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from '../lib/security-headers';

/**
 * CSP regression guard.
 *
 * On 2026-08-01 production sign-in was dead for days with no error in any log:
 * Supabase auth was switched on (`NEXT_PUBLIC_SUPABASE_URL` set in the deployment), so
 * `apiClient.login()` began calling `https://<ref>.supabase.co/auth/v1/token`
 * from the browser — but `connect-src` never listed supabase.co, so the browser
 * refused the request before it left the page. Nothing server-side ever saw it.
 *
 * The failure mode is silent and total, so it is pinned here rather than left
 * to review: any origin the app must reach at runtime has to be in connect-src.
 */

const API_URL = 'https://api.example.com';

function readCsp(apiUrl: string | undefined = API_URL): string {
  const csp = buildSecurityHeaders(apiUrl).find(
    (header) => header.key.toLowerCase() === 'content-security-policy',
  );
  if (!csp) {
    throw new Error('No Content-Security-Policy header defined');
  }
  return csp.value;
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

  if (!found) {
    throw new Error(`CSP is missing the "${name}" directive`);
  }
  return found.split(/\s+/).slice(1);
}

describe('Content-Security-Policy', () => {
  it('is emitted by the shared security headers', () => {
    expect(readCsp()).toContain('default-src');
  });

  // Each entry is an origin the browser must reach for a core flow to work.
  // Removing one takes that flow down silently — hence the named reasons.
  const REQUIRED_CONNECT_SRC: Array<[string, string]> = [
    ["'self'", 'same-origin Next route handlers (/api/auth/session)'],
    ['https://api.example.com', 'the Nest API — profile, portal, direct CSV upload'],
    ['wss://api.example.com', 'report-progress websocket'],
    ['https://*.supabase.co', 'Supabase auth: password grant, magic link, OAuth code exchange'],
  ];

  it.each(REQUIRED_CONNECT_SRC)('allows %s in connect-src (%s)', (origin) => {
    expect(directive(readCsp(), 'connect-src')).toContain(origin);
  });

  it('does not fall back to a wildcard connect-src', () => {
    // `*` would make this guard vacuous and undo the policy's purpose.
    expect(directive(readCsp(), 'connect-src')).not.toContain('*');
  });

  it('omits any API origin when NEXT_PUBLIC_NODE_API_URL is not configured', () => {
    const connectSrc = directive(readCsp(''), 'connect-src');
    expect(connectSrc).not.toContain('https://api.example.com');
    expect(connectSrc).toContain("'self'");
  });

  it('keeps framing and object embedding locked down', () => {
    const csp = readCsp();
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
  });
});
