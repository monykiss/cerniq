'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
} from 'recharts';
import { useTranslation } from '@/lib/i18n';
import { GradeDisplay, type LetterGrade } from '@/components/wave03/grade-display';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExamCategory {
  name: string;
  nameEs: string;
  weight: number;
  score: number;
  status: 'PASS' | 'WARN' | 'FAIL';
}

interface ExamAssessment {
  overallGrade: LetterGrade;
  overallScore: number;
  examType: string;
  assessmentDate: string;
  nextExamDate: string;
  categories: ExamCategory[];
  recommendations: string[];
  recommendationsEs: string[];
}

interface HistoryEntry {
  date: string;
  score: number;
  grade: LetterGrade;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('capex_access_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ─── Demo data ──────────────────────────────────────────────────────────────

const DEMO_ASSESSMENT: ExamAssessment = {
  overallGrade: 'B',
  overallScore: 78,
  examType: 'COSSEC Comprehensive',
  assessmentDate: '2026-04-15T00:00:00Z',
  nextExamDate: '2026-07-15T00:00:00Z',
  categories: [
    { name: 'Capital Adequacy', nameEs: 'Adecuacion de Capital', weight: 12, score: 85, status: 'PASS' },
    { name: 'Asset Quality', nameEs: 'Calidad de Activos', weight: 10, score: 72, status: 'WARN' },
    { name: 'Management', nameEs: 'Gestion', weight: 8, score: 80, status: 'PASS' },
    { name: 'Earnings', nameEs: 'Rendimiento', weight: 10, score: 68, status: 'WARN' },
    { name: 'Liquidity', nameEs: 'Liquidez', weight: 12, score: 92, status: 'PASS' },
    { name: 'Sensitivity to Market Risk', nameEs: 'Sensibilidad al Riesgo', weight: 10, score: 75, status: 'PASS' },
    { name: 'Regulatory Compliance', nameEs: 'Cumplimiento Regulatorio', weight: 8, score: 88, status: 'PASS' },
    { name: 'BSA/AML', nameEs: 'BSA/AML', weight: 8, score: 90, status: 'PASS' },
    { name: 'Information Technology', nameEs: 'Tecnologia', weight: 6, score: 55, status: 'FAIL' },
    { name: 'Consumer Compliance', nameEs: 'Cumplimiento al Consumidor', weight: 6, score: 70, status: 'WARN' },
    { name: 'Trust Operations', nameEs: 'Operaciones Fiduciarias', weight: 5, score: 82, status: 'PASS' },
    { name: 'Internal Controls', nameEs: 'Controles Internos', weight: 5, score: 78, status: 'PASS' },
  ],
  recommendations: [
    'Upgrade IT infrastructure and patch management procedures (critical)',
    'Address asset quality concerns: review top 20 delinquent loans',
    'Improve earnings: reduce non-interest expense ratio by 5%',
    'Update consumer compliance training for front-line staff',
    'Document risk appetite framework for board approval',
  ],
  recommendationsEs: [
    'Actualizar infraestructura de TI y procedimientos de parches (critico)',
    'Atender calidad de activos: revisar los 20 prestamos morosos principales',
    'Mejorar rendimiento: reducir gastos no-intereses en 5%',
    'Actualizar capacitacion de cumplimiento al consumidor',
    'Documentar marco de apetito al riesgo para aprobacion de junta',
  ],
};

const DEMO_HISTORY: HistoryEntry[] = [
  { date: '2025-10-15', score: 65, grade: 'C' },
  { date: '2026-01-15', score: 71, grade: 'C' },
  { date: '2026-04-15', score: 78, grade: 'B' },
];

// ─── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'PASS' | 'WARN' | 'FAIL' }) {
  const styles = {
    PASS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    WARN: 'bg-amber-50 text-amber-700 border-amber-200',
    FAIL: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${styles[status]}`}>
      {status}
    </span>
  );
}

// ─── Bar color ──────────────────────────────────────────────────────────────

function barColor(status: 'PASS' | 'WARN' | 'FAIL'): string {
  if (status === 'PASS') return '#059669';
  if (status === 'WARN') return '#d97706';
  return '#dc2626';
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ExamPrepPage() {
  const { locale } = useTranslation();

  const [assessment, setAssessment] = useState<ExamAssessment>(DEMO_ASSESSMENT);
  const [history, setHistory] = useState<HistoryEntry[]>(DEMO_HISTORY);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [tab, setTab] = useState<'current' | 'history'>('current');

  // Fetch assessment
  useEffect(() => {
    async function fetchAssessment() {
      try {
        const instId = typeof window !== 'undefined' ? sessionStorage.getItem('institution_id') || 'demo' : 'demo';
        const res = await fetch(`${API}/api/exam-prep/${instId}/latest`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (data.overallGrade) setAssessment(data);
          if (data.history) setHistory(data.history);
        }
      } catch {
        // Use demo
      } finally {
        setLoading(false);
      }
    }
    fetchAssessment();
  }, []);

  const runAssessment = useCallback(async () => {
    setRunning(true);
    try {
      const instId = typeof window !== 'undefined' ? sessionStorage.getItem('institution_id') || 'demo' : 'demo';
      const res = await fetch(`${API}/api/exam-prep/${instId}/assess`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.overallGrade) setAssessment(data);
      }
    } catch {
      // keep existing
    } finally {
      setRunning(false);
    }
  }, []);

  const downloadEvidence = useCallback(async () => {
    setDownloading(true);
    try {
      const instId = typeof window !== 'undefined' ? sessionStorage.getItem('institution_id') || 'demo' : 'demo';
      const res = await fetch(`${API}/api/exam-prep/${instId}/evidence`, { headers: authHeaders() });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam-evidence-${instId}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // silent
    } finally {
      setDownloading(false);
    }
  }, []);

  const chartData = assessment.categories.map((c) => ({
    name: locale === 'es' ? c.nameEs : c.name,
    score: c.score,
    weight: c.weight,
    status: c.status,
  }));

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <div className="flex items-center gap-6">
            <div className="h-40 w-40 animate-pulse rounded-full bg-slate-200" />
            <div className="flex-1 space-y-3">
              <div className="h-6 w-60 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            </div>
          </div>
          <div className="h-80 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* Tabs */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setTab('current')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === 'current' ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {locale === 'es' ? 'Evaluacion Actual' : 'Current Assessment'}
          </button>
          <button
            onClick={() => setTab('history')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === 'history' ? 'bg-[#1e3a5f] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {locale === 'es' ? 'Historial' : 'History'}
          </button>
        </div>

        {tab === 'current' ? (
          <>
            {/* Top section: Grade + info */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
              {/* Grade display */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6">
                <GradeDisplay grade={assessment.overallGrade} score={assessment.overallScore} size={160} />
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {locale === 'es' ? 'Calificacion General' : 'Overall Grade'}
                </p>
              </div>

              {/* Info cards */}
              <div className="space-y-4 lg:col-span-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {locale === 'es' ? 'Tipo de Examen' : 'Exam Type'}
                      </p>
                      <p className="mt-1 text-sm font-bold text-[#1e3a5f]">{assessment.examType}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {locale === 'es' ? 'Fecha de Evaluacion' : 'Assessment Date'}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-700">{formatDate(assessment.assessmentDate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {locale === 'es' ? 'Puntuacion' : 'Score'}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-[#1e3a5f]">{assessment.overallScore}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {locale === 'es' ? 'Categorias PASS' : 'Passing Categories'}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-emerald-600">
                        {assessment.categories.filter((c) => c.status === 'PASS').length}/{assessment.categories.length}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={runAssessment}
                    disabled={running}
                    className="flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2a4f7f] disabled:opacity-50"
                  >
                    {running && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                    {locale === 'es' ? 'Ejecutar Evaluacion' : 'Run Assessment'}
                  </button>
                  <button
                    onClick={downloadEvidence}
                    disabled={downloading}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {downloading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {locale === 'es' ? 'Descargar Evidencia' : 'Download Evidence Package'}
                  </button>
                </div>
              </div>

              {/* Right panel: Next exam + recommendations */}
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600">
                    {locale === 'es' ? 'Proximo Examen' : 'Next Exam'}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-amber-700">{daysUntil(assessment.nextExamDate)}</p>
                  <p className="text-xs text-amber-600">{locale === 'es' ? 'dias restantes' : 'days remaining'}</p>
                  <p className="mt-1 text-[11px] text-amber-500">{formatDate(assessment.nextExamDate)}</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">
                    {locale === 'es' ? 'Recomendaciones' : 'Recommendations'}
                  </p>
                  <ol className="space-y-2">
                    {(locale === 'es' ? assessment.recommendationsEs : assessment.recommendations).map((rec, i) => (
                      <li key={i} className="flex gap-2 text-xs text-slate-600">
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                          {i + 1}
                        </span>
                        {rec}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>

            {/* Category breakdown chart */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 text-sm font-bold text-[#1e3a5f]">
                {locale === 'es' ? 'Desglose por Categoria (12 Categorias)' : '12-Category Breakdown'}
              </h3>
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 150, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                    formatter={(value, _name, props) => [
                      `${Number(value ?? 0)}% (${locale === 'es' ? 'Peso' : 'Weight'}: ${(props as { payload?: { weight?: number; status?: string } })?.payload?.weight ?? 0}%) - ${(props as { payload?: { weight?: number; status?: string } })?.payload?.status ?? ''}`,
                      locale === 'es' ? 'Puntuacion' : 'Score',
                    ]}
                  />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.status as 'PASS' | 'WARN' | 'FAIL')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Legend + status table */}
              <div className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 md:grid-cols-2 lg:grid-cols-3">
                {assessment.categories.map((c) => (
                  <div key={c.name} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: barColor(c.status) }}
                        aria-hidden
                      />
                      <span className="text-xs font-medium text-slate-700">
                        {locale === 'es' ? c.nameEs : c.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono tabular-nums text-slate-600">{c.score}%</span>
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* History tab */
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 text-sm font-bold text-[#1e3a5f]">
                {locale === 'es' ? 'Tendencia de Puntuacion' : 'Score Trend'}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={history.map((h) => ({ date: formatDate(h.date), score: h.score }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="score" stroke="#1e3a5f" strokeWidth={2} dot={{ fill: '#1e3a5f', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3">
                <h3 className="text-sm font-bold text-[#1e3a5f]">
                  {locale === 'es' ? 'Evaluaciones Anteriores' : 'Previous Assessments'}
                </h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Fecha' : 'Date'}
                    </th>
                    <th className="px-5 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Calificacion' : 'Grade'}
                    </th>
                    <th className="px-5 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {locale === 'es' ? 'Puntuacion' : 'Score'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h) => (
                    <tr key={h.date} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-5 py-3 text-sm text-slate-700">{formatDate(h.date)}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full font-bold text-sm ${
                          h.grade === 'A' ? 'bg-emerald-50 text-emerald-700' :
                          h.grade === 'B' ? 'bg-cyan-50 text-cyan-700' :
                          h.grade === 'C' ? 'bg-amber-50 text-amber-700' :
                          h.grade === 'D' ? 'bg-orange-50 text-orange-700' :
                          'bg-rose-50 text-rose-700'
                        }`}>
                          {h.grade}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center font-mono text-sm tabular-nums text-slate-700">{h.score}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
