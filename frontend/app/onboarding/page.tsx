'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { apiClient } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import {
  ACCESS_REQUIRED_ROUTE,
  hasPlatformAccess,
  normalizePlatformAccess,
  prefersPortalExperience,
} from '@/lib/access';
import { isRememberedPortalUser, rememberPortalUser } from '@/lib/subscription';

export default function OnboardingPage() {
  const router = useRouter();
  const {
    initialized,
    isAuthenticated,
    onboardingComplete,
    user,
    access,
    setAccess,
    setOnboardingComplete,
  } = useAuthStore();

  const [institutionName, setInstitutionName] = useState('');
  const [institutionType, setInstitutionType] = useState('cooperativa');
  const [primaryRegulator, setPrimaryRegulator] = useState<'COSSEC' | 'NCUA'>(
    'COSSEC',
  );
  const [totalAssets, setTotalAssets] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'es' | 'en' | 'both'>(
    'es',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const getSubmitErrorMessage = (submitError: unknown) => {
    if (
      typeof submitError === 'object' &&
      submitError !== null &&
      'response' in submitError &&
      typeof (submitError as { response?: { data?: { error?: unknown } } }).response?.data?.error === 'string'
    ) {
      return (submitError as { response?: { data?: { error: string } } }).response?.data?.error || 'Onboarding failed. Please retry.';
    }

    if (
      typeof submitError === 'object' &&
      submitError !== null &&
      'message' in submitError &&
      typeof (submitError as { message?: unknown }).message === 'string'
    ) {
      return (submitError as { message: string }).message;
    }

    return 'Onboarding failed. Please retry.';
  };

  useEffect(() => {
    if (!initialized) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (access && !hasPlatformAccess(access)) {
      router.replace(ACCESS_REQUIRED_ROUTE);
      return;
    }
    if (onboardingComplete) {
      router.replace('/dashboard');
      return;
    }
    // ALM/billing subscription buyers should go to the main workspace, not onboarding.
    // Check if user arrived via magic link (portal flow) or has a subscription indicator
    let cancelled = false;
    const redirectPortalUsers = async () => {
      const portalUser = typeof window !== 'undefined' &&
        (isRememberedPortalUser() ||
         new URLSearchParams(window.location.search).get('welcome') === '1');
      if (portalUser) {
        router.replace('/dashboard');
        return;
      }

      try {
        const profile = await apiClient.getCurrentUser();
        const nextAccess = normalizePlatformAccess(
          typeof profile === 'object' && profile !== null && 'access' in profile
            ? (profile as { access?: unknown }).access
            : null,
        );
        setAccess(nextAccess);

        if (!cancelled && nextAccess && !hasPlatformAccess(nextAccess)) {
          router.replace(ACCESS_REQUIRED_ROUTE);
          return;
        }

        const shouldUsePortal = Boolean(
          nextAccess?.platformAccessAllowed &&
          (isRememberedPortalUser() || prefersPortalExperience(nextAccess)),
        );

        if (!cancelled && shouldUsePortal) {
          rememberPortalUser();
          router.replace('/dashboard');
        }
      } catch {
        // If profile can't be loaded we keep the standard onboarding path.
      }
    };

    redirectPortalUsers();
    return () => {
      cancelled = true;
    };
  }, [initialized, isAuthenticated, onboardingComplete, router, access, setAccess]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setSaving(true);
    setError('');

    try {
      const trimmedInstitutionName = institutionName.trim();
      const workspaceName = trimmedInstitutionName
        ? `${trimmedInstitutionName} Workspace`
        : `${user.email.split('@')[0]} Workspace`;
      const existingWorkspaces = await apiClient.getMyWorkspaces().catch(() => []);
      const primaryWorkspace =
        Array.isArray(existingWorkspaces) && existingWorkspaces.length > 0
          ? existingWorkspaces[0]
          : await apiClient.createMyWorkspace(workspaceName);
      const numericAssets = Number(totalAssets.replace(/[^0-9.-]/g, ''));
      const createdInstitution = await apiClient.createInstitution({
        name: trimmedInstitutionName,
        type: institutionType,
        totalAssets: Number.isFinite(numericAssets) ? numericAssets : 0,
        reportingDate: new Date().toISOString().slice(0, 10),
        workspaceId: primaryWorkspace.id,
        primaryRegulator,
        preferredLanguage,
      });

      localStorage.setItem(
        `cerniq_profile_${user.id}`,
        JSON.stringify({
          institutionName: trimmedInstitutionName,
          institutionType,
          primaryRegulator,
          totalAssets: totalAssets.trim() || null,
          preferredLanguage,
          completedAt: new Date().toISOString(),
        }),
      );
      setOnboardingComplete(true);
      analytics.track(EVENTS.ONBOARDING_COMPLETED, {
        institutionType,
        primaryRegulator,
        preferredLanguage,
      });
      router.push('/dashboard');
    } catch (submitError: unknown) {
      setError(getSubmitErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  if (!initialized || !isAuthenticated || onboardingComplete) {
    return (
      <div className="cerniq-dashboard-page min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-400" />
      </div>
    );
  }

  return (
    <div className="cerniq-dashboard-page min-h-screen px-6 py-12 text-[var(--dashboard-text-primary)]">
      <div className="cerniq-dashboard-elevated-surface max-w-2xl mx-auto rounded-2xl border p-8">
        <h1 className="mb-2 text-3xl font-bold">Welcome to CERNIQ</h1>
        <p className="mb-8 text-[var(--dashboard-text-secondary)]">
          Set up your institution once so CERNIQ can route you into the correct ALM intake and reporting flow.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm text-[var(--dashboard-text-secondary)]">Institution Name</label>
            <input
              type="text"
              value={institutionName}
              onChange={(e) => setInstitutionName(e.target.value)}
              placeholder="Cooperativa de Ahorro y Credito"
              className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              required
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-[var(--dashboard-text-secondary)]">Institution Type</label>
              <select
                value={institutionType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setInstitutionType(nextType);
                  if (nextType === 'cooperativa') {
                    setPrimaryRegulator('COSSEC');
                  } else if (nextType === 'credit_union') {
                    setPrimaryRegulator('NCUA');
                  }
                }}
                className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="cooperativa">Cooperativa</option>
                <option value="credit_union">Credit Union</option>
                <option value="bank">Community Bank</option>
                <option value="family_office">Family Office</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--dashboard-text-secondary)]">Primary Regulator</label>
              <select
                value={primaryRegulator}
                onChange={(e) =>
                  setPrimaryRegulator(e.target.value as 'COSSEC' | 'NCUA')
                }
                className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="COSSEC">COSSEC</option>
                <option value="NCUA">NCUA</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-[var(--dashboard-text-secondary)]">Approximate Total Assets</label>
              <input
                type="text"
                value={totalAssets}
                onChange={(e) => setTotalAssets(e.target.value)}
                placeholder="250000000"
                className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--dashboard-text-secondary)]">Preferred Language</label>
              <select
                value={preferredLanguage}
                onChange={(e) =>
                  setPreferredLanguage(e.target.value as 'es' | 'en' | 'both')
                }
                className="w-full rounded-lg border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="es">Spanish</option>
                <option value="en">English</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-[var(--dashboard-text-secondary)]">
            Free access remains preview-first. CERNIQ will create your institution, then route you into balance-sheet intake and dry-run ALM analysis. Enterprise PDF delivery remains inside paid and demo workspace cycles.
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Provisioning Institution...' : 'Continue to Balance-Sheet Intake'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setOnboardingComplete(true);
                analytics.track(EVENTS.ONBOARDING_SKIPPED);
                router.push('/alm');
              }}
              className="rounded-lg border border-[var(--dashboard-border)] px-4 py-3 text-[var(--dashboard-text-secondary)] hover:bg-[rgba(247,228,188,0.42)] disabled:opacity-60"
            >
              Skip
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
