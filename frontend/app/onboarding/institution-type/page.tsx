'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import { Landmark, Users, Briefcase, Building, RefreshCw, ArrowRight } from 'lucide-react';

type InstitutionType = 'bank' | 'credit_union' | 'family_office' | 'cooperativa';

interface TypeOption {
  type: InstitutionType;
  icon: React.ElementType;
  title: string;
  description: string;
  size: string;
  color: string;
  borderColor: string;
}

const options: TypeOption[] = [
  {
    type: 'bank',
    icon: Landmark,
    title: 'Community Bank',
    description: 'Full ALM suite with duration gap, NII sensitivity, LCR/NSFR, and regulatory stress testing.',
    size: '$500M–$5B assets',
    color: 'from-amber-500/20 to-orange-500/10',
    borderColor: 'border-amber-500/30 hover:border-amber-400',
  },
  {
    type: 'credit_union',
    icon: Users,
    title: 'Credit Union',
    description: 'Member-focused ALM with deposit repricing, loan concentration analysis, and NCUA compliance.',
    size: '$50M–$500M assets',
    color: 'from-emerald-500/20 to-teal-500/10',
    borderColor: 'border-emerald-500/30 hover:border-emerald-400',
  },
  {
    type: 'cooperativa',
    icon: Building,
    title: 'Cooperativa PR',
    description: 'ALM para cooperativas de ahorro y crédito. COSSEC compliance, análisis de riesgo, y reportes regulatorios.',
    size: '$50M–$500M activos',
    color: 'from-cyan-500/20 to-blue-500/10',
    borderColor: 'border-cyan-500/30 hover:border-cyan-400',
  },
  {
    type: 'family_office',
    icon: Briefcase,
    title: 'Family Office',
    description: 'Portfolio-level risk with equity exposure, real estate duration, and liquidity monitoring.',
    size: '$10M–$500M AUM',
    color: 'from-purple-500/20 to-indigo-500/10',
    borderColor: 'border-purple-500/30 hover:border-purple-400',
  },
];

type PrimaryRegulator = 'COSSEC' | 'NCUA';

const regulatorOptions: Array<{ value: PrimaryRegulator; label: string; description: string }> = [
  {
    value: 'COSSEC',
    label: 'COSSEC (Puerto Rico Cooperativas)',
    description: '12-ratio framework for PR cooperativas de ahorro y credito.',
  },
  {
    value: 'NCUA',
    label: 'NCUA (US Credit Unions)',
    description: 'CAMEL framework for federally insured US credit unions.',
  },
];

export default function InstitutionTypePage() {
  const router = useRouter();
  const [selected, setSelected] = useState<InstitutionType | null>(null);
  const [regulator, setRegulator] = useState<PrimaryRegulator>('COSSEC');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showRegulatorPicker = selected === 'credit_union' || selected === 'cooperativa';

  const handleSelect = async (type: InstitutionType) => {
    setSelected(type);
    // Auto-set default regulator based on type
    if (type === 'cooperativa') setRegulator('COSSEC');
    else if (type === 'credit_union') setRegulator('NCUA');
    analytics.track(EVENTS.INSTITUTION_TYPE_SELECTED, { type });
  };

  const handleContinue = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      // Provision a real workspace before seeding. The prior `|| 'default'`
      // fallback sent a literal non-UUID string to POST /api/alm/institutions/seed,
      // which violated D1 (no silent fallbacks) and surfaced as an opaque
      // FK error on the user's first click. Mirrors the pattern in
      // /onboarding/page.tsx:142-146 — reuse the first workspace, otherwise
      // create one named for the demo type.
      const existingWorkspaces = await apiClient.getMyWorkspaces().catch(() => []);
      const primaryWorkspace =
        Array.isArray(existingWorkspaces) && existingWorkspaces.length > 0
          ? existingWorkspaces[0]
          : await apiClient.createMyWorkspace(`${selected} Demo Workspace`);
      const result = await apiClient.seedDemoInstitution(primaryWorkspace.id, selected);
      analytics.track(EVENTS.DEMO_DATA_SEEDED, {
        type: selected,
        institutionId: result.institutionId,
      });
      router.push(`/alm?id=${result.institutionId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to set up demo';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    analytics.track(EVENTS.ONBOARDING_SKIPPED, { step: 'institution-type' });
    router.push('/onboarding/balance-sheet');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/20 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">What type of institution?</h1>
          <p className="text-slate-400 max-w-md mx-auto">
            This is an optional demo shortcut. For real production data entry, use the main onboarding and balance-sheet intake flow.
          </p>
        </div>

        {/* Type Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {options.map((opt) => (
            <button
              key={opt.type}
              onClick={() => handleSelect(opt.type)}
              className={`text-left rounded-xl border-2 p-6 transition bg-gradient-to-br ${opt.color} ${opt.borderColor} ${
                selected === opt.type ? 'ring-2 ring-amber-400 border-amber-400' : ''
              }`}
            >
              <opt.icon className="h-8 w-8 text-white mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">{opt.title}</h3>
              <p className="text-sm text-slate-300 mb-3">{opt.description}</p>
              <span className="inline-block text-xs bg-white/10 text-slate-300 px-2 py-1 rounded-full">
                {opt.size}
              </span>
            </button>
          ))}
        </div>

        {/* Regulatory Framework Selector (visible for credit_union & cooperativa) */}
        {showRegulatorPicker && (
          <div className="mb-8 max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold text-white mb-3 text-center">Regulatory Framework</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {regulatorOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRegulator(opt.value)}
                  className={`text-left rounded-xl border-2 p-4 transition ${
                    regulator === opt.value
                      ? 'border-amber-400 bg-amber-500/10 ring-2 ring-amber-400/30'
                      : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
                  }`}
                >
                  <h3 className="text-sm font-bold text-white mb-1">{opt.label}</h3>
                  <p className="text-xs text-slate-400">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-slate-400 hover:text-white text-sm transition"
          >
            Skip demo — go to manual intake
          </button>
          <button
            onClick={handleContinue}
            disabled={!selected || loading}
            className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                Load Demo Data
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
