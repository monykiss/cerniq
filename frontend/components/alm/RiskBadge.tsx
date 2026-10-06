'use client';

import { useTranslation } from '@/lib/i18n';

interface RiskBadgeProps {
  status: 'compliant' | 'warning' | 'breach' | 'low' | 'moderate' | 'high' | 'critical';
  size?: 'sm' | 'md';
}

const badgeStyles: Record<string, string> = {
  compliant: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  breach: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
};

const labelKeys: Record<string, string> = {
  compliant: 'risk.compliant',
  low: 'risk.lowRisk',
  warning: 'risk.warning',
  moderate: 'risk.moderate',
  breach: 'risk.breach',
  high: 'risk.highRisk',
  critical: 'risk.critical',
};

export default function RiskBadge({ status, size = 'md' }: RiskBadgeProps) {
  const { t } = useTranslation();
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${sizeClass} ${badgeStyles[status] || badgeStyles.moderate}`}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  );
}
