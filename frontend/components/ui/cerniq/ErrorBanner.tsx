'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ErrorBannerProps {
  error: string;
  titleEs?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, titleEs, onRetry, onDismiss }: ErrorBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-5 py-4">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-5 w-5 text-red-600" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-800">{error}</p>
          {titleEs && (
            <p className="mt-0.5 text-xs text-red-600">{titleEs}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                Try again / Intente de nuevo
              </button>
            )}
            <a
              href="mailto:hello@cerniq.io"
              className="text-xs font-medium text-red-500 underline hover:text-red-700"
            >
              Contact support / Contacte soporte: hello@cerniq.io
            </a>
          </div>
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 rounded-full p-1 text-red-400 transition hover:bg-red-100 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
