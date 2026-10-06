'use client';

import { useMemo } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HealthScoreWidgetProps {
  score: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  history?: number[];
  variant?: 'compact' | 'full';
  locale?: 'en' | 'es';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e'; // green-500
  if (score >= 40) return '#eab308'; // yellow-500
  return '#ef4444'; // red-500
}

function getScoreLabel(score: number, locale: 'en' | 'es'): string {
  if (score >= 70) return locale === 'es' ? 'SALUDABLE' : 'HEALTHY';
  if (score >= 40) return locale === 'es' ? 'MODERADO' : 'MODERATE';
  return locale === 'es' ? 'ALTO RIESGO' : 'HIGH RISK';
}

function getScoreLabelColor(score: number): string {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-rose-600';
}

function getConfidenceLabel(
  confidence: 'HIGH' | 'MEDIUM' | 'LOW',
  locale: 'en' | 'es',
): string {
  const labels: Record<string, Record<'en' | 'es', string>> = {
    HIGH: { en: 'High confidence', es: 'Confianza alta' },
    MEDIUM: { en: 'Medium confidence', es: 'Confianza media' },
    LOW: { en: 'Low confidence', es: 'Confianza baja' },
  };
  return labels[confidence][locale];
}

function getConfidenceDotColor(confidence: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  if (confidence === 'HIGH') return 'bg-emerald-500';
  if (confidence === 'MEDIUM') return 'bg-amber-500';
  return 'bg-rose-500';
}

// ─── Sparkline (pure SVG) ───────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;

  const width = 80;
  const height = 24;
  const padding = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block"
      aria-hidden="true"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on the latest value */}
      <circle
        cx={points[points.length - 1].split(',')[0]}
        cy={points[points.length - 1].split(',')[1]}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}

// ─── Circular gauge (SVG) ───────────────────────────────────────────────────

function CircularGauge({
  score,
  size,
  color,
}: {
  score: number;
  size: number;
  color: string;
}) {
  const strokeWidth = size >= 120 ? 10 : 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, score));
  const offset = circumference - (clampedScore / 100) * circumference;
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      aria-hidden="true"
    >
      {/* Background track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="rgba(203, 213, 225, 0.35)"
        strokeWidth={strokeWidth}
      />
      {/* Score arc */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-1000 ease-out"
        style={{
          transformOrigin: 'center',
          transform: 'rotate(-90deg)',
        }}
      />
    </svg>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function HealthScoreWidget({
  score,
  confidence,
  history,
  variant = 'full',
  locale = 'en',
}: HealthScoreWidgetProps) {
  const color = useMemo(() => getScoreColor(score), [score]);
  const label = useMemo(() => getScoreLabel(score, locale), [score, locale]);
  const labelColor = useMemo(() => getScoreLabelColor(score), [score]);
  const title = locale === 'es' ? 'Puntaje de Salud' : 'Health Score';

  const isCompact = variant === 'compact';
  const gaugeSize = isCompact ? 80 : 140;

  return (
    <div
      className={`flex flex-col items-center ${isCompact ? 'gap-1' : 'gap-3'}`}
      role="figure"
      aria-label={`${title}: ${score}/100 - ${label}`}
    >
      {/* Title */}
      <p
        className={`font-medium text-slate-500 uppercase tracking-wider ${
          isCompact ? 'text-[10px]' : 'text-xs'
        }`}
      >
        {title}
      </p>

      {/* Gauge with centered score */}
      <div className="relative" style={{ width: gaugeSize, height: gaugeSize }}>
        <CircularGauge score={score} size={gaugeSize} color={color} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-bold text-slate-950 ${
              isCompact ? 'text-xl' : 'text-4xl'
            }`}
            data-testid="health-score-value"
          >
            {Math.round(score)}
          </span>
          {!isCompact && (
            <span className="text-xs text-slate-400 mt-0.5">/ 100</span>
          )}
        </div>
      </div>

      {/* Status label */}
      <span
        className={`font-semibold uppercase tracking-wide ${labelColor} ${
          isCompact ? 'text-[10px]' : 'text-xs'
        }`}
        data-testid="health-score-label"
      >
        {label}
      </span>

      {/* Confidence indicator */}
      {confidence && (
        <div
          className={`flex items-center gap-1.5 ${
            isCompact ? 'mt-0' : 'mt-1'
          }`}
          data-testid="health-score-confidence"
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${getConfidenceDotColor(
              confidence,
            )}`}
          />
          <span className="text-[11px] text-slate-500">
            {getConfidenceLabel(confidence, locale)}
          </span>
        </div>
      )}

      {/* Sparkline for historical trend */}
      {history && history.length >= 2 && !isCompact && (
        <div className="mt-1 flex flex-col items-center gap-0.5" data-testid="health-score-sparkline">
          <Sparkline data={history} color={color} />
          <span className="text-[10px] text-slate-400">
            {locale === 'es' ? 'Tendencia reciente' : 'Recent trend'}
          </span>
        </div>
      )}
    </div>
  );
}
