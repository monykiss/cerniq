"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api";
import { analytics, EVENTS } from "@/lib/analytics";
import { CerniqMark } from "@/components/brand/CerniqLogo";
import { useAuthStore } from "@/lib/store";
import { useTranslation } from "@/lib/i18n";
import {
  normalizePlatformAccess,
  resolveAuthenticatedDestination,
} from "@/lib/access";
import { getPublicApiUrl } from "@/lib/api-base";
import { sanitizePostAuthReturnUrl } from "@/lib/auth-redirect";
import { isSupabaseAuthEnabled } from "@/lib/supabase/client";
import {
  signInWithSupabaseOAuth,
  type SupabaseOAuthProvider,
} from "@/lib/supabase/session";
import { ArrowRight } from "lucide-react";

const PROFILE_RESOLUTION_DELAYS_MS =
  process.env.NODE_ENV === "test" ? [0, 1, 1] : [0, 350, 900];

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  const normalized = (raw || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

const ENABLE_GOOGLE_OAUTH = parseBooleanEnv(
  process.env.NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH,
  true,
);
const ENABLE_GITHUB_OAUTH = parseBooleanEnv(
  process.env.NEXT_PUBLIC_ENABLE_GITHUB_OAUTH,
  false,
);
const ENABLE_LOCAL_DEMO_LOGIN = parseBooleanEnv(
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO_LOGIN,
  false,
);
const LOCAL_DEMO_CREDENTIALS_KEY = "cerniq_local_demo_credentials_v1";

type LocalDemoCredentials = {
  email: string;
  password: string;
};

function isLocalDemoLoginVisible() {
  if (typeof window === "undefined") {
    return ENABLE_LOCAL_DEMO_LOGIN;
  }

  if (ENABLE_LOCAL_DEMO_LOGIN) {
    return true;
  }

  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function readLocalDemoCredentials(): LocalDemoCredentials | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = localStorage.getItem(LOCAL_DEMO_CREDENTIALS_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalDemoCredentials>;
    if (
      typeof parsed.email === "string" &&
      parsed.email &&
      typeof parsed.password === "string" &&
      parsed.password
    ) {
      return {
        email: parsed.email,
        password: parsed.password,
      };
    }
  } catch {
    localStorage.removeItem(LOCAL_DEMO_CREDENTIALS_KEY);
  }

  return null;
}

function createLocalDemoCredentials(): LocalDemoCredentials {
  // KLYTICS Rule 12: credentials (even demo-only) MUST use crypto-grade
  // randomness. Math.random is predictable from Date.now() resolution;
  // crypto.getRandomValues is the Web Crypto equivalent of node's
  // randomBytes used in backend auth paths.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );

  return {
    email: `local-demo-${hex.slice(0, 8)}@example.com`,
    password: `Cerniq!${hex.slice(8, 20)}9A`,
  };
}

function writeLocalDemoCredentials(credentials: LocalDemoCredentials) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(
    LOCAL_DEMO_CREDENTIALS_KEY,
    JSON.stringify(credentials),
  );
}

function getLocalDemoCredentials() {
  const stored = readLocalDemoCredentials();
  if (stored) {
    return stored;
  }

  const created = createLocalDemoCredentials();
  writeLocalDemoCredentials(created);
  return created;
}

function getResponseStatus(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: number } }).response?.status ===
      "number"
  ) {
    return (error as { response: { status: number } }).response.status;
  }

  return null;
}

function isUnauthorizedError(error: unknown) {
  return getResponseStatus(error) === 401;
}

function isConflictError(error: unknown) {
  return getResponseStatus(error) === 409;
}

function getAuthErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object"
  ) {
    const data = (
      error as {
        response?: {
          data?: {
            error?: string | { message?: string; detail?: string };
            message?: string;
            detail?: string;
          };
        };
      }
    ).response?.data;
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error;
    }
    if (
      typeof data?.error === "object" &&
      data.error !== null &&
      typeof data.error.message === "string" &&
      data.error.message.trim()
    ) {
      return data.error.message;
    }
    if (data?.message) {
      return data.message;
    }
    if (data?.detail) {
      return data.detail;
    }
  }

  return "Authentication failed";
}

function resolveAuthUser(
  response: Awaited<ReturnType<typeof apiClient.login>>,
  fallbackEmail: string,
) {
  if (
    response.user &&
    typeof response.user.id === "string" &&
    typeof response.user.email === "string"
  ) {
    return {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name,
    };
  }

  return {
    id:
      typeof response.user_id === "string" && response.user_id.length > 0
        ? response.user_id
        : fallbackEmail,
    email:
      typeof response.email === "string" && response.email.length > 0
        ? response.email
        : fallbackEmail,
  };
}

async function resolvePostLoginDestination({
  returnUrl,
  userId,
  setAccess,
}: {
  returnUrl: string | null;
  userId: string;
  setAccess: (access: ReturnType<typeof normalizePlatformAccess>) => void;
}) {
  const onboardingComplete =
    localStorage.getItem(`cerniq_onboarding_${userId}`) === "true";
  const normalizedReturnUrl = sanitizePostAuthReturnUrl(returnUrl);
  const fallbackDestination = normalizedReturnUrl || "/dashboard";

  for (const [index, delayMs] of PROFILE_RESOLUTION_DELAYS_MS.entries()) {
    if (delayMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }

    try {
      const profile = await apiClient.getCurrentUser();
      const access = normalizePlatformAccess(
        typeof profile === "object" && profile !== null && "access" in profile
          ? (profile as { access?: unknown }).access
          : null,
      );
      setAccess(access);

      if (!access?.platformAccessAllowed) {
        return "/access-required";
      }

      if (normalizedReturnUrl) {
        return normalizedReturnUrl;
      }

      return resolveAuthenticatedDestination({
        access,
        onboardingComplete,
      });
    } catch {
      if (index === PROFILE_RESOLUTION_DELAYS_MS.length - 1) {
        setAccess(null);
      }
    }
  }

  return fallbackDestination;
}

function LanguageToggle() {
  const { locale, setLocale } = useTranslation();

  return (
    <div
      className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
      role="group"
      aria-label="Language"
    >
      <button
        onClick={() => setLocale("en")}
        aria-label="Switch to English"
        aria-pressed={locale === "en"}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          locale === "en"
            ? "bg-cyan-400 text-slate-950"
            : "text-slate-400 hover:text-white"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale("es")}
        aria-label="Cambiar a Espanol"
        aria-pressed={locale === "es"}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          locale === "es"
            ? "bg-cyan-400 text-slate-950"
            : "text-slate-400 hover:text-white"
        }`}
      >
        ES
      </button>
    </div>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="cerniq-dashboard-page relative min-h-screen overflow-hidden text-[var(--dashboard-text-primary)]">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(216,192,139,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(216,192,139,0.18)_1px,transparent_1px)] bg-[size:140px_140px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(232,160,32,0.08),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(27,58,107,0.08),transparent_32%),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.22),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        {children}
      </div>
    </div>
  );
}

function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicEmail, setMagicEmail] = useState("");
  const [magicError, setMagicError] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [localDemoLoading, setLocalDemoLoading] = useState(false);
  const [localDemoVisible, setLocalDemoVisible] = useState(
    ENABLE_LOCAL_DEMO_LOGIN,
  );

  const {
    initialized,
    isAuthenticated,
    user,
    setAccess,
    setOnboardingComplete,
    setSession,
  } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const returnUrl = searchParams.get("returnUrl");
  const billingSuccess = searchParams.get("billing") === "success";
  const magicMode = billingSuccess || searchParams.get("mode") === "magic-link";
  const currentUserId = user?.id;
  const [oauthLoading, setOauthLoading] = useState<SupabaseOAuthProvider | null>(
    null,
  );

  // Phase 4: OAuth must originate from Supabase. The legacy Nest routes
  // (`/api/auth/{google,github}`) call `AuthService.generateTokens`, which
  // returns 410 Gone under `AUTH_DISABLE_LEGACY_MINT` — and a minted HS256
  // cookie would be rejected anyway while `AUTH_ALLOW_LEGACY=false`. We only
  // fall back to the legacy href when Supabase is not configured (local dev
  // without NEXT_PUBLIC_SUPABASE_*), never in production.
  const handleOAuthSignIn = async (provider: SupabaseOAuthProvider) => {
    setError("");
    setOauthLoading(provider);
    try {
      const safeReturnUrl = sanitizePostAuthReturnUrl(returnUrl);
      await signInWithSupabaseOAuth(
        provider,
        `${window.location.origin}/auth/callback?returnUrl=${encodeURIComponent(safeReturnUrl)}`,
      );
      // On success the browser navigates to the provider; nothing below runs.
    } catch (err) {
      setOauthLoading(null);
      setError(
        err instanceof Error
          ? err.message
          : t("login.oauthStartFailed"),
      );
    }
  };

  useEffect(() => {
    setLocalDemoVisible(isLocalDemoLoginVisible());
  }, []);

  useEffect(() => {
    const mode = searchParams.get("mode");
    if (mode === "signup") {
      setIsLogin(false);
    }

    if (!loading && initialized && isAuthenticated && currentUserId) {
      let cancelled = false;
      (async () => {
        const destination = await resolvePostLoginDestination({
          returnUrl,
          userId: currentUserId,
          setAccess,
        });
        if (!cancelled) {
          router.push(destination);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [
    searchParams,
    router,
    initialized,
    isAuthenticated,
    loading,
    returnUrl,
    currentUserId,
    setAccess,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = isLogin
        ? await apiClient.login(email, password)
        : await apiClient.register(email, password);

      const user = resolveAuthUser(response, email);

      setSession(user, null);

      analytics.identify(user.id, { email: user.email, name: user.name });
      analytics.track(isLogin ? EVENTS.LOGIN : EVENTS.SIGNUP, {
        method: "email",
      });

      const destination = await resolvePostLoginDestination({
        returnUrl,
        userId: user.id,
        setAccess,
      });
      router.push(destination);
    } catch (err: unknown) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLinkRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicEmail.trim()) {
      return;
    }

    setMagicError("");
    setMagicLoading(true);

    try {
      const res = await fetch("/api/auth/magic/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: magicEmail.trim(),
          returnUrl: sanitizePostAuthReturnUrl(returnUrl),
        }),
      });

      if (!res.ok) {
        throw new Error("Unable to send access link");
      }

      setMagicSent(true);
    } catch {
      setMagicError("Unable to send login link. Please try again.");
    } finally {
      setMagicLoading(false);
    }
  };

  const handleLocalDemoLaunch = async () => {
    setError("");
    setLocalDemoLoading(true);

    try {
      const credentials = getLocalDemoCredentials();
      let response: Awaited<ReturnType<typeof apiClient.login>>;

      try {
        response = await apiClient.login(credentials.email, credentials.password);
      } catch (loginError) {
        if (!isUnauthorizedError(loginError)) {
          throw loginError;
        } else {
          try {
            response = await apiClient.register(
              credentials.email,
              credentials.password,
              "Local Demo",
            );
          } catch (registerError) {
            if (!isConflictError(registerError)) {
              throw registerError;
            }
            response = await apiClient.login(
              credentials.email,
              credentials.password,
            );
          }
        }
      }

      const demoUser = resolveAuthUser(response, credentials.email);
      setSession(demoUser, null);

      let nextAccess = null;
      try {
        const profile = await apiClient.getCurrentUser();
        nextAccess = normalizePlatformAccess(
          typeof profile === "object" && profile !== null && "access" in profile
            ? (profile as { access?: unknown }).access
            : null,
        );
        setAccess(nextAccess);
      } catch {
        setAccess(null);
      }

      try {
        const workspaces = await apiClient.getMyWorkspaces().catch(() => []);
        const primaryWorkspace =
          Array.isArray(workspaces) && workspaces.length > 0
            ? workspaces[0]
            : await apiClient.createMyWorkspace("Local Demo Workspace");

        await apiClient.seedDemoInstitution(primaryWorkspace.id, "cooperativa");
      } catch {
        // Keep the local demo usable even if fixture seeding is unavailable.
      }

      localStorage.setItem(
        `cerniq_profile_${demoUser.id}`,
        JSON.stringify({
          institutionName: "Local Demo Cooperativa",
          institutionType: "cooperativa",
          primaryRegulator: "COSSEC",
          preferredLanguage: "es",
          completedAt: new Date().toISOString(),
        }),
      );
      setOnboardingComplete(true);

      analytics.identify(demoUser.id, {
        email: demoUser.email,
        name: demoUser.name || "Local Demo",
      });
      analytics.track(EVENTS.LOGIN, {
        method: "local_demo",
      });

      const normalizedReturnUrl = sanitizePostAuthReturnUrl(returnUrl);
      const destination =
        normalizedReturnUrl === "/onboarding" ? "/dashboard" : normalizedReturnUrl;

      if (
        !normalizedReturnUrl &&
        nextAccess &&
        !nextAccess.platformAccessAllowed
      ) {
        router.push("/access-required");
        return;
      }

      router.push(destination || "/dashboard");
    } catch (localDemoError) {
      setError(getAuthErrorMessage(localDemoError));
    } finally {
      setLocalDemoLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="cerniq-dashboard-elevated-surface w-full max-w-xl rounded-[2rem] border p-6 shadow-[0_30px_120px_rgba(113,88,40,0.18)] backdrop-blur-xl sm:p-8">
        <div className="mb-10 flex items-start justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <CerniqMark size="sm" />
            <div>
              <div className="font-display text-3xl uppercase tracking-[0.08em] text-[var(--dashboard-text-primary)]">
                Cerniq
              </div>
              <div className="text-xs uppercase tracking-[0.34em] text-cyan-700/80">
                {t("login.tagline")}
              </div>
            </div>
          </Link>
          <LanguageToggle />
        </div>

        <div className="space-y-5 text-center">
          <h1 className="font-display text-3xl text-[var(--dashboard-text-primary)]">
            {isLogin ? t("login.signInToAccount") : t("login.createAccount")}
          </h1>
          <ul className="mx-auto max-w-sm space-y-2 text-sm text-[var(--dashboard-text-secondary)]">
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {t("login.featureALM")}
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {t("login.featureRatios")}
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {t("login.featureReports")}
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {t("login.featureEncryption")}
            </li>
          </ul>
        </div>

        {localDemoVisible ? (
          <section className="mt-8 rounded-[1.75rem] border border-cyan-300/50 bg-[linear-gradient(180deg,rgba(224,247,255,0.94),rgba(255,251,239,0.92))] px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-800/80">
                  Local Demo
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--dashboard-text-primary)]">
                  Launch a seeded localhost workspace
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--dashboard-text-secondary)]">
                  Create or reuse a local demo user, mark setup complete, and
                  seed a cooperativa workspace so the login path is testable
                  without waiting on email delivery.
                </p>
              </div>
              <span className="inline-flex h-fit items-center rounded-full border border-cyan-300/80 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-900">
                Local only
              </span>
            </div>

            <button
              type="button"
              onClick={() => void handleLocalDemoLaunch()}
              disabled={localDemoLoading || loading || magicLoading}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-4 text-base font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              {localDemoLoading ? "Launching local demo..." : "Launch local demo"}
              {!localDemoLoading ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </section>
        ) : null}

        <section
          className={`mt-10 rounded-[1.75rem] border px-5 py-5 sm:px-6 ${
            magicMode
              ? "border-emerald-300/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.96),rgba(255,251,239,0.92))]"
              : "border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.82)]"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-800/80">
                Secure Workspace Access
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[var(--dashboard-text-primary)]">
                {billingSuccess
                  ? "Payment confirmed"
                  : "Need a secure sign-in link?"}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--dashboard-text-secondary)]">
                {billingSuccess
                  ? "Enter the same email you used at checkout and we will send a secure access link for your portal workspace."
                  : "Paid customers can open CERNIQ from a secure email link instead of a password. Verified links land in the portal workspace."}
              </p>
            </div>
            {magicMode ? (
              <span className="inline-flex h-fit items-center rounded-full border border-emerald-300/80 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                Dashboard-first
              </span>
            ) : null}
          </div>

          {magicSent ? (
            <div className="mt-5 rounded-2xl border border-emerald-300/70 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              If <strong>{magicEmail}</strong> has an account, we sent a secure sign-in link. It expires in 24 hours.
            </div>
          ) : (
            <form onSubmit={handleMagicLinkRequest} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="workspace-email"
                  className="mb-2 block text-sm font-medium text-[var(--dashboard-text-secondary)]"
                >
                  Work email
                </label>
                <input
                  id="workspace-email"
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-white/80 px-5 py-4 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="cfo@institution.com"
                  required
                  autoComplete="email"
                />
              </div>

              {magicError ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-700"
                >
                  {magicError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={magicLoading || !magicEmail.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--dashboard-border-strong)] bg-[var(--dashboard-surface-elevated)] px-5 py-4 text-base font-semibold text-[var(--dashboard-text-primary)] transition hover:bg-white disabled:opacity-50"
              >
                {magicLoading ? "Sending access link..." : "Email secure sign-in link"}
                {!magicLoading ? <ArrowRight className="h-4 w-4" /> : null}
              </button>
            </form>
          )}
        </section>

        <form
          onSubmit={handleSubmit}
          className="mt-10 space-y-6"
          aria-label={
            isLogin ? t("login.signInToAccount") : t("login.createAccount")
          }
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-2 block text-sm font-medium text-[var(--dashboard-text-secondary)]"
            >
              {t("login.email")}
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-5 py-4 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              placeholder={t("login.emailPlaceholder")}
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-2 block text-sm font-medium text-[var(--dashboard-text-secondary)]"
            >
              {t("login.password")}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.88)] px-5 py-4 text-[var(--dashboard-text-primary)] placeholder:text-[var(--dashboard-text-muted)] focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
            {isLogin ? (
              <div className="mt-3 text-right">
                <Link
                  href={
                    email.trim()
                      ? `/reset-password?email=${encodeURIComponent(email.trim())}`
                      : "/reset-password"
                  }
                  className="text-sm text-cyan-700 transition hover:text-cyan-600"
                >
                  {t("login.forgotPassword")}
                </Link>
              </div>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!initialized || loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-sky-500 px-5 py-4 text-lg font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-50"
          >
            {loading
              ? t("common.processing")
              : isLogin
                ? t("login.signIn")
                : t("login.signUp")}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </form>

        {ENABLE_GOOGLE_OAUTH || ENABLE_GITHUB_OAUTH ? (
          <>
            <div className="my-8 flex items-center gap-4">
              <div className="h-px flex-1 bg-white/12" />
              <span className="text-sm text-[var(--dashboard-text-muted)]">
                {t("login.orContinueWith")}
              </span>
              <div className="h-px flex-1 bg-white/12" />
            </div>

            <div
              className={`grid gap-3 ${ENABLE_GOOGLE_OAUTH && ENABLE_GITHUB_OAUTH ? "grid-cols-2" : "grid-cols-1"}`}
            >
              {ENABLE_GOOGLE_OAUTH ? (
                isSupabaseAuthEnabled() ? (
                <button
                  type="button"
                  onClick={() => void handleOAuthSignIn("google")}
                  disabled={oauthLoading !== null}
                  aria-busy={oauthLoading === "google"}
                  className="flex items-center justify-center gap-3 rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.9)] px-4 py-4 text-base font-medium text-[var(--dashboard-text-primary)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  {oauthLoading === "google"
                    ? t("login.oauthRedirecting")
                    : t("common.google")}
                </button>
                ) : (
                <a
                  href={getPublicApiUrl("/api/auth/google")}
                  className="flex items-center justify-center gap-3 rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.9)] px-4 py-4 text-base font-medium text-[var(--dashboard-text-primary)] transition hover:bg-white"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  {t("common.google")}
                </a>
                )
              ) : null}

              {ENABLE_GITHUB_OAUTH ? (
                <a
                  href={getPublicApiUrl("/api/auth/github")}
                  className="flex items-center justify-center gap-3 rounded-2xl border border-[var(--dashboard-border)] bg-[rgba(255,251,239,0.9)] px-4 py-4 text-base font-medium text-[var(--dashboard-text-primary)] transition hover:bg-white"
                >
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t("common.github")}
                </a>
              ) : null}
            </div>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setIsLogin(!isLogin)}
          className="mt-8 w-full text-center text-sm text-[var(--dashboard-text-muted)] transition hover:text-[var(--dashboard-text-primary)]"
        >
          {isLogin ? t("login.noAccount") : t("login.hasAccount")}
        </button>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/20 border-t-cyan-200" />
        </AuthShell>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
