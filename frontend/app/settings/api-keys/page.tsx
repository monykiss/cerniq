'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, ShieldCheck, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiClient, ManagedApiKey } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type KeyStatus = 'active' | 'revoked' | 'expired';

function resolveStatus(key: ManagedApiKey): KeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) return 'expired';
  return 'active';
}

function statusStyles(status: KeyStatus): string {
  if (status === 'active') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  if (status === 'revoked') return 'text-slate-300 bg-slate-500/10 border-slate-500/30';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
}

function formatDate(raw?: string | null): string {
  if (!raw) return 'Never';
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}

function getApiKeyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const response = (error as {
      response?: {
        data?: {
          message?: unknown;
        };
      };
      message?: unknown;
    }).response;

    if (typeof response?.data?.message === 'string' && response.data.message.length > 0) {
      return response.data.message;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return fallback;
}

export default function ApiKeysPage() {
  const router = useRouter();
  const { initialized, isAuthenticated } = useAuthStore();
  const [keys, setKeys] = useState<ManagedApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('Read-only Integration');
  const [expiry, setExpiry] = useState('never');
  const [newToken, setNewToken] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!initialized) return;
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [initialized, isAuthenticated, router]);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.listApiKeys();
      setKeys(data.keys || []);
    } catch (err: unknown) {
      setError(getApiKeyErrorMessage(err, 'Failed to load API keys'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    loadKeys();
  }, [initialized, isAuthenticated, loadKeys]);

  const activeCount = useMemo(
    () => keys.filter((key) => resolveStatus(key) === 'active').length,
    [keys],
  );

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError('');
    setCopied(false);
    try {
      const expiresInDays = expiry === 'never' ? undefined : Number(expiry);
      const created = await apiClient.createApiKey(name.trim(), expiresInDays);
      setNewToken(created.apiKey);
      setName('Read-only Integration');
      setExpiry('never');
      await loadKeys();
    } catch (err: unknown) {
      setError(getApiKeyErrorMessage(err, 'Failed to create API key'));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (keyId: string) => {
    setRevokingId(keyId);
    setError('');
    try {
      await apiClient.revokeApiKey(keyId);
      await loadKeys();
    } catch (err: unknown) {
      setError(getApiKeyErrorMessage(err, 'Failed to revoke API key'));
    } finally {
      setRevokingId('');
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      setError('Failed to copy key to clipboard');
    }
  };

  if (!initialized || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-amber-500/40 border-t-amber-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">API Keys</h1>
              <p className="text-sm text-slate-400">Create and revoke read-only integration keys for your account.</p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-900 font-semibold text-sm hover:bg-amber-400 transition"
          >
            Back to Dashboard
          </Link>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <p className="text-sm text-slate-300">Keys authenticate as read-only and cannot execute write operations.</p>
          </div>
          <span className="text-xs text-slate-400">Active keys: {activeCount}</span>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={onCreate} className="rounded-xl border border-white/10 bg-slate-900/50 p-5 space-y-4">
            <h2 className="text-lg font-semibold">Create Key</h2>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Read-only Integration"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Expiration</label>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="never">Never</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">365 days</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold py-2.5 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create API Key'}
            </button>
          </form>

          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5 space-y-3">
            <h2 className="text-lg font-semibold">New Key</h2>
            {newToken ? (
              <>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  This key is shown once. Copy it now and store it securely.
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs break-all text-slate-200">
                  {newToken}
                </div>
                <button
                  type="button"
                  onClick={copyToken}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 text-sm text-slate-200 hover:bg-white/5"
                >
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy Key'}
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">No newly generated key in this session.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
          <h2 className="text-lg font-semibold mb-4">Existing Keys</h2>
          {loading ? (
            <div className="text-sm text-slate-500">Loading keys…</div>
          ) : keys.length === 0 ? (
            <div className="text-sm text-slate-500">No API keys yet.</div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const status = resolveStatus(key);
                const active = status === 'active';
                return (
                  <div key={key.id} className="rounded-lg border border-white/10 bg-slate-950/70 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white">{key.name}</p>
                        <p className="text-xs font-mono text-slate-400">{key.keyPrefix}…</p>
                      </div>
                      <span className={`text-[11px] px-2 py-1 rounded border ${statusStyles(status)}`}>
                        {status.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-xs text-slate-400">
                      <p>Created: {formatDate(key.createdAt)}</p>
                      <p>Last used: {formatDate(key.lastUsedAt)}</p>
                      <p>Expires: {formatDate(key.expiresAt)}</p>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={!active || revokingId === key.id}
                        onClick={() => onRevoke(key.id)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
