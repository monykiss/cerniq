'use client';

import React from 'react';

export interface RiskScoreBadgeProps {
  /** Numeric score 0-100 */
  score: number;
  /** Optional size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show numeric value alongside color */
  showValue?: boolean;
  className?: string;
}

function getScoreConfig(score: number): { bg: string; text: string; border: string; label: string; labelEs: string } {
  if (score >= 80) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Low Risk', labelEs: 'Bajo Riesgo' };
  }
  if (score >= 60) {
    return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Moderate', labelEs: 'Moderado' };
  }
  return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'High Risk', labelEs: 'Alto Riesgo' };
}

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-sm gap-1.5',
  lg: 'px-3 py-1.5 text-base gap-2',
} as const;

/**
 * Color-coded risk score badge (0-100 scale).
 * Green (80+), Yellow (60-79), Red (<60).
 */
export function RiskScoreBadge({ score, size = 'md', showValue = true, className = '' }: RiskScoreBadgeProps) {
  const config = getScoreConfig(score);

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold tabular-nums ${config.bg} ${config.text} ${config.border} ${SIZE_CLASSES[size]} ${className}`}
      aria-label={`Risk score: ${score}`}
    >
      {/* Color dot */}
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-rose-500'
        }`}
        aria-hidden="true"
      />
      {showValue && <span>{score}</span>}
    </span>
  );
}
