'use client';

import React from 'react';

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface GradeDisplayProps {
  /** Letter grade A through F */
  grade: LetterGrade;
  /** Percentage score (0-100) for progress ring */
  score: number;
  /** Size of the display in pixels */
  size?: number;
  /** Whether to show the numeric score below the letter */
  showScore?: boolean;
  className?: string;
}

const GRADE_COLORS: Record<LetterGrade, { ring: string; text: string; bg: string; stroke: string }> = {
  A: { ring: 'stroke-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', stroke: '#059669' },
  B: { ring: 'stroke-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50', stroke: '#0891b2' },
  C: { ring: 'stroke-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', stroke: '#d97706' },
  D: { ring: 'stroke-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', stroke: '#ea580c' },
  F: { ring: 'stroke-rose-500', text: 'text-rose-700', bg: 'bg-rose-50', stroke: '#e11d48' },
};

/**
 * Large letter grade display (A-F) with a progress ring and optional score.
 * Used for exam readiness, compliance grades, and CAMEL ratings.
 */
export function GradeDisplay({ grade, score, size = 160, showScore = true, className = '' }: GradeDisplayProps) {
  const colors = GRADE_COLORS[grade] || GRADE_COLORS.C;
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;
  const center = size / 2;

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`} style={{ width: size, height: size }}>
      {/* SVG ring */}
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={8}
        />
        {/* Progress ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-bold leading-none ${colors.text}`}
          style={{ fontSize: size * 0.35 }}
        >
          {grade}
        </span>
        {showScore && (
          <span className="mt-1 text-xs font-medium tabular-nums text-slate-500">
            {score.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
