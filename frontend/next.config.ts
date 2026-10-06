import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import path from 'node:path';
import { buildSecurityHeaders } from './lib/security-headers';

const hasSentryReleaseAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

const monorepoRoot = path.resolve(__dirname, '..');
const isVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  ...(isVercel ? {} : { outputFileTracingRoot: monorepoRoot }),
  ...(isVercel ? {} : { turbopack: { root: monorepoRoot } }),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: buildSecurityHeaders(process.env.NEXT_PUBLIC_NODE_API_URL),
      },
    ];
  },
  async rewrites() {
    const backendUrl = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
    if (!backendUrl) {
      return [];
    }

    return [
      {
        source: '/api/:path((?!demo/track$).*)',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${backendUrl}/auth/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  ...(hasSentryReleaseAuth
    ? {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
      }
    : {}),
  silent: !process.env.CI,
  sourcemaps: {
    disable: !hasSentryReleaseAuth,
  },
  release: {
    name: hasSentryReleaseAuth ? process.env.SENTRY_RELEASE : '',
    create: hasSentryReleaseAuth,
    finalize: hasSentryReleaseAuth,
  },
});
