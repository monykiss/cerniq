'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, KeyRound, Mail } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

function ResetShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#071122] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-lg items-center justify-center">
        <div className="w-full rounded-[2rem] border border-[#3b4f72] bg-[#121c33]/96 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') || '').trim();
  const initialEmail = (searchParams.get('email') || '').trim();
  const mode = useMemo(() => (token ? 'confirm' : 'request'), [token]);

  const [email, setEmail] = useState(initialEmail);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handleRequestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiClient.requestPasswordReset(email);
      setSent(true);
    } catch (requestError: unknown) {
      setError(
        getApiErrorMessage(
          requestError,
          'We could not send the reset link right now. Please try again.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!token) {
      setError('Reset token is missing. Request a new reset link and try again.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await apiClient.confirmPasswordReset(token, newPassword);
      setCompleted(true);
      window.setTimeout(() => {
        router.push('/login');
      }, 1200);
    } catch (resetError: unknown) {
      setError(
        getApiErrorMessage(
          resetError,
          'We could not reset your password. Request a new email and try again.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResetShell>
      <div className="mb-8">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm text-cyan-300 transition hover:text-cyan-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>

      {mode === 'request' ? (
        <>
          <div className="mb-8 space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-300">
              <Mail className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-semibold text-white">Reset your password</h1>
            <p className="text-sm leading-6 text-slate-300">
              Enter the email for your CERNIQ account and we will send you a secure password reset link.
            </p>
          </div>

          {sent ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
              If that email exists, a reset link has been sent. Check your inbox and spam folder.
            </div>
          ) : (
            <form onSubmit={handleRequestReset} className="space-y-5">
              <div>
                <label htmlFor="reset-email" className="mb-2 block text-sm font-medium text-slate-200">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-2xl border border-[#41577d] bg-[#202a43] px-5 py-4 text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="name@institution.com"
                  required
                  autoComplete="email"
                />
              </div>

              {error ? (
                <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-sky-500 px-5 py-4 text-lg font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <div className="mb-8 space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-300">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-3xl font-semibold text-white">Create a new password</h1>
            <p className="text-sm leading-6 text-slate-300">
              Choose a new password for your CERNIQ account. After saving it, you can sign in normally with email and password.
            </p>
          </div>

          {completed ? (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5" />
                Password updated. Redirecting you to sign in.
              </div>
            </div>
          ) : (
            <form onSubmit={handleConfirmReset} className="space-y-5">
              <div>
                <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-200">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-2xl border border-[#41577d] bg-[#202a43] px-5 py-4 text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="••••••••"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-slate-200">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-2xl border border-[#41577d] bg-[#202a43] px-5 py-4 text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="••••••••"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              {error ? (
                <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-sky-500 px-5 py-4 text-lg font-semibold text-slate-950 transition hover:brightness-105 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save new password'}
              </button>
            </form>
          )}
        </>
      )}
    </ResetShell>
  );
}
