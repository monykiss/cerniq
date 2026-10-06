"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, FileText, Lock, Upload } from "lucide-react";
import { apiClient } from "@/lib/api";
import { buildLoginUrlForReturnUrl } from "@/lib/auth-redirect";
import { createCheckoutSession } from "@/lib/billing";
import { useAuthStore } from "@/lib/store";
import {
  hasPlatformAccess,
  normalizePlatformAccess,
  prefersPortalExperience,
} from "@/lib/access";
import { rememberPortalUser } from "@/lib/subscription";
import { getAcquisitionCopy } from "@/lib/acquisition-copy";

const INSTITUTION_OPTIONS = [
  { value: "", label: "Institution type" },
  { value: "cooperativa", label: "Cooperativa" },
  { value: "credit_union", label: "Credit Union" },
  { value: "community_bank", label: "Community Bank" },
  { value: "cpa_consultant", label: "CPA / Consulting Firm" },
  { value: "other", label: "Other" },
];

function samplePreviewHref(institutionType: string) {
  return institutionType === "cooperativa"
    ? "/demo?preset=cooperativa"
    : "/demo";
}

export default function GetStartedPage() {
  const router = useRouter();
  const acquisition = getAcquisitionCopy("en");
  const { initialized, isAuthenticated, user, access, setAccess } =
    useAuthStore();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [totalAssets, setTotalAssets] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    if (!initialized || !isAuthenticated || access) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const profile = await apiClient.getCurrentUser();
        const nextAccess = normalizePlatformAccess(
          typeof profile === "object" && profile !== null && "access" in profile
            ? (profile as { access?: unknown }).access
            : null,
        );
        if (!cancelled) {
          setAccess(nextAccess);
        }
      } catch {
        // Keep the intake page usable even if profile refresh fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialized, isAuthenticated, access, setAccess]);

  useEffect(() => {
    if (!initialized || !isAuthenticated || !access) {
      return;
    }

    if (hasPlatformAccess(access) && prefersPortalExperience(access)) {
      rememberPortalUser();
      router.replace("/portal");
    }
  }, [initialized, isAuthenticated, access, router]);

  const previewHref = useMemo(
    () => samplePreviewHref(institutionType),
    [institutionType],
  );

  const launchCheckout = async () => {
    setCheckoutLoading(true);
    setError("");
    try {
      const checkoutUrl = await createCheckoutSession({
        tier: "one_time",
        customerEmail: email || user?.email,
        customerName: name || user?.name,
        institutionName,
        leadId: leadId || undefined,
        successUrl: buildLoginUrlForReturnUrl("/portal?welcome=1", {
          billingSuccess: true,
          forceMagicLink: true,
        }),
        cancelUrl: "/get-started",
      });
      window.location.href = checkoutUrl;
    } catch {
      setError("Unable to start checkout right now. Please retry.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const intake = await apiClient.submitDemoRequest({
        email,
        name,
        institutionName,
        institutionType,
        totalAssets,
        message: "New-user pilot intake from /get-started",
      });
      setLeadId(intake.leadId);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save your intake details right now.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const blockedByPayment =
    initialized && isAuthenticated && access && !hasPlatformAccess(access);

  return (
    <div className="cerniq-dashboard-page min-h-screen text-[var(--dashboard-text-primary)]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
            {acquisition.getStartedEyebrow}
          </p>
          <h1 className="mt-4 font-display text-4xl leading-tight text-white sm:text-5xl">
            {acquisition.getStartedTitle}
          </h1>
          <p className="mt-5 text-base leading-8 text-slate-300">
            {acquisition.getStartedBody}
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="cerniq-dashboard-elevated-surface rounded-3xl border p-6">
            <h2 className="text-xl font-semibold text-white">
              {blockedByPayment
                ? acquisition.primaryCta
                : submitted
                  ? acquisition.pilotFormSuccessTitle
                  : acquisition.pilotFormHeading}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--dashboard-text-secondary)]">
              {blockedByPayment
                ? "Your account is recognized, but the portal workspace unlocks only after the pilot is activated."
                : submitted
                  ? acquisition.pilotFormSuccessBody
                  : acquisition.pilotFormIntro}
            </p>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {!submitted && !blockedByPayment ? (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@institution.com"
                className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
                <input
                  type="text"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  placeholder="Institution name"
                className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
                <select
                  value={institutionType}
                  onChange={(e) => setInstitutionType(e.target.value)}
                className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 text-[var(--dashboard-text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                >
                  {INSTITUTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={totalAssets}
                  onChange={(e) => setTotalAssets(e.target.value)}
                  placeholder="Total assets (optional)"
                className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-4 py-3 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
                >
                  {submitting ? "Saving pilot intake..." : acquisition.pilotFormSubmit}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-cyan-300" />
                    <div>
                      <p className="font-semibold text-[var(--dashboard-text-primary)]">
                        {blockedByPayment
                          ? "Secure upload is the next step"
                          : acquisition.pilotFormSuccessTitle}
                      </p>
                      <p className="mt-1 text-sm text-[var(--dashboard-text-secondary)]">
                        {blockedByPayment
                          ? "Activate the pilot and we will land you directly in the portal workspace for secure upload."
                          : "Preview the report style now or activate the pilot to unlock your portal workspace and secure upload flow."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href={previewHref}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-5 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white"
                  >
                    <FileText className="h-4 w-4" />
                    Preview sample output
                  </Link>
                  <button
                    onClick={launchCheckout}
                    disabled={checkoutLoading}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                  >
                    <Lock className="h-4 w-4" />
                    {checkoutLoading
                      ? "Opening checkout..."
                      : acquisition.primaryCtaWithPrice}
                  </button>
                  <Link
                    href={buildLoginUrlForReturnUrl("/portal", {
                      forceMagicLink: true,
                    })}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-5 py-3 text-sm font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white"
                  >
                    <Upload className="h-4 w-4" />
                    Already paid? Open workspace
                  </Link>
                </div>
              </div>
            )}
          </section>

          <section className="cerniq-dashboard-elevated-surface rounded-3xl border p-6">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--dashboard-text-muted)]">
              Deterministic states
            </p>
            <div className="mt-5 space-y-4">
              <StateCard
                title="1. Sample preview"
                description="Use the public preview to judge report quality before purchase."
              />
              <StateCard
                title="2. Start pilot"
                description="Pilot users unlock the portal workspace and land directly in `/portal` for secure upload."
              />
              <StateCard
                title="3. Upgrade to recurring access"
                description="Once the pilot is trusted, recurring access becomes the only upgrade message in the funnel."
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StateCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="cerniq-dashboard-muted-surface rounded-2xl border p-4">
      <p className="font-semibold text-[var(--dashboard-text-primary)]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--dashboard-text-secondary)]">{description}</p>
    </div>
  );
}
