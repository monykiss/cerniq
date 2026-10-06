'use client';

import { ReactNode } from 'react';
import AuthInitializer from '@/components/auth/AuthInitializer';
import AnalyticsPageTracker from '@/components/analytics/AnalyticsPageTracker';
import ThemeRouteController from '@/components/ThemeRouteController';
import { TranslationProvider } from '@/lib/i18n';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary context="app-root">
      <TranslationProvider>
        <ThemeRouteController />
        <AuthInitializer />
        <AnalyticsPageTracker />
        {children}
      </TranslationProvider>
    </ErrorBoundary>
  );
}
