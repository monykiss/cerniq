'use client';

import { useState, useEffect, useMemo } from 'react';
import { useALM } from '@/components/alm/ALMProvider';
import { useTranslation } from '@/lib/i18n';
import {
  Calendar, AlertTriangle, Check, Clock, FileText,
  ChevronLeft, ChevronRight, Timer, List, CalendarDays,
  Download, Filter, XCircle,
} from 'lucide-react';

/* ─── Types ─── */
interface RequiredDocument {
  name: string;
  nameEs: string;
}
interface Deadline {
  id: string;
  title: string;
  titleEs: string;
  regulator: string;
  dueDate: string;
  status: 'completed' | 'pending' | 'overdue';
  filingType: string;
  filingTypeEs: string;
  description: string;
  descriptionEs: string;
  requiredDocuments: RequiredDocument[];
}
interface ComplianceCalendarData {
  deadlines: Deadline[];
  institutionName: string;
}

/* ─── Status Helpers ─── */
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400' },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-400' },
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  completed: Check,
  pending: Clock,
  overdue: XCircle,
};

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCountdown(days: number, locale: string): string {
  if (days < 0) return locale === 'es' ? `${Math.abs(days)}d vencido` : `${Math.abs(days)}d overdue`;
  if (days === 0) return locale === 'es' ? 'Hoy' : 'Today';
  if (days === 1) return locale === 'es' ? 'Manana' : 'Tomorrow';
  return `${days}d`;
}

/* ─── Countdown Timer Badge ─── */
function CountdownBadge({ dueDate, locale }: { dueDate: string; locale: string }) {
  const days = daysUntil(dueDate);
  const urgency = days < 0 ? 'bg-rose-500 text-white' :
    days <= 7 ? 'bg-rose-100 text-rose-700' :
    days <= 30 ? 'bg-amber-100 text-amber-700' :
    'bg-slate-100 text-slate-600';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${urgency}`}>
      <Timer className="h-2.5 w-2.5" />
      {formatCountdown(days, locale)}
    </span>
  );
}

/* ─── Calendar Mini View ─── */
function CalendarMiniView({
  deadlines, currentMonth, locale, onMonthChange,
}: {
  deadlines: Deadline[];
  currentMonth: Date;
  locale: string;
  onMonthChange: (d: Date) => void;
}) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const dayNames = locale === 'es'
    ? ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthName = new Date(year, month, 1).toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { month: 'long', year: 'numeric' });

  // Map deadline dates to statuses for this month
  const dayStatusMap = deadlines.reduce<Record<number, Deadline['status'][]>>((map, deadline) => {
    const deadlineDate = new Date(deadline.dueDate + 'T00:00:00');
    if (deadlineDate.getFullYear() === year && deadlineDate.getMonth() === month) {
      const day = deadlineDate.getDate();
      if (!map[day]) map[day] = [];
      map[day].push(deadline.status);
    }
    return map;
  }, {});

  const prevMonth = () => onMonthChange(new Date(year, month - 1, 1));
  const nextMonth = () => onMonthChange(new Date(year, month + 1, 1));

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="rounded-lg p-1.5 hover:bg-slate-100">
          <ChevronLeft className="h-4 w-4 text-slate-600" />
        </button>
        <span className="text-sm font-bold text-slate-950 capitalize">{monthName}</span>
        <button onClick={nextMonth} className="rounded-lg p-1.5 hover:bg-slate-100">
          <ChevronRight className="h-4 w-4 text-slate-600" />
        </button>
      </div>

      {/* Day Names */}
      <div className="grid grid-cols-7 mb-1">
        {dayNames.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase text-slate-400 py-1">{d}</div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const statuses = dayStatusMap[day] || [];
          const isToday = isCurrentMonth && today.getDate() === day;
          const hasOverdue = statuses.includes('overdue');
          const hasPending = statuses.includes('pending');
          const hasCompleted = statuses.includes('completed');

          return (
            <div
              key={day}
              className={`relative flex h-8 items-center justify-center rounded-lg text-xs ${
                isToday ? 'bg-cyan-600 text-white font-bold' :
                hasOverdue ? 'bg-rose-50 text-rose-700 font-semibold' :
                hasPending ? 'bg-amber-50 text-amber-700 font-semibold' :
                hasCompleted ? 'bg-emerald-50 text-emerald-700' :
                'text-slate-600'
              }`}
            >
              {day}
              {statuses.length > 0 && (
                <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                  {statuses.slice(0, 3).map((s, idx) => (
                    <div key={idx} className={`h-1 w-1 rounded-full ${
                      s === 'overdue' ? 'bg-rose-500' : s === 'pending' ? 'bg-amber-500' : 'bg-emerald-500'
                    }`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Timeline View ─── */
function TimelineView({ deadlines, locale }: { deadlines: Deadline[]; locale: string }) {
  const sorted = [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="space-y-0">
      {sorted.map((d, idx) => {
        const style = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
        const Icon = STATUS_ICONS[d.status] || Clock;
        return (
          <div key={d.id} className="flex gap-3">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${style.border} ${style.bg}`}>
                <Icon className={`h-3.5 w-3.5 ${style.text}`} />
              </div>
              {idx < sorted.length - 1 && (
                <div className="w-0.5 flex-1 bg-slate-200" />
              )}
            </div>

            {/* Content */}
            <div className="pb-5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-slate-800">
                  {locale === 'es' ? d.titleEs : d.title}
                </p>
                <CountdownBadge dueDate={d.dueDate} locale={locale} />
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {d.regulator} &middot; {d.dueDate} &middot; {locale === 'es' ? d.filingTypeEs : d.filingType}
              </p>
              {d.requiredDocuments.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {d.requiredDocuments.map((doc, di) => (
                    <span key={di} className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      <FileText className="h-2.5 w-2.5" />
                      {locale === 'es' ? doc.nameEs : doc.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main Page ─── */
export default function ComplianceCalendarPage() {
  const { selectedId } = useALM();
  const { locale } = useTranslation();
  const [data, setData] = useState<ComplianceCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'table' | 'timeline' | 'calendar'>('table');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'overdue'>('all');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const t = (en: string, es: string) => locale === 'en' ? en : es;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/compliance-calendar`);
        if (!cancelled) {
          if (res.ok) setData(await res.json());
          else setData(getDemoData());
        }
      } catch {
        if (!cancelled) setData(getDemoData());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (statusFilter === 'all') return data.deadlines;
    return data.deadlines.filter(d => d.status === statusFilter);
  }, [data, statusFilter]);

  // Nearest deadlines (non-completed, sorted by date)
  const nearestDeadlines = useMemo(() => {
    if (!data) return [];
    return data.deadlines
      .filter(d => d.status !== 'completed')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 3);
  }, [data]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
      </div>
    );
  }

  const completedCount = data.deadlines.filter(d => d.status === 'completed').length;
  const pendingCount = data.deadlines.filter(d => d.status === 'pending').length;
  const overdueCount = data.deadlines.filter(d => d.status === 'overdue').length;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50">
            <Calendar className="h-4 w-4 text-indigo-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-950">
              {t('Compliance Calendar', 'Calendario de Cumplimiento')}
            </h1>
            <p className="text-xs text-slate-500">
              {t('Regulatory deadlines, filings & required documents', 'Fechas regulatorias, radicaciones y documentos requeridos')}
            </p>
          </div>
        </div>
        <button className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
          <Download className="h-4 w-4" />
          {t('Export Calendar', 'Exportar Calendario')}
        </button>
      </div>

      {/* ─── KPI Cards + Countdown ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('Total Deadlines', 'Total Fechas')}</p>
          <p className="text-2xl font-black text-slate-950 mt-1">{data.deadlines.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">{t('Completed', 'Completadas')}</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{completedCount}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">{t('Pending', 'Pendientes')}</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">{t('Overdue', 'Vencidas')}</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{overdueCount}</p>
        </div>
      </div>

      {/* ─── Nearest Deadline Countdown Timers ─── */}
      {nearestDeadlines.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
            {t('Nearest Deadlines', 'Fechas Más Próximas')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {nearestDeadlines.map(d => {
              const days = daysUntil(d.dueDate);
              const urgencyColor = days < 0 ? 'text-rose-400' : days <= 7 ? 'text-rose-300' : days <= 30 ? 'text-amber-300' : 'text-cyan-300';
              return (
                <div key={d.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-white truncate max-w-[70%]">
                      {locale === 'es' ? d.titleEs : d.title}
                    </span>
                    <span className={`text-[10px] font-bold uppercase ${
                      d.status === 'overdue' ? 'text-rose-400' : 'text-amber-400'
                    }`}>
                      {d.status === 'overdue' ? t('OVERDUE', 'VENCIDA') : d.regulator}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-3xl font-black tabular-nums ${urgencyColor}`}>
                      {Math.abs(days)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {days < 0
                        ? t('days overdue', 'dias vencida')
                        : days === 0
                          ? t('due today!', 'vence hoy!')
                          : t('days remaining', 'dias restantes')}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{d.dueDate}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── View Switcher + Filters ─── */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {([
            { key: 'table' as const, icon: List, label: t('Table', 'Tabla') },
            { key: 'timeline' as const, icon: CalendarDays, label: t('Timeline', 'Linea de Tiempo') },
            { key: 'calendar' as const, icon: Calendar, label: t('Calendar', 'Calendario') },
          ]).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition ${
                view === v.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          {(['all', 'completed', 'pending', 'overdue'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                statusFilter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700 bg-slate-100'
              }`}
            >
              {f === 'all' ? t('All', 'Todos') :
               f === 'completed' ? t('Completed', 'Completadas') :
               f === 'pending' ? t('Pending', 'Pendientes') :
               t('Overdue', 'Vencidas')}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Table View ─── */}
      {view === 'table' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {[
                  t('Deadline', 'Fecha Limite'),
                  t('Filing', 'Radicacion'),
                  t('Regulator', 'Regulador'),
                  t('Due Date', 'Fecha'),
                  t('Countdown', 'Cuenta Regresiva'),
                  t('Status', 'Estado'),
                  t('Docs', 'Docs'),
                ].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const style = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
                const Icon = STATUS_ICONS[d.status] || Clock;
                const isExpanded = expandedRow === d.id;

                return (
                  <Fragment key={d.id}>
                    <tr
                      className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : d.id)}
                    >
                      <td className="px-3 py-2.5 text-xs font-semibold text-slate-800 max-w-[200px]">
                        {locale === 'es' ? d.titleEs : d.title}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {locale === 'es' ? d.filingTypeEs : d.filingType}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {d.regulator}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums text-slate-500">{d.dueDate}</td>
                      <td className="px-3 py-2.5">
                        <CountdownBadge dueDate={d.dueDate} locale={locale} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.bg} ${style.text} ${style.border}`}>
                          <Icon className="h-2.5 w-2.5" />
                          {d.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400 tabular-nums">{d.requiredDocuments.length}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={7} className="px-6 py-3">
                          <p className="text-[11px] text-slate-600 mb-2">
                            {locale === 'es' ? d.descriptionEs : d.description}
                          </p>
                          {d.requiredDocuments.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                {t('Required Documents', 'Documentos Requeridos')}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {d.requiredDocuments.map((doc, di) => (
                                  <span key={di} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
                                    <FileText className="h-2.5 w-2.5 text-slate-400" />
                                    {locale === 'es' ? doc.nameEs : doc.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Timeline View ─── */}
      {view === 'timeline' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <TimelineView deadlines={filtered} locale={locale} />
        </div>
      )}

      {/* ─── Calendar View ─── */}
      {view === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CalendarMiniView
            deadlines={data.deadlines}
            currentMonth={currentMonth}
            locale={locale}
            onMonthChange={setCurrentMonth}
          />
          {/* Deadlines for selected month */}
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
              {new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
                .toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { month: 'long', year: 'numeric' })}
              {' '}{t('Deadlines', 'Fechas')}
            </p>
            {(() => {
              const monthDeadlines = filtered.filter(d => {
                const dd = new Date(d.dueDate + 'T00:00:00');
                return dd.getFullYear() === currentMonth.getFullYear() && dd.getMonth() === currentMonth.getMonth();
              });
              if (monthDeadlines.length === 0) {
                return (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    {t('No deadlines this month', 'No hay fechas este mes')}
                  </p>
                );
              }
              return (
                <div className="space-y-2">
                  {monthDeadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(d => {
                    const style = STATUS_STYLES[d.status] || STATUS_STYLES.pending;
                    const Icon = STATUS_ICONS[d.status] || Clock;
                    return (
                      <div key={d.id} className={`flex items-center gap-3 rounded-lg border p-3 ${style.bg} ${style.border}`}>
                        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-white border border-slate-200">
                          <span className="text-[9px] font-semibold uppercase text-slate-400">
                            {new Date(d.dueDate + 'T00:00:00').toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { month: 'short' })}
                          </span>
                          <span className="text-sm font-black text-slate-800">
                            {new Date(d.dueDate + 'T00:00:00').getDate()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800">{locale === 'es' ? d.titleEs : d.title}</p>
                          <p className="text-[10px] text-slate-500">{d.regulator} &middot; {locale === 'es' ? d.filingTypeEs : d.filingType}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <CountdownBadge dueDate={d.dueDate} locale={locale} />
                          <Icon className={`h-4 w-4 ${style.text}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Fragment import ─── */
import { Fragment } from 'react';

/* ─── Demo Data ─── */
function getDemoData(): ComplianceCalendarData {
  return {
    institutionName: 'Cooperativa de Ahorro y Credito Demo',
    deadlines: [
      {
        id: 'dl1',
        title: 'COSSEC Quarterly Financial Report (Schedule 1-4)',
        titleEs: 'Informe Financiero Trimestral COSSEC (Schedule 1-4)',
        regulator: 'COSSEC',
        dueDate: '2026-04-15',
        status: 'pending',
        filingType: 'Quarterly Filing',
        filingTypeEs: 'Radicacion Trimestral',
        description: 'Quarterly financial statements including balance sheet, income statement, and supplementary schedules.',
        descriptionEs: 'Estados financieros trimestrales incluyendo balance general, estado de ingresos y schedules suplementarios.',
        requiredDocuments: [
          { name: 'Balance Sheet (Schedule 1)', nameEs: 'Balance General (Schedule 1)' },
          { name: 'Income Statement (Schedule 4)', nameEs: 'Estado de Ingresos (Schedule 4)' },
          { name: 'Asset Detail (Schedule 2)', nameEs: 'Detalle de Activos (Schedule 2)' },
          { name: 'Liability Detail (Schedule 3)', nameEs: 'Detalle de Pasivos (Schedule 3)' },
        ],
      },
      {
        id: 'dl2',
        title: 'Annual BSA/AML Report',
        titleEs: 'Informe Anual BSA/AML',
        regulator: 'FinCEN',
        dueDate: '2026-03-31',
        status: 'overdue',
        filingType: 'Annual Filing',
        filingTypeEs: 'Radicacion Anual',
        description: 'Annual Bank Secrecy Act / Anti-Money Laundering compliance report and independent testing results.',
        descriptionEs: 'Informe anual de cumplimiento de Ley de Secreto Bancario / Anti-Lavado de Dinero y resultados de pruebas independientes.',
        requiredDocuments: [
          { name: 'BSA Risk Assessment', nameEs: 'Evaluacion Riesgo BSA' },
          { name: 'Independent Testing Report', nameEs: 'Informe Pruebas Independientes' },
          { name: 'Training Records', nameEs: 'Registros de Capacitacion' },
        ],
      },
      {
        id: 'dl3',
        title: 'COSSEC Stress Test Results Submission',
        titleEs: 'Envio Resultados Pruebas de Estres COSSEC',
        regulator: 'COSSEC',
        dueDate: '2026-05-31',
        status: 'pending',
        filingType: 'Annual Filing',
        filingTypeEs: 'Radicacion Anual',
        description: 'Annual stress testing results including NII sensitivity, EVE impact, and capital adequacy under stress scenarios.',
        descriptionEs: 'Resultados anuales de pruebas de estres incluyendo sensibilidad NII, impacto EVE y suficiencia de capital bajo escenarios de estres.',
        requiredDocuments: [
          { name: 'NII Sensitivity Report', nameEs: 'Informe Sensibilidad NII' },
          { name: 'EVE Analysis', nameEs: 'Analisis EVE' },
          { name: 'Capital Adequacy Under Stress', nameEs: 'Suficiencia Capital Bajo Estres' },
        ],
      },
      {
        id: 'dl4',
        title: 'Annual Audited Financial Statements',
        titleEs: 'Estados Financieros Auditados Anuales',
        regulator: 'COSSEC',
        dueDate: '2026-04-30',
        status: 'pending',
        filingType: 'Annual Filing',
        filingTypeEs: 'Radicacion Anual',
        description: 'Independently audited financial statements with management letter and supplementary information.',
        descriptionEs: 'Estados financieros auditados independientemente con carta de gerencia e informacion suplementaria.',
        requiredDocuments: [
          { name: 'Audited Financial Statements', nameEs: 'Estados Financieros Auditados' },
          { name: 'Management Letter', nameEs: 'Carta de Gerencia' },
          { name: 'Supplementary Schedules', nameEs: 'Schedules Suplementarios' },
        ],
      },
      {
        id: 'dl5',
        title: 'IRR Policy Annual Review',
        titleEs: 'Revision Anual Politica IRR',
        regulator: 'COSSEC',
        dueDate: '2026-06-30',
        status: 'pending',
        filingType: 'Policy Review',
        filingTypeEs: 'Revision de Politica',
        description: 'Annual review and board approval of interest rate risk policy, including limit calibration.',
        descriptionEs: 'Revision anual y aprobacion por junta de politica de riesgo de tasa de interes, incluyendo calibracion de limites.',
        requiredDocuments: [
          { name: 'IRR Policy (marked-up)', nameEs: 'Politica IRR (con cambios)' },
          { name: 'Board Resolution', nameEs: 'Resolucion de Junta' },
        ],
      },
      {
        id: 'dl6',
        title: 'OFAC Screening Certification',
        titleEs: 'Certificacion de Verificacion OFAC',
        regulator: 'OFAC',
        dueDate: '2026-03-25',
        status: 'completed',
        filingType: 'Quarterly Certification',
        filingTypeEs: 'Certificacion Trimestral',
        description: 'Quarterly certification that all members and transactions have been screened against OFAC SDN list.',
        descriptionEs: 'Certificacion trimestral de que todos los socios y transacciones han sido verificados contra la lista SDN de OFAC.',
        requiredDocuments: [
          { name: 'OFAC Screening Logs', nameEs: 'Registros de Verificacion OFAC' },
          { name: 'Compliance Officer Certification', nameEs: 'Certificacion Oficial de Cumplimiento' },
        ],
      },
      {
        id: 'dl7',
        title: 'CECL Quarterly Allowance Review',
        titleEs: 'Revision Trimestral Reserva CECL',
        regulator: 'FASB/COSSEC',
        dueDate: '2026-04-10',
        status: 'pending',
        filingType: 'Quarterly Review',
        filingTypeEs: 'Revision Trimestral',
        description: 'Quarterly CECL allowance adequacy assessment including model recalibration and qualitative factor review.',
        descriptionEs: 'Evaluacion trimestral de adecuacion de reserva CECL incluyendo recalibracion del modelo y revision de factores cualitativos.',
        requiredDocuments: [
          { name: 'CECL Model Output', nameEs: 'Resultado Modelo CECL' },
          { name: 'Qualitative Factor Analysis', nameEs: 'Analisis Factores Cualitativos' },
          { name: 'Board Approval Documentation', nameEs: 'Documentacion Aprobacion Junta' },
        ],
      },
      {
        id: 'dl8',
        title: 'Concentration Risk Quarterly Report',
        titleEs: 'Informe Trimestral Riesgo de Concentracion',
        regulator: 'COSSEC',
        dueDate: '2026-04-20',
        status: 'pending',
        filingType: 'Quarterly Filing',
        filingTypeEs: 'Radicacion Trimestral',
        description: 'Quarterly concentration risk analysis covering CRE, consumer, and member business lending concentrations.',
        descriptionEs: 'Analisis trimestral de riesgo de concentracion cubriendo concentraciones CRE, consumo y prestamos comerciales a socios.',
        requiredDocuments: [
          { name: 'Concentration Analysis', nameEs: 'Analisis de Concentracion' },
          { name: 'Limit Monitoring Report', nameEs: 'Informe Monitoreo de Limites' },
        ],
      },
      {
        id: 'dl9',
        title: 'Board ALM/ALCO Report',
        titleEs: 'Informe ALM/ALCO a Junta',
        regulator: 'Internal',
        dueDate: '2026-04-05',
        status: 'pending',
        filingType: 'Monthly Report',
        filingTypeEs: 'Informe Mensual',
        description: 'Monthly ALM report to board of directors covering key risk metrics and limit compliance.',
        descriptionEs: 'Informe mensual ALM a junta directiva cubriendo metricas de riesgo clave y cumplimiento de limites.',
        requiredDocuments: [
          { name: 'ALM Dashboard Report', nameEs: 'Informe Panel ALM' },
          { name: 'Risk Limit Summary', nameEs: 'Resumen Limites de Riesgo' },
        ],
      },
      {
        id: 'dl10',
        title: 'Annual Capital Plan Review',
        titleEs: 'Revision Anual del Plan de Capital',
        regulator: 'COSSEC',
        dueDate: '2026-02-28',
        status: 'completed',
        filingType: 'Annual Review',
        filingTypeEs: 'Revision Anual',
        description: 'Annual review of capital plan, triggers, and restoration strategies.',
        descriptionEs: 'Revision anual del plan de capital, disparadores y estrategias de restauracion.',
        requiredDocuments: [
          { name: 'Capital Plan Document', nameEs: 'Documento Plan de Capital' },
          { name: 'Board Approval Minutes', nameEs: 'Actas Aprobacion Junta' },
        ],
      },
      {
        id: 'dl11',
        title: 'Liquidity Coverage Ratio (LCR) Report',
        titleEs: 'Informe Ratio Cobertura Liquidez (LCR)',
        regulator: 'COSSEC',
        dueDate: '2026-04-15',
        status: 'pending',
        filingType: 'Quarterly Filing',
        filingTypeEs: 'Radicacion Trimestral',
        description: 'Quarterly LCR calculation and compliance verification with regulatory minimum.',
        descriptionEs: 'Calculo trimestral del LCR y verificacion de cumplimiento con minimo regulatorio.',
        requiredDocuments: [
          { name: 'LCR Calculation Worksheet', nameEs: 'Hoja de Calculo LCR' },
          { name: 'HQLA Inventory', nameEs: 'Inventario HQLA' },
        ],
      },
      {
        id: 'dl12',
        title: 'Cybersecurity Assessment Report',
        titleEs: 'Informe de Evaluacion de Ciberseguridad',
        regulator: 'COSSEC',
        dueDate: '2026-07-31',
        status: 'pending',
        filingType: 'Annual Filing',
        filingTypeEs: 'Radicacion Anual',
        description: 'Annual cybersecurity risk assessment including penetration testing results and incident response plan review.',
        descriptionEs: 'Evaluacion anual de riesgo de ciberseguridad incluyendo resultados de pruebas de penetracion y revision del plan de respuesta a incidentes.',
        requiredDocuments: [
          { name: 'Penetration Test Report', nameEs: 'Informe Pruebas de Penetracion' },
          { name: 'Incident Response Plan', nameEs: 'Plan de Respuesta a Incidentes' },
          { name: 'Risk Assessment Matrix', nameEs: 'Matriz de Evaluacion de Riesgo' },
        ],
      },
    ],
  };
}
