export type ReportLanguage = 'en' | 'es';

export const REPORT_THEME = {
  brand: '#0f766e',
  brandAlt: '#164e63',
  accent: '#d97706',
  dark: '#0f172a',
  heading: '#1e293b',
  body: '#475569',
  muted: '#94a3b8',
  border: '#e2e8f0',
  panel: '#f8fafc',
  rowAlt: '#f1f5f9',
  success: '#15803d',
  successBg: '#f0fdf4',
  warning: '#b45309',
  warningBg: '#fffbeb',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  info: '#1d4ed8',
  infoBg: '#eff6ff',
} as const;

export function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inferMoneyScale(values: unknown[]): number {
  const numericValues = values
    .map((value) => Math.abs(asNumber(value)))
    .filter((value) => value > 0);

  if (numericValues.length === 0) {
    return 1_000_000;
  }

  const maxValue = Math.max(...numericValues);
  return maxValue >= 100_000 ? 1 : 1_000_000;
}

function getLocale(language: ReportLanguage): string {
  return language === 'es' ? 'es-PR' : 'en-US';
}

function normalizePercentValue(value: unknown): number {
  const numeric = asNumber(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

/**
 * Validates that all currency codes in a report are consistent. Call this
 * before creating a formatter when data comes from multiple sources (e.g.,
 * balance sheet + liquidity positions + peer benchmarks). Returns a DataGap
 * descriptor if currencies are mixed, or null if they're consistent.
 *
 * PR cooperativas are all USD today, but this guard catches the case where
 * a non-PR institution's data leaks into a report through peer analytics or
 * cross-entity aggregation.
 */
export function detectMixedCurrencies(
  currencies: Array<string | null | undefined>,
): {
  field: string;
  reason: 'MIXED_CURRENCIES';
  severity: 'WARNING';
  action: string;
  context: { found: string[] };
} | null {
  const present = [...new Set(currencies.filter((c): c is string => !!c))];
  if (present.length <= 1) return null;
  return {
    field: 'report.currency',
    reason: 'MIXED_CURRENCIES',
    severity: 'WARNING',
    action: `Report contains mixed currencies (${present.join(', ')}). Monetary comparisons may be misleading.`,
    context: { found: present },
  };
}

export function createReportFormatter(
  language: ReportLanguage,
  options: {
    currency?: string;
    moneyScale?: number;
  } = {},
) {
  const locale = getLocale(language);
  const currency = options.currency || 'USD';
  const moneyScale = options.moneyScale ?? 1;

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const compactCurrencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const decimalFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    locale,
    moneyScale,
    money(rawValue: unknown): string {
      return currencyFormatter.format(asNumber(rawValue) * moneyScale);
    },
    compactMoney(rawValue: unknown): string {
      return compactCurrencyFormatter.format(asNumber(rawValue) * moneyScale);
    },
    moneyWithCompact(rawValue: unknown): {
      exact: string;
      compact: string | null;
    } {
      const scaled = asNumber(rawValue) * moneyScale;
      const exact = currencyFormatter.format(scaled);
      if (Math.abs(scaled) < 1_000_000) {
        return { exact, compact: null };
      }

      return {
        exact,
        compact: compactCurrencyFormatter.format(scaled),
      };
    },
    signedMoney(rawValue: unknown): string {
      const scaled = asNumber(rawValue) * moneyScale;
      const formatted = currencyFormatter.format(Math.abs(scaled));
      return `${scaled >= 0 ? '+' : '-'}${formatted}`;
    },
    percent(rawValue: unknown, decimals = 2, signed = false): string {
      const normalized = normalizePercentValue(rawValue);
      const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      const formatted = formatter.format(Math.abs(normalized));
      return `${signed && normalized >= 0 ? '+' : normalized < 0 ? '-' : ''}${formatted}%`;
    },
    years(rawValue: unknown, decimals = 2): string {
      return `${decimalFormatter.format(asNumber(rawValue))} yr`;
    },
    basisPoints(rawValue: unknown): string {
      return `${decimalFormatter.format(asNumber(rawValue))} bps`;
    },
    integer(rawValue: unknown): string {
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
      }).format(asNumber(rawValue));
    },
    date(value: string | Date | null | undefined): string {
      if (!value) {
        return language === 'es' ? 'No disponible' : 'Unavailable';
      }

      return new Date(value).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },
    month(value: string | Date | null | undefined): string {
      if (!value) {
        return language === 'es' ? 'No disponible' : 'Unavailable';
      }

      return new Date(value).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
      });
    },
  };
}

export function toneFromStatus(
  status: string | null | undefined,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch ((status || '').toLowerCase()) {
    case 'compliant':
    case 'ready':
    case 'pass':
    case 'resilient':
      return 'success';
    case 'conditional':
    case 'warning':
    case 'warn':
    case 'processing':
    case 'adequate':
      return 'warning';
    case 'fail':
    case 'failed':
    case 'breach':
    case 'non-compliant':
    case 'unavailable':
    case 'critical':
    case 'vulnerable':
      return 'danger';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}
