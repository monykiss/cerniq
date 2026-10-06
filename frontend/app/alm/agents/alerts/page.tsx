'use client';

/**
 * Agent Alerts — live feed of alerts emitted by the Agent Execution Layer.
 *
 * NOT to be confused with `/alm/alerts`, which surfaces regulatory
 * circulars (COSSEC/OCIF/NCUA). This page is specifically the Vol.1
 * Risk Monitor + ALM Decision agent output: LCR breaches, duration-gap
 * drift, concentration limit breaches, etc.
 *
 * Canonical route for agent alerts after Phase 2 reconciliation.
 * Old paths (`/cockpit/alerts`, `/agents/alerts`) redirect here via
 * `frontend/proxy.ts`.
 */

import { Suspense } from 'react';
import AlertFeed from '@/components/agents/alert-feed';
import { useInstitutionId } from '@/lib/hooks/useInstitutionId';
import { useTranslation } from '@/lib/i18n';

function AlertsInner() {
  const institutionId = useInstitutionId();
  const { locale } = useTranslation();
  const isEs = locale === 'es';

  if (!institutionId) {
    return (
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-slate-700">
          {isEs ? 'Alertas de Agentes' : 'Agent Alerts'}
        </h1>
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {isEs
            ? 'Ninguna institución seleccionada. Use el selector arriba o añada '
            : 'No institution selected. Use the selector above or add '}
          <code className="font-mono">?institutionId=…</code>{' '}
          {isEs ? 'a la URL.' : 'to the URL.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AlertFeed
        institutionId={institutionId}
        locale={isEs ? 'es' : 'en'}
        showFilters
      />
    </div>
  );
}

export default function AgentAlertsPage() {
  return (
    <Suspense
      fallback={<div className="text-xs text-slate-400">Loading alerts...</div>}
    >
      <AlertsInner />
    </Suspense>
  );
}
