'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { usePortal } from '../layout';
import { apiClient, type ManagedApiKey } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';
import { getFeature, type SubscriptionTier } from '@/lib/features';
import type { PortalSubscription } from '@/lib/subscription';

interface PortalSettingsResponse {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: string;
    createdAt: string;
    lastLoginAt?: string | null;
  };
  permissions: {
    canManageWorkspace: boolean;
    canManageSeats: boolean;
    canManageApiKeys: boolean;
    canManageBilling: boolean;
  };
  subscription: PortalSubscription;
  workspaceCount: number;
  workspaces: Array<{
    id: string;
    name: string;
    createdAt: string;
  }>;
  reportMetrics: {
    total: number;
    completed: number;
    inProgress: number;
    awaitingData: number;
  };
  institutionMetrics: {
    total: number;
    totalAssets: number;
  };
  institutions: Array<{
    id: string;
    name: string;
    type: string;
    totalAssets: number;
    preferredLanguage: string;
    updatedAt: string;
    workspaceId: string;
  }>;
  apiKeyCount: number;
}

interface LocalPreferences {
  language: 'es' | 'en' | 'both';
  emailReports: boolean;
  emailAlerts: boolean;
}

const PREFERENCES_STORAGE_KEY = 'cerniq_portal_preferences';

function currencyCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTierLabel(tier: string) {
  switch (tier) {
    case 'one_time':
      return 'Pilot';
    case 'monthly':
      return 'Monitoring';
    case 'annual':
      return 'Annual';
    case 'partner':
      return 'Partner';
    default:
      return 'Free';
  }
}

function defaultPreferences(): LocalPreferences {
  return {
    language: 'both',
    emailReports: true,
    emailAlerts: true,
  };
}

function getRequestMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
  ) {
    return (error as { response?: { data?: { message: string } } }).response?.data?.message || fallback;
  }

  return fallback;
}

export default function PortalSettings() {
  const { subscription } = usePortal();
  const [settings, setSettings] = useState<PortalSettingsResponse | null>(null);
  const [keys, setKeys] = useState<ManagedApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<LocalPreferences>(defaultPreferences);
  const [saved, setSaved] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'ANALYST' as 'OWNER' | 'ANALYST' | 'VIEWER' });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [keyName, setKeyName] = useState('');
  const [keyExpiryDays, setKeyExpiryDays] = useState('30');
  const [keyLoading, setKeyLoading] = useState(false);
  const [keySecret, setKeySecret] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  const tier = settings?.subscription?.tier || subscription?.tier || 'free';
  const apiAccess = getFeature((tier || 'free') as SubscriptionTier, 'apiAccess');

  useEffect(() => {
    const loadWorkspaceConsole = async () => {
      setLoading(true);
      setError('');

      try {
        const [settingsResponse, keyResponse] = await Promise.all([
          apiClient.getPortalSettings(),
          apiClient.listApiKeys(),
        ]);
        setSettings(settingsResponse);
        setKeys(keyResponse.keys || []);
      } catch {
        setError('No se pudo cargar la consola administrativa. Intente de nuevo.');
      } finally {
        setLoading(false);
      }
    };

    loadWorkspaceConsole();

    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (stored) {
        try {
          setPreferences({ ...defaultPreferences(), ...JSON.parse(stored) });
        } catch {
          window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
        }
      }
    }
  }, []);

  const activeKeys = useMemo(
    () => keys.filter((key) => !key.revokedAt),
    [keys],
  );
  const permissions = settings?.permissions || {
    canManageWorkspace: false,
    canManageSeats: false,
    canManageApiKeys: false,
    canManageBilling: false,
  };

  const handleSavePreferences = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    }
    analytics.track(EVENTS.PORTAL_SETTINGS_SAVED, { ...preferences });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setInviteLoading(true);
    setInviteMessage('');

    try {
      const invited = await apiClient.invitePortalUser({
        email: inviteForm.email.trim(),
        name: inviteForm.name.trim() || undefined,
        role: inviteForm.role,
      });
      setInviteMessage(`Provisioned secure operator access for ${invited.email}.`);
      setInviteForm({ email: '', name: '', role: 'ANALYST' });
    } catch (inviteError: unknown) {
      setInviteMessage(getRequestMessage(
        inviteError,
        'No pudimos provisionar ese acceso. Verifique el email e intente otra vez.',
      ));
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCreateKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!keyName.trim()) {
      return;
    }

    setKeyLoading(true);
    setKeySecret('');
    setCopiedSecret(false);

    try {
      const expiresInDays = keyExpiryDays.trim() ? Number(keyExpiryDays) : undefined;
      const created = await apiClient.createApiKey(
        keyName.trim(),
        Number.isFinite(expiresInDays) ? expiresInDays : undefined,
      );
      setKeys((current) => [created.record, ...current]);
      setKeySecret(created.apiKey);
      setKeyName('');
      setKeyExpiryDays('30');
    } catch {
      setError('No se pudo crear el API key. Intente de nuevo.');
    } finally {
      setKeyLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      await apiClient.revokeApiKey(keyId);
      setKeys((current) =>
        current.map((key) =>
          key.id === keyId
            ? { ...key, revokedAt: new Date().toISOString() }
            : key,
        ),
      );
    } catch {
      setError('No se pudo revocar el API key.');
    }
  };

  const copySecret = async () => {
    if (!keySecret || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(keySecret);
    setCopiedSecret(true);
    window.setTimeout(() => setCopiedSecret(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          <span className="text-sm text-slate-500">Loading workspace console...</span>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
        {error || 'No pudimos cargar la configuracion del workspace.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="cerniq-shell overflow-hidden p-3 sm:p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
          <div className="relative overflow-hidden rounded-[2rem] border border-[rgba(171,190,214,0.42)] bg-[linear-gradient(135deg,rgba(15,28,47,0.95),rgba(22,46,76,0.92)_58%,rgba(198,152,74,0.24)_100%)] p-6 text-white shadow-[0_30px_90px_rgba(19,33,53,0.26)] sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_78%_20%,rgba(237,189,91,0.32),transparent_20%),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:auto,auto,5rem_5rem,5rem_5rem]" />

            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/74">
                <Workflow className="h-3.5 w-3.5 text-[#ffd58c]" />
                Customer admin console
              </span>
              <h1 className="mt-8 font-display text-[clamp(2rem,4vw,4rem)] leading-[0.95] text-white">
                Operate CERNIQ as a subscription business workspace.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/74 sm:text-base">
                Manage your plan, secure platform access, API credentials, workspace footprint,
                and reporting defaults from one operational surface.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {permissions.canManageBilling ? (
                  <Link href="/portal/billing" className="inline-flex items-center gap-2 rounded-full bg-[#d39a2b] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(211,154,43,0.28)] transition hover:-translate-y-0.5 hover:bg-[#bb891f]">
                    Manage billing
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-5 py-3 text-sm font-semibold text-white/70">
                    Billing managed by workspace owner
                  </span>
                )}
                <Link href="/portal/submit" className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/8 px-5 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/12">
                  Open report ops
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <div className="cerniq-panel p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Plan</p>
              <p className="mt-3 font-display text-3xl text-slate-950">{formatTierLabel(settings.subscription.tier || 'free')}</p>
              <p className="mt-1 text-sm text-slate-500 capitalize">{settings.subscription.status || 'active'}</p>
            </div>
            <div className="cerniq-panel p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Reports</p>
              <p className="mt-3 font-display text-3xl text-slate-950">{settings.reportMetrics.completed}</p>
              <p className="mt-1 text-sm text-slate-500">Delivered successfully</p>
            </div>
            <div className="cerniq-panel p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Institutions</p>
              <p className="mt-3 font-display text-3xl text-slate-950">{settings.institutionMetrics.total}</p>
              <p className="mt-1 text-sm text-slate-500">{currencyCompact(settings.institutionMetrics.totalAssets)} in tracked assets</p>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-4">
          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace identity</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">{settings.user.name || settings.user.email}</h2>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-500">
                {settings.user.role}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/88 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Account</p>
                <p className="mt-3 text-sm font-medium text-slate-900">{settings.user.email}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Joined {new Date(settings.user.createdAt).toLocaleDateString()}
                </p>
                {settings.user.lastLoginAt ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Last sign-in: {new Date(settings.user.lastLoginAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/88 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Commercial state</p>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  {settings.subscription.currentPeriodEnd
                    ? `Renews ${new Date(settings.subscription.currentPeriodEnd).toLocaleDateString()}`
                    : 'No renewal date on file'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {settings.reportMetrics.inProgress} active cycle{settings.reportMetrics.inProgress === 1 ? '' : 's'} and {settings.reportMetrics.awaitingData} awaiting submission
                </p>
              </div>
            </div>
          </div>

          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace footprint</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">Operational inventory</h2>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                {settings.workspaceCount} workspace{settings.workspaceCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/88 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Workspaces</p>
                <div className="mt-3 space-y-3">
                  {settings.workspaces.length > 0 ? settings.workspaces.map((workspace) => (
                    <div key={workspace.id} className="rounded-[1.1rem] border border-slate-100 bg-slate-50/80 px-3 py-3">
                      <p className="text-sm font-medium text-slate-900">{workspace.name}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Created {new Date(workspace.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  )) : (
                    <p className="text-sm text-slate-500">No provisioned workspaces yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/88 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Institutions</p>
                <div className="mt-3 space-y-3">
                  {settings.institutions.length > 0 ? settings.institutions.map((institution) => (
                    <div key={institution.id} className="rounded-[1.1rem] border border-slate-100 bg-slate-50/80 px-3 py-3">
                      <p className="text-sm font-medium text-slate-900">{institution.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                        {institution.type.replace(/_/g, ' ')} / {institution.preferredLanguage}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{currencyCompact(institution.totalAssets)}</p>
                    </div>
                  )) : (
                    <p className="text-sm text-slate-500">Upload your first institution to populate this workspace.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-700" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Seat provisioning</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">Provision secure operator access</h2>
              </div>
            </div>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Create additional secure CERNIQ seats for analysts, viewers, or owner-level operators.
              Each provisioned seat receives a magic-link login and its own protected workspace access.
            </p>

            {!permissions.canManageSeats ? (
              <div className="mt-5 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                Workspace owners manage seat provisioning. Analysts and viewers can review the current workspace state here.
              </div>
            ) : null}

            <form onSubmit={handleInvite} className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_11rem_10rem]">
              <input
                type="email"
                required
                value={inviteForm.email}
                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="analyst@institution.com"
                disabled={!permissions.canManageSeats}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
              />
              <input
                type="text"
                value={inviteForm.name}
                onChange={(event) => setInviteForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Operator name"
                disabled={!permissions.canManageSeats}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
              />
              <select
                value={inviteForm.role}
                onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value as 'OWNER' | 'ANALYST' | 'VIEWER' }))}
                disabled={!permissions.canManageSeats}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
              >
                <option value="ANALYST">Analyst</option>
                <option value="VIEWER">Viewer</option>
                <option value="OWNER">Owner</option>
              </select>
              <button
                type="submit"
                disabled={inviteLoading || !permissions.canManageSeats}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#d39a2b] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(211,154,43,0.28)] transition hover:bg-[#bb891f] disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {inviteLoading ? 'Sending...' : 'Provision'}
              </button>
            </form>

            {inviteMessage ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {inviteMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-cyan-700" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">API access</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">Credentials and automation</h2>
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              {apiAccess.enabled
                ? 'Generate credentials for downstream integrations and controlled automation.'
                : apiAccess.upgradePrompt}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">
              {settings.apiKeyCount} active credential{settings.apiKeyCount === 1 ? '' : 's'}
            </p>

            {apiAccess.enabled ? (
              <>
                {!permissions.canManageApiKeys ? (
                  <div className="mt-5 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    API credentials can only be created or revoked by workspace owners.
                  </div>
                ) : null}
                <form onSubmit={handleCreateKey} className="mt-5 space-y-3">
                  <input
                    type="text"
                    required
                    value={keyName}
                    onChange={(event) => setKeyName(event.target.value)}
                    placeholder="Treasury sync"
                    disabled={!permissions.canManageApiKeys}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
                  />
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <input
                      type="number"
                      min="1"
                      value={keyExpiryDays}
                      onChange={(event) => setKeyExpiryDays(event.target.value)}
                      placeholder="30"
                      disabled={!permissions.canManageApiKeys}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-200/40"
                    />
                    <button
                      type="submit"
                      disabled={keyLoading || !permissions.canManageApiKeys}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1f8dff] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(31,141,255,0.24)] transition hover:bg-[#1376de] disabled:opacity-60"
                    >
                      <Plus className="h-4 w-4" />
                      {keyLoading ? 'Creating...' : 'Create key'}
                    </button>
                  </div>
                </form>

                {keySecret ? (
                  <div className="mt-4 rounded-[1.4rem] border border-cyan-200 bg-cyan-50/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Copy now</p>
                        <p className="mt-2 text-sm text-slate-700">This secret is only shown once.</p>
                      </div>
                      <button
                        type="button"
                        onClick={copySecret}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedSecret ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <code className="mt-4 block overflow-x-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs text-cyan-200">
                      {keySecret}
                    </code>
                  </div>
                ) : null}

                <div className="mt-5 space-y-3">
                  {activeKeys.length > 0 ? activeKeys.map((key) => (
                    <div key={key.id} className="rounded-[1.3rem] border border-slate-200/80 bg-white/88 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{key.name}</p>
                          <p className="mt-1 text-xs text-slate-400">{key.keyPrefix}...</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Created {new Date(key.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRevokeKey(key.id)}
                          disabled={!permissions.canManageApiKeys}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.3rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      No active API keys yet.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                Upgrade to Partner to unlock programmatic API access.
              </div>
            )}
          </div>

          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-cyan-700" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace defaults</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">Operator preferences</h2>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-[1.3rem] border border-slate-200/80 bg-white/88 p-4">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-slate-400" />
                  <p className="text-sm font-semibold text-slate-900">Default report language</p>
                </div>
                <div className="mt-4 grid gap-3">
                  {[
                    { value: 'es', label: 'Espanol' },
                    { value: 'en', label: 'English' },
                    { value: 'both', label: 'Both / Bilingual' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPreferences((current) => ({ ...current, language: option.value as LocalPreferences['language'] }))}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                        preferences.language === option.value
                          ? 'border-cyan-300 bg-cyan-50 text-cyan-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span>{option.label}</span>
                      {preferences.language === option.value ? <CheckCircle2 className="h-4 w-4" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.3rem] border border-slate-200/80 bg-white/88 p-4">
                <div className="space-y-4">
                  <label className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Report ready emails</p>
                      <p className="text-xs text-slate-400">Notify operators when reports are delivered.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.emailReports}
                      onChange={(event) => setPreferences((current) => ({ ...current, emailReports: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-300"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Threshold alerts</p>
                      <p className="text-xs text-slate-400">Flag pending ratio drift and upcoming operational risk.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.emailAlerts}
                      onChange={(event) => setPreferences((current) => ({ ...current, emailAlerts: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-300"
                    />
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSavePreferences}
                disabled={!permissions.canManageWorkspace}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Save className="h-4 w-4" />
                Save workspace defaults
              </button>
              {saved ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved in this browser
                </div>
              ) : null}
            </div>
          </div>

          <div className="cerniq-panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-700" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Commercial coverage</p>
                <h2 className="mt-2 font-display text-2xl text-slate-950">Plan capabilities</h2>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {[
                {
                  title: 'Report operations',
                  active: true,
                  detail: 'Upload data, validate files, and deliver bilingual ALM output.',
                },
                {
                  title: 'Trend monitoring',
                  active: getFeature((tier || 'free') as SubscriptionTier, 'trendCharts').enabled,
                  detail: 'Quarter-over-quarter tracking and monitoring workflows.',
                },
                {
                  title: 'API integrations',
                  active: apiAccess.enabled,
                  detail: 'Programmatic workflows and connected systems.',
                },
                {
                  title: 'Board presentation kit',
                  active: getFeature((tier || 'free') as SubscriptionTier, 'boardPresentation').enabled,
                  detail: 'Executive-ready delivery assets for annual and partner plans.',
                },
              ].map((capability) => (
                <div key={capability.title} className="rounded-[1.3rem] border border-slate-200/80 bg-white/88 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{capability.title}</p>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${capability.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {capability.active ? 'Active' : 'Locked'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{capability.detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-[1.3rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              Need to change plan economics or payment method?
              <Link href="/portal/billing" className="ml-1 font-semibold text-[#0f5681] hover:underline">
                Open billing workspace.
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
