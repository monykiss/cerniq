'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';

export function DemoErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary context="demo">
      {children}
    </ErrorBoundary>
  );
}
