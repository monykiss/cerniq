"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { apiClient } from "@/lib/api";
import {
  clearStoredAdminKey,
  hasStoredAdminKey,
  persistAdminKey,
} from "@/lib/admin-session";

const SECTIONS = [
  {
    href: "/admin/pipeline",
    title: "Report pipeline",
    description: "Queued, running and failed report jobs with operator actions.",
  },
  {
    href: "/admin/ops",
    title: "Operations",
    description: "Recent jobs, subscription counts and slow-route metrics.",
  },
  {
    href: "/admin/audit",
    title: "Audit trail",
    description: "Immutable audit log entries for compliance review.",
  },
  {
    href: "/admin/governance",
    title: "Governance",
    description: "Governed scenarios and benchmark sets.",
  },
  {
    href: "/admin/models",
    title: "Model registry",
    description: "Registered quantitative models and validation status.",
  },
] as const;

function AdminAuth({ onAuth }: { onAuth: () => void }) {
  const [adminKey, setAdminKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError(null);

    try {
      persistAdminKey(adminKey);
      await apiClient.getAdminOps();
      onAuth();
    } catch {
      clearStoredAdminKey();
      setError("Invalid admin key");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/90 p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <Landmark className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Operator access
            </p>
            <h1 className="mt-1 text-xl font-semibold">CERNIQ Admin</h1>
          </div>
        </div>
        <label htmlFor="admin-key" className="sr-only">
          Admin key
        </label>
        <input
          id="admin-key"
          type="password"
          autoComplete="off"
          value={adminKey}
          onChange={(e) => {
            setAdminKey(e.target.value);
            setError(null);
          }}
          placeholder="Enter admin key"
          className="mb-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          autoFocus
        />
        {error ? <p className="mb-4 text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={checking || !adminKey}
          className="w-full rounded-2xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
        >
          {checking ? "Verifying..." : "Continue"}
        </button>
      </form>
    </div>
  );
}

const noopSubscribe = () => () => undefined;

export default function AdminPage() {
  // Session storage is client-only: the server snapshot always renders the
  // key prompt, and the client snapshot reflects any stored admin key.
  const hasKey = useSyncExternalStore(
    noopSubscribe,
    hasStoredAdminKey,
    () => false,
  );
  const [authOverride, setAuthOverride] = useState<boolean | null>(null);
  const authed = authOverride ?? hasKey;

  if (!authed) {
    return <AdminAuth onAuth={() => setAuthOverride(true)} />;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
          Operator access
        </p>
        <h1 className="mt-1 text-2xl font-semibold">CERNIQ Admin</h1>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="block rounded-2xl border border-white/10 bg-slate-900/80 p-5 transition hover:border-amber-400/40"
              >
                <p className="font-semibold">{section.title}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {section.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            clearStoredAdminKey();
            setAuthOverride(false);
          }}
          className="mt-8 text-sm text-slate-400 underline hover:text-slate-200"
        >
          Sign out of admin
        </button>
      </div>
    </main>
  );
}
