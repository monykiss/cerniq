'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, getApiErrorMessage, isAuthError } from '@/lib/api';
import { getBalanceSheetTemplateUrl } from '@/lib/api-base';
import { analytics, EVENTS } from '@/lib/analytics';
import { RefreshCw, DollarSign, Upload, Plus, Trash2, AlertTriangle, Check, Download, Table, FileWarning, ChevronDown } from 'lucide-react';
import { useALM } from '@/components/alm/ALMProvider';

interface BalanceSheetItem {
  id?: string;
  category: 'asset' | 'liability';
  subcategory: string;
  name: string;
  balance: number;
  rate: number;
  duration: number;
  repriceDate?: string;
  maturityDate?: string;
  rateType: 'fixed' | 'variable';
}

interface Institution {
  id: string;
  name: string;
  type: string;
  totalAssets: number;
  balanceSheetItems: BalanceSheetItem[];
}

const ASSET_SUBCATEGORIES = [
  'commercial_loans', 'residential_mortgages', 'consumer_loans',
  'investment_securities', 'cash_equivalents', 'other_assets',
];

const LIABILITY_SUBCATEGORIES = [
  'demand_deposits', 'savings_deposits', 'time_deposits',
  'borrowings', 'subordinated_debt', 'other_liabilities',
];

const SUBCATEGORY_COLORS: Record<string, string> = {
  commercial_loans: 'border-l-blue-500',
  residential_mortgages: 'border-l-indigo-500',
  consumer_loans: 'border-l-cyan-500',
  investment_securities: 'border-l-purple-500',
  cash_equivalents: 'border-l-emerald-500',
  other_assets: 'border-l-slate-500',
  demand_deposits: 'border-l-green-500',
  savings_deposits: 'border-l-teal-500',
  time_deposits: 'border-l-amber-500',
  borrowings: 'border-l-orange-500',
  subordinated_debt: 'border-l-red-500',
  other_liabilities: 'border-l-slate-500',
};

const DURATION_BAR_COLORS: Record<string, string> = {
  commercial_loans: 'bg-blue-500/70',
  residential_mortgages: 'bg-indigo-500/70',
  consumer_loans: 'bg-cyan-500/70',
  investment_securities: 'bg-purple-500/70',
  cash_equivalents: 'bg-emerald-500/70',
  other_assets: 'bg-slate-500/70',
  demand_deposits: 'bg-green-500/70',
  savings_deposits: 'bg-teal-500/70',
  time_deposits: 'bg-amber-500/70',
  borrowings: 'bg-orange-500/70',
  subordinated_debt: 'bg-red-500/70',
  other_liabilities: 'bg-slate-500/70',
};

function emptyItem(category: 'asset' | 'liability'): BalanceSheetItem {
  return {
    category,
    subcategory: category === 'asset' ? 'commercial_loans' : 'demand_deposits',
    name: '',
    balance: 0,
    rate: 0,
    duration: 0,
    rateType: 'fixed',
  };
}

function formatSubcategory(sc: string): string {
  return sc.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function SkeletonPulse() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-6 bg-slate-800 rounded w-48" />
      <div className="grid grid-cols-4 gap-px bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-slate-900/80 px-4 py-4">
            <div className="h-3 bg-slate-800 rounded w-16 mb-3" />
            <div className="h-6 bg-slate-800 rounded w-24" />
          </div>
        ))}
      </div>
      <div className="h-96 bg-slate-900/40 rounded-xl border border-white/[0.06]" />
    </div>
  );
}

function DurationHeatmap({ items }: { items: BalanceSheetItem[] }) {
  // Group by subcategory, calculate weighted duration contribution
  const groups: Record<string, { subcategory: string; totalBalance: number; weightedDuration: number }> = {};
  items.forEach((item) => {
    if (!groups[item.subcategory]) {
      groups[item.subcategory] = { subcategory: item.subcategory, totalBalance: 0, weightedDuration: 0 };
    }
    groups[item.subcategory].totalBalance += Number(item.balance);
    groups[item.subcategory].weightedDuration += Number(item.balance) * Number(item.duration);
  });

  const segments = Object.values(groups)
    .map((g) => ({
      subcategory: g.subcategory,
      balance: g.totalBalance,
      avgDuration: g.totalBalance > 0 ? g.weightedDuration / g.totalBalance : 0,
      weight: g.totalBalance, // proportional width
    }))
    .filter((s) => s.balance > 0)
    .sort((a, b) => a.avgDuration - b.avgDuration);

  const totalBalance = segments.reduce((s, g) => s + g.balance, 0);
  if (totalBalance === 0) return null;

  return (
    <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration Distribution</h3>
        <span className="text-[10px] text-slate-600">Width = balance weight, position = avg duration</span>
      </div>

      {/* Bar */}
      <div className="flex rounded-lg overflow-hidden h-10 gap-px">
        {segments.map((seg) => {
          const widthPct = (seg.balance / totalBalance) * 100;
          if (widthPct < 1) return null;
          return (
            <div
              key={seg.subcategory}
              className={`${DURATION_BAR_COLORS[seg.subcategory] || 'bg-slate-500/70'} flex items-center justify-center transition-all relative group cursor-default`}
              style={{ width: `${widthPct}%`, minWidth: widthPct > 5 ? undefined : '20px' }}
              title={`${formatSubcategory(seg.subcategory)}: $${seg.balance.toFixed(0)}M, ${seg.avgDuration.toFixed(1)}yr avg`}
            >
              {widthPct > 12 && (
                <span className="text-[10px] text-white/90 font-medium truncate px-1">
                  {formatSubcategory(seg.subcategory).split(' ')[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {segments.map((seg) => (
          <div key={seg.subcategory} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-sm ${DURATION_BAR_COLORS[seg.subcategory] || 'bg-slate-500/70'}`} />
            <span className="text-[10px] text-slate-500">
              {formatSubcategory(seg.subcategory)} <span className="text-slate-400 font-mono">{seg.avgDuration.toFixed(1)}yr</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BalanceSheetErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-3xl border border-rose-500/20 bg-slate-900/90 p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10">
          <AlertTriangle className="h-6 w-6 text-rose-300" />
        </div>
        <h2 className="text-lg font-semibold text-white">Unable to load balance sheet</h2>
        <p className="mt-2 text-sm text-slate-300">{message}</p>
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-100"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

export default function BalanceSheetPage() {
  const { selectedId, institution: almInstitution } = useALM();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [items, setItems] = useState<BalanceSheetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'asset' | 'liability'>('asset');
  const [csvErrors, setCsvErrors] = useState<Array<{ row: number; field: string; message: string }>>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const fetchData = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getInstitution(selectedId);
      setInstitution(data);
      setItems(data.balanceSheetItems || []);
      setDirty(false);
    } catch (err: unknown) {
      setInstitution(null);
      setItems([]);
      if (isAuthError(err)) {
        return;
      }

      setError(
        getApiErrorMessage(
          err,
          'The balance-sheet service is unavailable right now. Please retry.'
        )
      );
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleItemChange = (index: number, field: keyof BalanceSheetItem, value: string | number) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setDirty(true);
  };

  const addItem = (category: 'asset' | 'liability') => {
    setItems((prev) => [...prev, emptyItem(category)]);
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = items.map((item) => ({
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        balance: Number(item.balance),
        rate: Number(item.rate),
        duration: Number(item.duration),
        repriceDate: item.repriceDate || undefined,
        maturityDate: item.maturityDate || undefined,
        rateType: item.rateType,
      }));
      await apiClient.importBalanceSheetItems(selectedId, payload);
      setSuccess(`Saved ${payload.length} items`);
      setDirty(false);
      analytics.track(EVENTS.ALM_ANALYSIS_RUN, {
        institutionId: selectedId,
        view: 'balance-sheet',
        action: 'save',
        itemCount: payload.length,
      });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedId) return;
    event.target.value = '';

    setUploading(true);
    setError(null);
    setCsvErrors([]);
    setCsvWarnings([]);

    try {
      // Server-side validation + import
      const result = await apiClient.uploadBalanceSheetCSV(selectedId, file);

      if (!result.valid) {
        setCsvErrors(result.errors || []);
        setCsvWarnings(result.warnings || []);
        setError(`CSV has ${result.errors?.length || 0} error(s) — fix and re-upload`);
        return;
      }

      setCsvWarnings(result.warnings || []);

      if (result.imported) {
        // Re-fetch to get the imported data from DB
        await fetchData();
        setSuccess(`Imported ${result.importedCount} items from CSV`);
      } else {
        // Dry run — load into local state for review
        setItems(result.items);
        setDirty(true);
        setSuccess(`Validated ${result.items.length} items from CSV — review and save`);
      }

      setTimeout(() => setSuccess(null), 5000);
      analytics.track(EVENTS.ALM_ANALYSIS_RUN, {
        institutionId: selectedId,
        view: 'balance-sheet',
        action: 'csv-upload',
        itemCount: result.summary?.validRows || 0,
      });
    } catch (err: unknown) {
      // Fallback to client-side parsing if server upload fails
      const message = err instanceof Error ? err.message : 'CSV upload failed';
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = (type: 'generic' | 'cooperativa') => {
    const a = document.createElement('a');
    a.href = getBalanceSheetTemplateUrl(type);
    a.download = `balance_sheet_template_${type}.csv`;
    a.click();
    setShowTemplateMenu(false);
  };

  const assets = items.filter((i) => i.category === 'asset');
  const liabilities = items.filter((i) => i.category === 'liability');
  const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + Number(l.balance), 0);
  const equity = totalAssets - totalLiabilities;
  const capitalRatio = totalAssets > 0 ? (equity / totalAssets) * 100 : 0;

  const currentItems = activeTab === 'asset' ? assets : liabilities;
  const subcategories = activeTab === 'asset' ? ASSET_SUBCATEGORIES : LIABILITY_SUBCATEGORIES;

  if (!selectedId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto" />
          <p className="text-slate-400 text-sm">No institution selected.</p>
        </div>
      </div>
    );
  }

  if (loading) return <SkeletonPulse />;

  if (error && !institution && items.length === 0) {
    return <BalanceSheetErrorState message={error} onRetry={() => void fetchData()} />;
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Table className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Balance Sheet</h1>
            <p className="text-xs text-slate-500">
              {institution?.name || almInstitution?.name || 'Institution'} &middot; Asset & Liability Positions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            className="hidden"
          />
          <div className="relative">
            <button
              onClick={() => setShowTemplateMenu(!showTemplateMenu)}
              className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg text-xs transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Template</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTemplateMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-20 min-w-[180px] py-1">
                <button
                  onClick={() => downloadTemplate('generic')}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06] transition"
                >
                  Generic (EN)
                </button>
                <button
                  onClick={() => downloadTemplate('cooperativa')}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06] transition"
                >
                  Cooperativa PR (ES)
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg text-xs transition disabled:opacity-40"
          >
            {uploading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{uploading ? 'Uploading...' : 'Upload CSV'}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
              dirty
                ? 'bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/25 text-purple-300'
                : 'bg-white/[0.04] border border-white/[0.08] text-slate-500'
            } disabled:opacity-40`}
          >
            {saving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : success ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {saving ? 'Saving...' : success ? 'Saved' : 'Save & Recalculate'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2.5 text-emerald-300 text-sm flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" /> {success}
        </div>
      )}

      {/* CSV Validation Errors */}
      {csvErrors.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
            <FileWarning className="h-4 w-4" /> CSV Validation Errors
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {csvErrors.map((err, i) => (
              <div key={i} className="text-xs text-red-300/80 font-mono pl-6">
                {err.row > 0 ? `Row ${err.row}` : 'File'}: <span className="text-red-400">{err.field}</span> — {err.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CSV Warnings */}
      {csvWarnings.length > 0 && csvErrors.length === 0 && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" /> Import Notes
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {csvWarnings.map((warn, i) => (
              <div key={i} className="text-xs text-amber-300/80 pl-6">{warn}</div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.06]">
        <div className="bg-slate-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Total Assets</p>
          <p className="text-xl font-bold text-white tabular-nums">${totalAssets.toFixed(1)}M</p>
          <p className="text-[11px] text-slate-500">{assets.length} positions</p>
        </div>
        <div className="bg-slate-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Total Liabilities</p>
          <p className="text-xl font-bold text-white tabular-nums">${totalLiabilities.toFixed(1)}M</p>
          <p className="text-[11px] text-slate-500">{liabilities.length} positions</p>
        </div>
        <div className="bg-slate-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Equity</p>
          <p className={`text-xl font-bold tabular-nums ${equity >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${equity.toFixed(1)}M
          </p>
          <p className="text-[11px] text-slate-500">Assets - Liabilities</p>
        </div>
        <div className="bg-slate-900/80 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1">Capital Ratio</p>
          <p className={`text-xl font-bold tabular-nums ${capitalRatio >= 8 ? 'text-emerald-400' : capitalRatio >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
            {capitalRatio.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">Equity / Assets</p>
        </div>
      </div>

      {/* Duration Heatmap */}
      {items.length > 0 && <DurationHeatmap items={items} />}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.06]">
        {(['asset', 'liability'] as const).map((tab) => {
          const count = tab === 'asset' ? assets.length : liabilities.length;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition relative ${
                isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'asset' ? 'Assets' : 'Liabilities'}
              <span className={`ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.04] text-slate-500'
              }`}>
                {count}
              </span>
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
              )}
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            onClick={() => addItem(activeTab)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] px-3 py-1.5 rounded-lg transition mb-1"
          >
            <Plus className="h-3 w-3" /> Add Row
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-2.5 pl-5 pr-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-40">Subcategory</th>
                <th className="text-left py-2.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-right py-2.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-28">Balance ($M)</th>
                <th className="text-right py-2.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-24">Rate (%)</th>
                <th className="text-right py-2.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-24">Duration</th>
                <th className="text-center py-2.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-20">Type</th>
                <th className="text-center py-2.5 pr-5 pl-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((item) => {
                const globalIdx = items.indexOf(item);
                const borderColor = SUBCATEGORY_COLORS[item.subcategory] || 'border-l-slate-500';
                return (
                  <tr
                    key={globalIdx}
                    className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition border-l-2 ${borderColor} group`}
                  >
                    <td className="py-2 pl-4 pr-2">
                      <select
                        value={item.subcategory}
                        onChange={(e) => handleItemChange(globalIdx, 'subcategory', e.target.value)}
                        className="w-full bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/[0.08] rounded px-1.5 py-1 text-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:bg-white/[0.04] cursor-pointer transition"
                      >
                        {subcategories.map((sc) => (
                          <option key={sc} value={sc} className="bg-slate-800">{formatSubcategory(sc)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => handleItemChange(globalIdx, 'name', e.target.value)}
                        placeholder="Position name..."
                        className="w-full bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/[0.08] rounded px-1.5 py-1 text-white text-xs placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:bg-white/[0.04] transition"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={item.balance || ''}
                        onChange={(e) => handleItemChange(globalIdx, 'balance', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/[0.08] rounded px-1.5 py-1 text-white text-right text-xs font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:bg-white/[0.04] transition"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={item.rate || ''}
                        onChange={(e) => handleItemChange(globalIdx, 'rate', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/[0.08] rounded px-1.5 py-1 text-white text-right text-xs font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:bg-white/[0.04] transition"
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono tabular-nums ${
                        item.duration > 3 ? 'text-amber-400' : 'text-slate-300'
                      }`}>
                        {item.duration}yr
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        item.rateType === 'fixed'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {item.rateType}
                      </span>
                    </td>
                    <td className="py-2 pr-4 pl-2 text-center">
                      <button
                        onClick={() => removeItem(globalIdx)}
                        className="text-slate-600 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {currentItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <DollarSign className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 mb-4">
                      No {activeTab === 'asset' ? 'asset' : 'liability'} positions yet
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] px-3 py-1.5 rounded-lg transition"
                      >
                        <Upload className="h-3 w-3" /> Upload CSV
                      </button>
                      <button
                        onClick={() => addItem(activeTab)}
                        className="flex items-center gap-1.5 text-xs text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20 px-3 py-1.5 rounded-lg transition"
                      >
                        <Plus className="h-3 w-3" /> Add Manually
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV Format Help */}
      <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">CSV Import Format</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase mb-1.5">Generic (EN)</p>
            <div className="bg-slate-950/50 rounded-lg p-3 font-mono text-[11px] text-slate-400 overflow-x-auto leading-relaxed">
              <p className="text-slate-500">category,subcategory,name,balance,rate,duration,rateType</p>
              <p>asset,commercial_loans,Commercial Real Estate,350,5.25,4.5,fixed</p>
              <p>liability,demand_deposits,Checking Accounts,200,0.5,0.1,variable</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase mb-1.5">Cooperativa PR (ES)</p>
            <div className="bg-slate-950/50 rounded-lg p-3 font-mono text-[11px] text-slate-400 overflow-x-auto leading-relaxed">
              <p className="text-slate-500">category,subcategory,name,balance,rate,duration,rateType</p>
              <p>asset,prestamos_personales,Pr&eacute;stamos Auto,75,8.50,3.0,fixed</p>
              <p>liability,ahorros_socios,Ahorros de Socios,85,1.75,0.3,variable</p>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Balance in $M &middot; Rate as % (auto-detected) &middot; Duration in years &middot; Accepts EN or ES subcategory names
        </p>
      </div>
    </div>
  );
}
