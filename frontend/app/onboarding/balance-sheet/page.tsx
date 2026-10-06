'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DollarSign,
  Building2,
  Landmark,
  TrendingUp,
  ClipboardList,
  RefreshCw,
  Globe,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { analytics, EVENTS } from '@/lib/analytics';

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
type Lang = 'en' | 'es';

const T: Record<string, Record<Lang, string>> = {
  title: { en: 'Balance Sheet Entry', es: 'Entrada del Balance General' },
  subtitle: {
    en: 'Enter your institution\u2019s financial data to generate ALM reports.',
    es: 'Ingrese los datos financieros de su instituci\u00f3n para generar informes ALM.',
  },
  step: { en: 'Step', es: 'Paso' },
  of: { en: 'of', es: 'de' },
  back: { en: 'Back', es: 'Atr\u00e1s' },
  next: { en: 'Next', es: 'Siguiente' },
  submit: { en: 'Submit Balance Sheet', es: 'Enviar Balance General' },
  submitting: { en: 'Submitting...', es: 'Enviando...' },
  skipStep: { en: 'Skip this step', es: 'Omitir este paso' },
  optional: { en: '(optional)', es: '(opcional)' },

  // Step names
  assets: { en: 'Assets', es: 'Activos' },
  liabilities: { en: 'Liabilities', es: 'Pasivos' },
  capital: { en: 'Capital', es: 'Capital' },
  income: { en: 'Income Statement', es: 'Estado de Resultados' },
  review: { en: 'Review & Submit', es: 'Revisar y Enviar' },

  // Asset fields
  cashEquivalents: { en: 'Cash & Equivalents', es: 'Efectivo y Equivalentes' },
  investmentSecurities: {
    en: 'Investment Securities',
    es: 'Valores de Inversi\u00f3n',
  },
  netLoansLeases: {
    en: 'Net Loans & Leases',
    es: 'Pr\u00e9stamos y Arrendamientos Netos',
  },
  fixedAssets: { en: 'Fixed Assets', es: 'Activos Fijos' },
  otherAssets: { en: 'Other Assets', es: 'Otros Activos' },
  totalAssets: { en: 'Total Assets', es: 'Activos Totales' },

  // Liability fields
  memberDeposits: {
    en: 'Member Deposits / Shares',
    es: 'Dep\u00f3sitos / Acciones de Miembros',
  },
  borrowedFunds: { en: 'Borrowed Funds', es: 'Fondos Prestados' },
  otherLiabilities: { en: 'Other Liabilities', es: 'Otros Pasivos' },
  totalLiabilities: { en: 'Total Liabilities', es: 'Pasivos Totales' },

  // Capital fields
  netWorthEquity: {
    en: 'Net Worth / Equity',
    es: 'Patrimonio Neto / Capital',
  },
  netWorthRatio: {
    en: 'Net Worth Ratio',
    es: 'Raz\u00f3n de Capital Neto',
  },

  // Income fields
  interestIncome: {
    en: 'Interest Income',
    es: 'Ingresos por Intereses',
  },
  interestExpense: {
    en: 'Interest Expense',
    es: 'Gastos por Intereses',
  },
  netInterestIncome: {
    en: 'Net Interest Income',
    es: 'Ingreso Neto por Intereses',
  },
  nonInterestIncome: {
    en: 'Non-Interest Income',
    es: 'Ingresos No Relacionados con Intereses',
  },
  nonInterestExpense: {
    en: 'Non-Interest Expense',
    es: 'Gastos No Relacionados con Intereses',
  },
  netIncome: { en: 'Net Income', es: 'Ingreso Neto' },

  // Review
  reviewSummary: { en: 'Summary', es: 'Resumen' },
  section: { en: 'Section', es: 'Secci\u00f3n' },
  field: { en: 'Field', es: 'Campo' },
  value: { en: 'Value', es: 'Valor' },
  autoCalculated: { en: 'Auto-calculated', es: 'Calculado autom\u00e1ticamente' },

  // Validation
  noNegative: {
    en: 'Values cannot be negative.',
    es: 'Los valores no pueden ser negativos.',
  },
  submitSuccess: {
    en: 'Balance sheet submitted successfully!',
    es: '\u00a1Balance general enviado exitosamente!',
  },
  submitError: {
    en: 'Failed to submit. Please try again.',
    es: 'Error al enviar. Intente de nuevo.',
  },
  rateAndDuration: {
    en: 'Rate & Duration',
    es: 'Tasa y Duraci\u00f3n',
  },
  avgRate: {
    en: 'Avg Rate (%)',
    es: 'Tasa Prom. (%)',
  },
  durationYrs: {
    en: 'Duration (yrs)',
    es: 'Duraci\u00f3n (a\u00f1os)',
  },
  rateTypeLabel: {
    en: 'Rate Type',
    es: 'Tipo de Tasa',
  },
  fixed: {
    en: 'Fixed',
    es: 'Fija',
  },
  variable: {
    en: 'Variable',
    es: 'Variable',
  },
  institutionIdMissing: {
    en: 'No institution selected. Please complete previous onboarding steps.',
    es: 'No hay instituci\u00f3n seleccionada. Complete los pasos anteriores.',
  },
};

function t(key: string, lang: Lang): string {
  return T[key]?.[lang] ?? key;
}

// ---------------------------------------------------------------------------
// Dollar formatter
// ---------------------------------------------------------------------------
function fmtDollar(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
const STEP_KEYS = ['assets', 'liabilities', 'capital', 'income', 'review'] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_ICONS: Record<StepKey, React.ElementType> = {
  assets: DollarSign,
  liabilities: Building2,
  capital: Landmark,
  income: TrendingUp,
  review: ClipboardList,
};

// ---------------------------------------------------------------------------
// Currency input component
// ---------------------------------------------------------------------------
function CurrencyInput({
  id,
  label,
  value,
  onChange,
  readOnly = false,
  computed = false,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  computed?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
        {computed && (
          <span className="ml-2 text-xs text-cyan-400 font-normal">(auto)</span>
        )}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
          $
        </span>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={value || ''}
          onChange={(e) => {
            if (onChange) {
              const raw = e.target.value;
              onChange(raw === '' ? 0 : Math.max(0, Number(raw)));
            }
          }}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : 0}
          placeholder="0"
          className={`w-full rounded-lg border pl-7 pr-4 py-3 text-sm focus:outline-none focus:ring-2 transition ${
            readOnly
              ? 'bg-slate-800/60 border-slate-700 text-cyan-300 cursor-default'
              : error
                ? 'bg-slate-800 border-red-500/60 text-white focus:ring-red-500'
                : 'bg-slate-800 border-slate-700 text-white focus:ring-cyan-500'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate & Duration inline row — appears below each balance input
// ---------------------------------------------------------------------------
function RateDurationRow({
  rate,
  onRateChange,
  duration,
  onDurationChange,
  rateType,
  onRateTypeChange,
  lang,
  visible,
}: {
  rate: number;
  onRateChange: (v: number) => void;
  duration: number;
  onDurationChange: (v: number) => void;
  rateType: 'fixed' | 'variable';
  onRateTypeChange: (v: 'fixed' | 'variable') => void;
  lang: Lang;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] text-slate-500 whitespace-nowrap">{t('avgRate', lang)}</label>
        <input
          type="number"
          step={0.1}
          min={0}
          max={100}
          value={rate || ''}
          onChange={(e) => onRateChange(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
          className="w-16 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-xs text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-cyan-500"
          placeholder="0.0"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] text-slate-500 whitespace-nowrap">{t('durationYrs', lang)}</label>
        <input
          type="number"
          step={0.1}
          min={0}
          max={50}
          value={duration || ''}
          onChange={(e) => onDurationChange(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))}
          className="w-16 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-xs text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-cyan-500"
          placeholder="0.0"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] text-slate-500 whitespace-nowrap">{t('rateTypeLabel', lang)}</label>
        <select
          value={rateType}
          onChange={(e) => onRateTypeChange(e.target.value as 'fixed' | 'variable')}
          className="rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
        >
          <option value="fixed">{t('fixed', lang)}</option>
          <option value="variable">{t('variable', lang)}</option>
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------
export default function BalanceSheetWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedInstitutionId = searchParams.get('institutionId') || '';
  // ---- Auto-save key ----
  const autoSaveKey = `cerniq_bs_wizard_${requestedInstitutionId || 'draft'}`;

  function loadSaved<T>(field: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(autoSaveKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return field in parsed ? parsed[field] : fallback;
    } catch { return fallback; }
  }

  const [lang, setLang] = useState<Lang>(() => loadSaved('lang', 'en' as Lang));
  const [step, setStep] = useState(() => loadSaved('step', 0));
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<'success' | 'error' | null>(null);
  const [institutionId, setInstitutionId] = useState(requestedInstitutionId);

  // ---- Assets ----
  const [cashEquivalents, setCashEquivalents] = useState(() => loadSaved('cashEquivalents', 0));
  const [investmentSecurities, setInvestmentSecurities] = useState(() => loadSaved('investmentSecurities', 0));
  const [netLoansLeases, setNetLoansLeases] = useState(() => loadSaved('netLoansLeases', 0));
  const [fixedAssets, setFixedAssets] = useState(() => loadSaved('fixedAssets', 0));
  const [otherAssets, setOtherAssets] = useState(() => loadSaved('otherAssets', 0));

  // ---- Liabilities ----
  const [memberDeposits, setMemberDeposits] = useState(() => loadSaved('memberDeposits', 0));
  const [borrowedFunds, setBorrowedFunds] = useState(() => loadSaved('borrowedFunds', 0));
  const [otherLiabilities, setOtherLiabilities] = useState(() => loadSaved('otherLiabilities', 0));

  // ---- Rate & Duration per item (sensible defaults per subcategory) ----
  const [cashRate, setCashRate] = useState(() => loadSaved('cashRate', 1.5));
  const [cashDuration, setCashDuration] = useState(() => loadSaved('cashDuration', 0.1));
  const [cashRateType, setCashRateType] = useState<'fixed' | 'variable'>(() => loadSaved('cashRateType', 'variable'));

  const [investRate, setInvestRate] = useState(() => loadSaved('investRate', 3.5));
  const [investDuration, setInvestDuration] = useState(() => loadSaved('investDuration', 3.5));
  const [investRateType, setInvestRateType] = useState<'fixed' | 'variable'>(() => loadSaved('investRateType', 'fixed'));

  const [loanRate, setLoanRate] = useState(() => loadSaved('loanRate', 5.5));
  const [loanDuration, setLoanDuration] = useState(() => loadSaved('loanDuration', 4.2));
  const [loanRateType, setLoanRateType] = useState<'fixed' | 'variable'>(() => loadSaved('loanRateType', 'fixed'));

  const [fixedAssetRate, setFixedAssetRate] = useState(() => loadSaved('fixedAssetRate', 0));
  const [fixedAssetDuration, setFixedAssetDuration] = useState(() => loadSaved('fixedAssetDuration', 0));
  const [fixedAssetRateType, setFixedAssetRateType] = useState<'fixed' | 'variable'>(() => loadSaved('fixedAssetRateType', 'fixed'));

  const [otherAssetRate, setOtherAssetRate] = useState(() => loadSaved('otherAssetRate', 0));
  const [otherAssetDuration, setOtherAssetDuration] = useState(() => loadSaved('otherAssetDuration', 0));
  const [otherAssetRateType, setOtherAssetRateType] = useState<'fixed' | 'variable'>(() => loadSaved('otherAssetRateType', 'fixed'));

  const [depositRate, setDepositRate] = useState(() => loadSaved('depositRate', 2.0));
  const [depositDuration, setDepositDuration] = useState(() => loadSaved('depositDuration', 1.5));
  const [depositRateType, setDepositRateType] = useState<'fixed' | 'variable'>(() => loadSaved('depositRateType', 'variable'));

  const [borrowRate, setBorrowRate] = useState(() => loadSaved('borrowRate', 4.0));
  const [borrowDuration, setBorrowDuration] = useState(() => loadSaved('borrowDuration', 2.0));
  const [borrowRateType, setBorrowRateType] = useState<'fixed' | 'variable'>(() => loadSaved('borrowRateType', 'fixed'));

  const [otherLiabRate, setOtherLiabRate] = useState(() => loadSaved('otherLiabRate', 0));
  const [otherLiabDuration, setOtherLiabDuration] = useState(() => loadSaved('otherLiabDuration', 0));
  const [otherLiabRateType, setOtherLiabRateType] = useState<'fixed' | 'variable'>(() => loadSaved('otherLiabRateType', 'fixed'));

  // ---- Income ----
  const [interestIncome, setInterestIncome] = useState(() => loadSaved('interestIncome', 0));
  const [interestExpense, setInterestExpense] = useState(() => loadSaved('interestExpense', 0));
  const [nonInterestIncome, setNonInterestIncome] = useState(() => loadSaved('nonInterestIncome', 0));
  const [nonInterestExpense, setNonInterestExpense] = useState(() => loadSaved('nonInterestExpense', 0));

  // ---- Auto-save effect ----
  useEffect(() => {
    if (submitting || submitResult === 'success') return;
    try {
      localStorage.setItem(autoSaveKey, JSON.stringify({
        lang, step, cashEquivalents, investmentSecurities, netLoansLeases,
        fixedAssets, otherAssets, memberDeposits, borrowedFunds, otherLiabilities,
        interestIncome, interestExpense, nonInterestIncome, nonInterestExpense,
        cashRate, cashDuration, cashRateType,
        investRate, investDuration, investRateType,
        loanRate, loanDuration, loanRateType,
        fixedAssetRate, fixedAssetDuration, fixedAssetRateType,
        otherAssetRate, otherAssetDuration, otherAssetRateType,
        depositRate, depositDuration, depositRateType,
        borrowRate, borrowDuration, borrowRateType,
        otherLiabRate, otherLiabDuration, otherLiabRateType,
      }));
    } catch { /* localStorage full — degrade silently */ }
  }, [
    autoSaveKey, lang, step, submitting, submitResult,
    cashEquivalents, investmentSecurities, netLoansLeases, fixedAssets, otherAssets,
    memberDeposits, borrowedFunds, otherLiabilities,
    interestIncome, interestExpense, nonInterestIncome, nonInterestExpense,
    cashRate, cashDuration, cashRateType,
    investRate, investDuration, investRateType,
    loanRate, loanDuration, loanRateType,
    fixedAssetRate, fixedAssetDuration, fixedAssetRateType,
    otherAssetRate, otherAssetDuration, otherAssetRateType,
    depositRate, depositDuration, depositRateType,
    borrowRate, borrowDuration, borrowRateType,
    otherLiabRate, otherLiabDuration, otherLiabRateType,
  ]);

  useEffect(() => {
    let cancelled = false;

    const resolveInstitution = async () => {
      if (requestedInstitutionId) {
        setInstitutionId(requestedInstitutionId);
        return;
      }

      try {
        const institutions = await apiClient.getInstitutions();
        if (!cancelled && Array.isArray(institutions) && institutions.length > 0) {
          setInstitutionId(institutions[0].id);
        }
      } catch {
        if (!cancelled) {
          setInstitutionId('');
        }
      }
    };

    void resolveInstitution();
    return () => {
      cancelled = true;
    };
  }, [requestedInstitutionId]);

  // ---- Computed values ----
  const totalAssets = useMemo(
    () => cashEquivalents + investmentSecurities + netLoansLeases + fixedAssets + otherAssets,
    [cashEquivalents, investmentSecurities, netLoansLeases, fixedAssets, otherAssets],
  );

  const totalLiabilities = useMemo(
    () => memberDeposits + borrowedFunds + otherLiabilities,
    [memberDeposits, borrowedFunds, otherLiabilities],
  );

  const netWorthEquity = useMemo(
    () => totalAssets - totalLiabilities,
    [totalAssets, totalLiabilities],
  );

  const netWorthRatio = useMemo(
    () => (totalAssets > 0 ? (netWorthEquity / totalAssets) * 100 : 0),
    [netWorthEquity, totalAssets],
  );

  const netInterestIncome = useMemo(
    () => interestIncome - interestExpense,
    [interestIncome, interestExpense],
  );

  const netIncome = useMemo(
    () => netInterestIncome + nonInterestIncome - nonInterestExpense,
    [netInterestIncome, nonInterestIncome, nonInterestExpense],
  );

  // ---- Validation ----
  const stepValid = useCallback(
    (s: number): boolean => {
      switch (s) {
        case 0: // Assets
          return totalAssets > 0;
        case 1: // Liabilities
          return totalLiabilities >= 0;
        case 2: // Capital — always valid (computed)
          return true;
        case 3: // Income — optional
          return true;
        case 4: // Review
          return totalAssets > 0;
        default:
          return true;
      }
    },
    [totalAssets, totalLiabilities],
  );

  const currentStepKey = STEP_KEYS[step];
  const StepIcon = STEP_ICONS[currentStepKey];
  const isLast = step === STEP_KEYS.length - 1;
  const progressPct = ((step + 1) / STEP_KEYS.length) * 100;

  // ---- Navigation ----
  const goNext = () => {
    if (step < STEP_KEYS.length - 1) setStep((s) => s + 1);
  };
  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  // ---- Submit ----
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitResult(null);

    if (!institutionId) {
      setSubmitResult('error');
      setSubmitting(false);
      return;
    }

    const items = [
      // Assets
      { category: 'asset', subcategory: 'cash', name: 'Cash & Equivalents', balance: cashEquivalents, rateType: cashRateType, rate: cashRate / 100, duration: cashDuration },
      { category: 'asset', subcategory: 'investments', name: 'Investment Securities', balance: investmentSecurities, rateType: investRateType, rate: investRate / 100, duration: investDuration },
      { category: 'asset', subcategory: 'loans', name: 'Net Loans & Leases', balance: netLoansLeases, rateType: loanRateType, rate: loanRate / 100, duration: loanDuration },
      { category: 'asset', subcategory: 'fixed_assets', name: 'Fixed Assets', balance: fixedAssets, rateType: fixedAssetRateType, rate: fixedAssetRate / 100, duration: fixedAssetDuration },
      { category: 'asset', subcategory: 'other', name: 'Other Assets', balance: otherAssets, rateType: otherAssetRateType, rate: otherAssetRate / 100, duration: otherAssetDuration },
      // Liabilities
      { category: 'liability', subcategory: 'deposits', name: 'Member Deposits / Shares', balance: memberDeposits, rateType: depositRateType, rate: depositRate / 100, duration: depositDuration },
      { category: 'liability', subcategory: 'borrowings', name: 'Borrowed Funds', balance: borrowedFunds, rateType: borrowRateType, rate: borrowRate / 100, duration: borrowDuration },
      { category: 'liability', subcategory: 'other', name: 'Other Liabilities', balance: otherLiabilities, rateType: otherLiabRateType, rate: otherLiabRate / 100, duration: otherLiabDuration },
    ].filter((item) => item.balance > 0);

    try {
      await apiClient.importBalanceSheetItems(institutionId, items);
      analytics.track(EVENTS.PORTAL_DATA_SUBMITTED, {
        source: 'balance_sheet_wizard',
        institutionId,
        totalAssets,
        totalLiabilities,
        netWorthRatio: netWorthRatio.toFixed(2),
      });
      setSubmitResult('success');
      try { localStorage.removeItem(autoSaveKey); } catch {}
      setTimeout(() => router.push(`/alm?id=${institutionId}`), 1500);
    } catch {
      setSubmitResult('error');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Review table rows ----
  const reviewRows = useMemo(
    () => [
      { section: t('assets', lang), field: t('cashEquivalents', lang), value: fmtDollar(cashEquivalents), auto: false },
      { section: '', field: t('investmentSecurities', lang), value: fmtDollar(investmentSecurities), auto: false },
      { section: '', field: t('netLoansLeases', lang), value: fmtDollar(netLoansLeases), auto: false },
      { section: '', field: t('fixedAssets', lang), value: fmtDollar(fixedAssets), auto: false },
      { section: '', field: t('otherAssets', lang), value: fmtDollar(otherAssets), auto: false },
      { section: '', field: t('totalAssets', lang), value: fmtDollar(totalAssets), auto: true },
      { section: t('liabilities', lang), field: t('memberDeposits', lang), value: fmtDollar(memberDeposits), auto: false },
      { section: '', field: t('borrowedFunds', lang), value: fmtDollar(borrowedFunds), auto: false },
      { section: '', field: t('otherLiabilities', lang), value: fmtDollar(otherLiabilities), auto: false },
      { section: '', field: t('totalLiabilities', lang), value: fmtDollar(totalLiabilities), auto: true },
      { section: t('capital', lang), field: t('netWorthEquity', lang), value: fmtDollar(netWorthEquity), auto: true },
      { section: '', field: t('netWorthRatio', lang), value: fmtPct(netWorthRatio), auto: true },
      { section: t('income', lang), field: t('interestIncome', lang), value: fmtDollar(interestIncome), auto: false },
      { section: '', field: t('interestExpense', lang), value: fmtDollar(interestExpense), auto: false },
      { section: '', field: t('netInterestIncome', lang), value: fmtDollar(netInterestIncome), auto: true },
      { section: '', field: t('nonInterestIncome', lang), value: fmtDollar(nonInterestIncome), auto: false },
      { section: '', field: t('nonInterestExpense', lang), value: fmtDollar(nonInterestExpense), auto: false },
      { section: '', field: t('netIncome', lang), value: fmtDollar(netIncome), auto: true },
    ],
    [
      lang, cashEquivalents, investmentSecurities, netLoansLeases, fixedAssets,
      otherAssets, totalAssets, memberDeposits, borrowedFunds, otherLiabilities,
      totalLiabilities, netWorthEquity, netWorthRatio, interestIncome,
      interestExpense, netInterestIncome, nonInterestIncome, nonInterestExpense,
      netIncome,
    ],
  );

  // ---- Render ----
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-white px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-2xl mx-auto">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'en' ? 'es' : 'en'))}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition"
            aria-label="Toggle language"
          >
            <Globe className="h-3.5 w-3.5" />
            {lang === 'en' ? 'ES' : 'EN'}
          </button>
        </div>

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">{t('title', lang)}</h1>
          <p className="text-slate-400 mt-1 text-sm sm:text-base max-w-md mx-auto">
            {t('subtitle', lang)}
          </p>
          {!institutionId && (
            <p className="mt-3 text-sm text-amber-300">
              Complete institution setup first so CERNIQ can save this balance sheet to a real workspace.
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>
              {t('step', lang)} {step + 1} {t('of', lang)} {STEP_KEYS.length}
            </span>
            <span className="flex items-center gap-1.5">
              <StepIcon className="h-3.5 w-3.5 text-cyan-400" />
              {t(currentStepKey, lang)}
              {currentStepKey === 'income' && (
                <span className="text-slate-500">{t('optional', lang)}</span>
              )}
            </span>
          </div>

          {/* Track */}
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Step dots */}
          <div className="flex justify-between mt-3">
            {STEP_KEYS.map((key, i) => {
              const Icon = STEP_ICONS[key];
              const done = i < step;
              const active = i === step;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (i <= step || stepValid(step)) setStep(i);
                  }}
                  className={`flex flex-col items-center gap-1 text-[10px] sm:text-xs transition ${
                    active
                      ? 'text-cyan-400'
                      : done
                        ? 'text-cyan-600 hover:text-cyan-400'
                        : 'text-slate-600'
                  }`}
                  aria-label={t(key, lang)}
                >
                  <span
                    className={`flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-full border transition ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/20'
                        : done
                          ? 'border-cyan-600 bg-cyan-900/30'
                          : 'border-slate-700 bg-slate-800/50'
                    }`}
                  >
                    {done ? (
                      <CheckCircle className="h-4 w-4 text-cyan-400" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="hidden sm:block">{t(key, lang)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Card */}
        <div className="bg-slate-900/70 border border-cyan-500/20 rounded-2xl p-6 sm:p-8">
          {/* -------- STEP 0 — Assets -------- */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-cyan-400" />
                {t('assets', lang)}
              </h2>
              <div className="space-y-3">
                <div>
                  <CurrencyInput id="cashEquivalents" label={t('cashEquivalents', lang)} value={cashEquivalents} onChange={setCashEquivalents} />
                  <RateDurationRow rate={cashRate} onRateChange={setCashRate} duration={cashDuration} onDurationChange={setCashDuration} rateType={cashRateType} onRateTypeChange={setCashRateType} lang={lang} visible={cashEquivalents > 0} />
                </div>
                <div>
                  <CurrencyInput id="investmentSecurities" label={t('investmentSecurities', lang)} value={investmentSecurities} onChange={setInvestmentSecurities} />
                  <RateDurationRow rate={investRate} onRateChange={setInvestRate} duration={investDuration} onDurationChange={setInvestDuration} rateType={investRateType} onRateTypeChange={setInvestRateType} lang={lang} visible={investmentSecurities > 0} />
                </div>
                <div>
                  <CurrencyInput id="netLoansLeases" label={t('netLoansLeases', lang)} value={netLoansLeases} onChange={setNetLoansLeases} />
                  <RateDurationRow rate={loanRate} onRateChange={setLoanRate} duration={loanDuration} onDurationChange={setLoanDuration} rateType={loanRateType} onRateTypeChange={setLoanRateType} lang={lang} visible={netLoansLeases > 0} />
                </div>
                <div>
                  <CurrencyInput id="fixedAssets" label={t('fixedAssets', lang)} value={fixedAssets} onChange={setFixedAssets} />
                  <RateDurationRow rate={fixedAssetRate} onRateChange={setFixedAssetRate} duration={fixedAssetDuration} onDurationChange={setFixedAssetDuration} rateType={fixedAssetRateType} onRateTypeChange={setFixedAssetRateType} lang={lang} visible={fixedAssets > 0} />
                </div>
                <div>
                  <CurrencyInput id="otherAssets" label={t('otherAssets', lang)} value={otherAssets} onChange={setOtherAssets} />
                  <RateDurationRow rate={otherAssetRate} onRateChange={setOtherAssetRate} duration={otherAssetDuration} onDurationChange={setOtherAssetDuration} rateType={otherAssetRateType} onRateTypeChange={setOtherAssetRateType} lang={lang} visible={otherAssets > 0} />
                </div>
                <CurrencyInput id="totalAssets" label={t('totalAssets', lang)} value={totalAssets} readOnly computed />
              </div>
            </div>
          )}

          {/* -------- STEP 1 — Liabilities -------- */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-cyan-400" />
                {t('liabilities', lang)}
              </h2>
              <div className="space-y-3">
                <div>
                  <CurrencyInput id="memberDeposits" label={t('memberDeposits', lang)} value={memberDeposits} onChange={setMemberDeposits} />
                  <RateDurationRow rate={depositRate} onRateChange={setDepositRate} duration={depositDuration} onDurationChange={setDepositDuration} rateType={depositRateType} onRateTypeChange={setDepositRateType} lang={lang} visible={memberDeposits > 0} />
                </div>
                <div>
                  <CurrencyInput id="borrowedFunds" label={t('borrowedFunds', lang)} value={borrowedFunds} onChange={setBorrowedFunds} />
                  <RateDurationRow rate={borrowRate} onRateChange={setBorrowRate} duration={borrowDuration} onDurationChange={setBorrowDuration} rateType={borrowRateType} onRateTypeChange={setBorrowRateType} lang={lang} visible={borrowedFunds > 0} />
                </div>
                <div>
                  <CurrencyInput id="otherLiabilities" label={t('otherLiabilities', lang)} value={otherLiabilities} onChange={setOtherLiabilities} />
                  <RateDurationRow rate={otherLiabRate} onRateChange={setOtherLiabRate} duration={otherLiabDuration} onDurationChange={setOtherLiabDuration} rateType={otherLiabRateType} onRateTypeChange={setOtherLiabRateType} lang={lang} visible={otherLiabilities > 0} />
                </div>
                <CurrencyInput id="totalLiabilities" label={t('totalLiabilities', lang)} value={totalLiabilities} readOnly computed />
              </div>
            </div>
          )}

          {/* -------- STEP 2 — Capital -------- */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Landmark className="h-5 w-5 text-cyan-400" />
                {t('capital', lang)}
              </h2>
              <p className="text-sm text-slate-400">
                {t('autoCalculated', lang)}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <CurrencyInput
                  id="netWorthEquity"
                  label={t('netWorthEquity', lang)}
                  value={netWorthEquity}
                  readOnly
                  computed
                />
                <div>
                  <label
                    htmlFor="netWorthRatio"
                    className="block text-sm font-medium text-slate-300 mb-1.5"
                  >
                    {t('netWorthRatio', lang)}
                    <span className="ml-2 text-xs text-cyan-400 font-normal">(auto)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="netWorthRatio"
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={fmtPct(netWorthRatio)}
                      className="w-full rounded-lg border pl-4 pr-4 py-3 text-sm bg-slate-800/60 border-slate-700 text-cyan-300 cursor-default focus:outline-none"
                    />
                  </div>
                </div>
              </div>
              {/* Visual indicator */}
              <div className="mt-4 p-4 rounded-lg border border-slate-700 bg-slate-800/40">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-slate-400">
                    {lang === 'en' ? 'Capital Adequacy' : 'Adecuaci\u00f3n de Capital'}
                  </span>
                  <span
                    className={`font-semibold ${
                      netWorthRatio >= 7
                        ? 'text-emerald-400'
                        : netWorthRatio >= 5
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {fmtPct(netWorthRatio)}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      netWorthRatio >= 7
                        ? 'bg-emerald-500'
                        : netWorthRatio >= 5
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(Math.max(netWorthRatio, 0), 20) * 5}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>0%</span>
                  <span>5%</span>
                  <span>7%</span>
                  <span>10%</span>
                  <span>20%+</span>
                </div>
              </div>
            </div>
          )}

          {/* -------- STEP 3 — Income Statement -------- */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-400" />
                {t('income', lang)}
                <span className="text-xs text-slate-500 font-normal">
                  {t('optional', lang)}
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <CurrencyInput id="interestIncome" label={t('interestIncome', lang)} value={interestIncome} onChange={setInterestIncome} />
                <CurrencyInput id="interestExpense" label={t('interestExpense', lang)} value={interestExpense} onChange={setInterestExpense} />
                <CurrencyInput id="netInterestIncome" label={t('netInterestIncome', lang)} value={netInterestIncome} readOnly computed />
                <CurrencyInput id="nonInterestIncome" label={t('nonInterestIncome', lang)} value={nonInterestIncome} onChange={setNonInterestIncome} />
                <CurrencyInput id="nonInterestExpense" label={t('nonInterestExpense', lang)} value={nonInterestExpense} onChange={setNonInterestExpense} />
                <CurrencyInput id="netIncome" label={t('netIncome', lang)} value={netIncome} readOnly computed />
              </div>
            </div>
          )}

          {/* -------- STEP 4 — Review & Submit -------- */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-cyan-400" />
                {t('review', lang)}
              </h2>

              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-2 py-2">{t('section', lang)}</th>
                      <th className="px-2 py-2">{t('field', lang)}</th>
                      <th className="px-2 py-2 text-right">{t('value', lang)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-t border-slate-800 ${
                          row.auto ? 'bg-slate-800/30' : ''
                        }`}
                      >
                        <td className="px-2 py-2 text-slate-400 font-medium">
                          {row.section}
                        </td>
                        <td className="px-2 py-2 text-slate-200">
                          {row.field}
                          {row.auto && (
                            <span className="ml-1.5 text-[10px] text-cyan-500">
                              auto
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-2 py-2 text-right font-mono ${
                            row.auto ? 'text-cyan-300' : 'text-white'
                          }`}
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Submit result messages */}
              {submitResult === 'success' && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  {t('submitSuccess', lang)}
                </div>
              )}
              {submitResult === 'error' && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {!localStorage.getItem('cerniq_current_institution_id')
                    ? t('institutionIdMissing', lang)
                    : t('submitError', lang)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium transition hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('back', lang)}
          </button>

          {/* Skip button for income step */}
          {step === 3 && (
            <button
              type="button"
              onClick={goNext}
              className="text-slate-500 hover:text-slate-300 text-xs transition"
            >
              {t('skipStep', lang)}
            </button>
          )}

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !stepValid(step) || submitResult === 'success'}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {t('submitting', lang)}
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  {t('submit', lang)}
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!stepValid(step)}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('next', lang)}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
