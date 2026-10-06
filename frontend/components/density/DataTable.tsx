import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n';
import type { LabelUnit } from '@/lib/alm/labels';
import { label } from '@/lib/alm/labels';
import { NumberCell } from './NumberCell';
import { TrendArrow } from './TrendArrow';
import { SparklineCell } from './SparklineCell';

/**
 * DataTable — dense tabular renderer with first-class quant types.
 *
 * Designed for the Bloomberg-density use case: dozens of rows, narrow
 * columns, monospace tabular numbers, sticky header, hover row highlight.
 *
 * Each column has a `kind` that determines rendering:
 *   - 'text'      → plain string
 *   - 'number'    → NumberCell with unit
 *   - 'delta'     → TrendArrow
 *   - 'sparkline' → SparklineCell from a number[] field
 *   - 'custom'    → caller supplies a render function
 *
 * Server-component-compatible. For interactive sorting / filtering, wrap in
 * a 'use client' component that hands sorted props down.
 *
 * Example:
 *   <DataTable
 *     rows={methods}
 *     locale={locale}
 *     columns={[
 *       { id: 'method',  header: 'Method',     kind: 'text',   accessor: r => r.label },
 *       { id: 'var',     headerKey: 'var95',   kind: 'number', accessor: r => r.var,    unit: 'USD_M' },
 *       { id: 'cvar',    headerKey: 'cvar',    kind: 'number', accessor: r => r.cvar,   unit: 'USD_M' },
 *       { id: 'spark',   header: '12d',        kind: 'sparkline', accessor: r => r.history },
 *     ]}
 *   />
 */

type ColumnKind = 'text' | 'number' | 'delta' | 'sparkline' | 'custom';

export interface DataTableColumn<Row> {
  id: string;
  /** Static header label (overrides headerKey) */
  header?: string;
  /** Backend label key — resolved via lib/alm/labels */
  headerKey?: string;
  kind: ColumnKind;
  accessor: (row: Row) => number | string | readonly number[] | null | undefined;
  unit?: LabelUnit;
  /** When true, downward delta is good (only meaningful for 'delta' kind) */
  invertedDelta?: boolean;
  /** Tailwind text alignment class (default: text-right for numeric, text-left for text) */
  align?: 'text-left' | 'text-right' | 'text-center';
  /** Tailwind width class, e.g. 'w-24' */
  width?: string;
  /** For 'custom' kind: caller-supplied render */
  render?: (row: Row, locale: Locale) => ReactNode;
}

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  locale: Locale;
  /** Stable React key extractor */
  rowKey: (row: Row, index: number) => string;
  /** Empty-state message */
  emptyText?: string;
  /** Sticky header (default true) */
  stickyHeader?: boolean;
  className?: string;
}

function defaultAlign(kind: ColumnKind): 'text-left' | 'text-right' {
  return kind === 'text' ? 'text-left' : 'text-right';
}

function renderCell<Row>(col: DataTableColumn<Row>, row: Row, locale: Locale): ReactNode {
  const value = col.accessor(row);
  switch (col.kind) {
    case 'text':
      return <span className="text-xs text-slate-700">{(value as string | null) ?? '—'}</span>;
    case 'number':
      return <NumberCell value={value as number | null} unit={col.unit} size="text-xs" />;
    case 'delta':
      return <TrendArrow delta={value as number | null} unit={col.unit} inverted={col.invertedDelta} />;
    case 'sparkline': {
      const arr = (value as readonly number[] | null) ?? [];
      return <SparklineCell values={arr} width={64} height={14} color="auto" />;
    }
    case 'custom':
      return col.render ? col.render(row, locale) : null;
  }
}

export function DataTable<Row>({
  rows,
  columns,
  locale,
  rowKey,
  emptyText = '—',
  stickyHeader = true,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <div className={`flex h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs text-slate-400 ${className ?? ''}`}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-slate-200 bg-white ${className ?? ''}`}>
      <table className="w-full border-collapse text-xs">
        <thead className={stickyHeader ? 'sticky top-0 z-10' : undefined}>
          <tr className="border-b border-slate-100 bg-slate-50/80">
            {columns.map((col) => {
              const align = col.align ?? defaultAlign(col.kind);
              const headerText = col.header ?? (col.headerKey ? label(col.headerKey, locale) : '');
              return (
                <th
                  key={col.id}
                  className={`${align} ${col.width ?? ''} px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500`}
                  scope="col"
                >
                  {headerText}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              {columns.map((col) => {
                const align = col.align ?? defaultAlign(col.kind);
                return (
                  <td
                    key={col.id}
                    className={`${align} ${col.width ?? ''} px-3 py-1.5 align-middle`}
                  >
                    {renderCell(col, row, locale)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
