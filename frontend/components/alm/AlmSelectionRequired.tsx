'use client';

import { AlertTriangle, Building2 } from 'lucide-react';

interface AlmSelectionRequiredProps {
  moduleLabel?: string;
}

export default function AlmSelectionRequired({
  moduleLabel,
}: AlmSelectionRequiredProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
          <Building2 className="h-6 w-6 text-amber-700" />
        </div>
        <div className="mb-3 flex items-center justify-center gap-2 text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.22em]">
            Institution required
          </span>
        </div>
        <h2 className="text-lg font-semibold text-slate-950">
          {moduleLabel ? `Open ${moduleLabel}` : 'Open this ALM module'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Select an institution from the top bar to load live CERNIQ data for
          this module. Once an institution is selected, the page will render its
          analysis or fallback state instead of a blank warning surface.
        </p>
      </div>
    </div>
  );
}
