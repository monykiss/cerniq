import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getConfiguredApiOrigin } from '@/lib/api-base';
import { unwrapApiData } from '@/lib/api-response';

type SessionUser = {
  id: string;
  email: string;
  name?: string;
  access?: unknown;
};

export async function GET() {
  const apiOrigin = getConfiguredApiOrigin();
  if (!apiOrigin) {
    return NextResponse.json({ authenticated: false });
  }

  try {
    const headerBag = await headers();
    const cookie = headerBag.get('cookie') || '';
    // Forward the bearer token as well as the cookie. Since the Phase 4 auth
    // sunset (`AUTH_DISABLE_LEGACY_MINT=true`) the backend no longer mints an
    // `access_token` cookie, so a cookie-only probe always came back 401 and
    // this route reported `authenticated: false` for genuinely signed-in users
    // — which logged them straight back out on every page load.
    const authorization = headerBag.get('authorization') || '';
    const forwardedHeaders: Record<string, string> = {};
    if (cookie) {
      forwardedHeaders.cookie = cookie;
    }
    if (authorization) {
      forwardedHeaders.authorization = authorization;
    }

    const response = await fetch(`${apiOrigin}/api/auth/profile`, {
      headers: forwardedHeaders,
      cache: 'no-store',
    });

    if (response.status === 401) {
      return NextResponse.json({ authenticated: false });
    }

    if (!response.ok) {
      return NextResponse.json({ authenticated: false });
    }

    const user = unwrapApiData<SessionUser | null>(
      await response.json().catch(() => null),
    );

    if (!user?.id || !user.email) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({ authenticated: true, user });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
