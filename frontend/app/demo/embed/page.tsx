'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { apiClient } from '@/lib/api';
import { useSearchParams } from 'next/navigation';
import DocumentExportButtons from '@/components/exports/DocumentExportButtons';

type DemoInstitution = { id: string };
type NIIScenario = { shiftBps: number; niImpact: number };

function EmbedContent() {
  const searchParams = useSearchParams();
  const instType = searchParams.get('type') || 'cooperativa';

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<{
    name: string;
    assets: string;
    riskScore: number;
    lcr: number;
    durationGap: number;
    niiImpact: string;
    capitalRatio: number;
    cossecPassed: number;
    institutionId: string;
  } | null>(null);

  const runRef = useRef(false);

  useEffect(() => {
    if (runRef.current) return;
    runRef.current = true;

    (async () => {
      try {
        const ts = Date.now();
        const email = `embed-${ts}@cerniq.demo`;
        const password = `Embed${ts}X`;

        let loggedIn = false;
        try { await apiClient.getCurrentUser(); loggedIn = true; } catch {}
        if (!loggedIn) {
          try { await apiClient.register(email, password); }
          catch { try { await apiClient.login(email, password); } catch {} }
        }

        let workspaceId: string;
        try {
          const ws = await apiClient.getMyWorkspaces();
          workspaceId = (Array.isArray(ws) && ws.length > 0)
            ? ws[0].id
            : (await apiClient.createMyWorkspace('Embed Demo')).id;
        } catch {
          workspaceId = (await apiClient.createMyWorkspace('Embed Demo')).id;
        }

        let institutions: DemoInstitution[] = [];
        try { institutions = (await apiClient.getInstitutions()) as DemoInstitution[]; } catch {}

        let institutionId: string;
        if (institutions.length > 0) {
          institutionId = institutions[0].id;
        } else {
          const result = await apiClient.seedDemoInstitution(
            workspaceId,
            instType as 'bank' | 'credit_union' | 'family_office' | 'cooperativa',
          );
          institutionId = result?.institutionId || result?.institution?.id;
        }

        let riskScore = 72, lcr = 117.9, durationGap = 1.8, niiImpact = '-$1.2M';
        let capitalRatio = 10.0, cossecPassed = 4;
        try {
          const summary = await apiClient.getALMSummary(institutionId);
          riskScore = summary.riskScore || 72;
          lcr = summary.liquidity?.lcr || 117.9;
          durationGap = summary.durationGap?.durationGap || 1.8;
          capitalRatio = summary.capitalRatio || 10.0;
          cossecPassed = summary.cossecPassed ?? 4;
          const scenarios = summary.niiSensitivity?.scenarios as NIIScenario[] | undefined;
          const s200 = scenarios?.find((scenario) => scenario.shiftBps === 200);
          if (s200) niiImpact = `${s200.niImpact >= 0 ? '+' : '-'}$${Math.abs(s200.niImpact).toFixed(1)}M`;
        } catch {}

        const names: Record<string, string> = {
          cooperativa: 'CoopAhorro San Juan',
          bank: 'Banco Comunidad PR',
          credit_union: 'Cooperativa del Pueblo',
          family_office: 'Caribbean Family Capital',
        };
        const assetMap: Record<string, string> = {
          cooperativa: '$250M',
          bank: '$1.2B',
          credit_union: '$180M',
          family_office: '$45M',
        };

        setResults({
          name: names[instType] || names.cooperativa,
          assets: assetMap[instType] || assetMap.cooperativa,
          riskScore, lcr, durationGap, niiImpact, capitalRatio, cossecPassed, institutionId,
        });
      } catch {
        // Fallback to cached defaults
        setResults({
          name: 'CoopAhorro San Juan', assets: '$250M',
          riskScore: 72, lcr: 117.9, durationGap: 1.8, niiImpact: '-$1.2M',
          capitalRatio: 10.0, cossecPassed: 4, institutionId: '',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [instType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs text-slate-500">Loading risk profile...</p>
        </div>
      </div>
    );
  }

  if (!results) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      {/* Institution header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
          <span className="text-slate-900 font-bold text-sm">C</span>
        </div>
        <div>
          <p className="text-sm font-bold">{results.name}</p>
          <p className="text-[11px] text-slate-500">{results.assets} Assets &middot; CERNIQ</p>
        </div>
      </div>

      {/* Metrics strip */}
      <div className="bg-slate-800/60 border border-white/[0.08] rounded-xl p-4 mb-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
          <div className="text-center">
            <p className="text-slate-500 mb-1">Risk Score</p>
            <p className="text-xl font-bold tabular-nums">
              {results.riskScore}
              <span className="text-xs text-slate-500">/100</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-slate-500 mb-1">Capital</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">{results.capitalRatio.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-slate-500 mb-1">LCR</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">{results.lcr.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-slate-500 mb-1">NII (+200bp)</p>
            <p className="text-xl font-bold text-amber-400 tabular-nums">{results.niiImpact}</p>
          </div>
          <div className="text-center">
            <p className="text-slate-500 mb-1">Duration Gap</p>
            <p className="text-xl font-bold tabular-nums">{results.durationGap}yr</p>
          </div>
          <div className="text-center">
            <p className="text-slate-500 mb-1">COSSEC</p>
            <p className="text-xl font-bold text-emerald-400 tabular-nums">{results.cossecPassed}/4</p>
          </div>
        </div>
      </div>

      {/* Download buttons */}
      {results.institutionId ? (
        <DocumentExportButtons
          manifestPath={`/api/alm/${results.institutionId}/exports`}
          kinds={['alm_report']}
          className="mt-1"
        />
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-center text-xs text-slate-400">
          Export-ready documents will appear once the demo workspace finishes provisioning.
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-[10px] text-slate-600 mt-4">
        Powered by CERNIQ &middot; KLYTICS LLC &middot; {new Date().getFullYear()}
      </p>
    </div>
  );
}

export default function DemoEmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-slate-950">
          <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
        </div>
      }
    >
      <EmbedContent />
    </Suspense>
  );
}
