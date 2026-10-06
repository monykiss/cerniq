'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_NODE_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  ''
).trim().replace(/\/+$/, '');

function ThankYouContent() {
  const searchParams = useSearchParams();
  const scoreStr = searchParams.get('score');
  const jobId = searchParams.get('jobId');
  const error = searchParams.get('error');

  const score = scoreStr ? parseInt(scoreStr, 10) : null;
  const isPromoter = score !== null && score >= 9;
  const isDetractor = score !== null && score <= 6;

  const [comment, setComment] = useState('');
  const [contactOk, setContactOk] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!comment.trim() || !jobId) return;
    setSubmitting(true);
    try {
      await fetch(`${API_BASE_URL}/api/feedback/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, comment: comment.trim(), contactOk }),
      });
      setSubmitted(true);
    } catch {
      // Silently handle — best effort
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center px-4">
        <div className="cerniq-dashboard-elevated-surface max-w-md w-full rounded-2xl p-8 text-center shadow-xl">
          <div className="text-4xl mb-4">!</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Something went wrong</h1>
          <p className="text-slate-500">
            We could not record your feedback. Please try again or contact us at hello@cerniq.io.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center px-4">
      <div className="cerniq-dashboard-elevated-surface max-w-lg w-full rounded-2xl p-8 shadow-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            Thank you for your feedback
          </h1>
          <p className="text-slate-500 mt-1">Gracias por su respuesta</p>
          {score !== null && (
            <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-full">
              <span className="text-sm text-slate-600">Your score / Su puntuacion:</span>
              <span className={`text-lg font-bold ${
                isPromoter ? 'text-green-600' : isDetractor ? 'text-red-600' : 'text-amber-600'
              }`}>
                {score}/10
              </span>
            </div>
          )}
        </div>

        {/* Follow-up form */}
        {!submitted && jobId && (
          <div className="border-t border-slate-200 pt-6">
            {isPromoter && (
              <>
                <h2 className="text-lg font-semibold text-slate-800 mb-2">
                  Nos alegra mucho escucharlo.
                </h2>
                <p className="text-slate-600 text-sm mb-4">
                  Nos encantaria si pudiera compartir un breve testimonio. Su opinion nos ayuda a servir mejor a otras cooperativas.
                </p>
                <p className="text-slate-500 text-xs mb-3 italic">
                  We are thrilled to hear that. Would you mind sharing a brief testimonial? Your feedback helps us serve other cooperativas better.
                </p>
              </>
            )}
            {isDetractor && (
              <>
                <h2 className="text-lg font-semibold text-slate-800 mb-2">
                  Gracias por su honestidad.
                </h2>
                <p className="text-slate-600 text-sm mb-4">
                  Queremos mejorar. Por favor comparta que podemos hacer mejor para que su experiencia sea excelente.
                </p>
                <p className="text-slate-500 text-xs mb-3 italic">
                  Thank you for your honesty. We want to improve. Please share how we can do better to make your experience excellent.
                </p>
              </>
            )}
            {!isPromoter && !isDetractor && score !== null && (
              <>
                <h2 className="text-lg font-semibold text-slate-800 mb-2">
                  Gracias.
                </h2>
                <p className="text-slate-600 text-sm mb-4">
                  Tiene algun comentario adicional que nos ayude a mejorar?
                </p>
                <p className="text-slate-500 text-xs mb-3 italic">
                  Any additional comments to help us improve?
                </p>
              </>
            )}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={isPromoter
                ? 'Share your experience... / Comparta su experiencia...'
                : 'How can we improve? / Como podemos mejorar?'
              }
              rows={4}
              className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-[#1B3A6B] focus:border-transparent resize-none"
            />

            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={contactOk}
                onChange={(e) => setContactOk(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-[#1B3A6B] focus:ring-[#1B3A6B]"
              />
              <span className="text-sm text-slate-600">
                You may contact me to discuss my feedback / Pueden contactarme para discutir mis comentarios
              </span>
            </label>

            <button
              onClick={handleSubmit}
              disabled={!comment.trim() || submitting}
              className="mt-4 w-full py-3 px-4 bg-[#1B3A6B] text-white font-semibold rounded-lg hover:bg-[#15305A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit feedback / Enviar comentario'}
            </button>
          </div>
        )}

        {/* Submitted confirmation */}
        {submitted && (
          <div className="border-t border-slate-200 pt-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-slate-700 font-medium">Comment received / Comentario recibido</p>
            <p className="text-slate-500 text-sm mt-1">Thank you for taking the time. / Gracias por tomarse el tiempo.</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-100 text-center">
          <Link
            href="/"
            className="text-sm text-[#1B3A6B] hover:underline font-medium"
          >
            Return to CERNIQ / Volver a CERNIQ
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div className="cerniq-dashboard-page flex min-h-screen items-center justify-center">
        <div className="text-lg text-[var(--dashboard-text-primary)]">Loading...</div>
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  );
}
