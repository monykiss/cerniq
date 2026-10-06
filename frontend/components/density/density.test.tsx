/**
 * Density primitive tests. Focus on the states that break silently in
 * production but never in happy-path demo data:
 *   - null / NaN values
 *   - empty arrays
 *   - boundary conditions (1 point, 2 points)
 *   - locale switching
 *   - unit formatting across every LabelUnit variant
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NumberCell } from './NumberCell';
import { TrendArrow } from './TrendArrow';
import { SparklineCell } from './SparklineCell';
import { MetricStrip } from './MetricStrip';
import { DataTable, type DataTableColumn } from './DataTable';

// ─── NumberCell ─────────────────────────────────────────────────────────────

describe('NumberCell', () => {
  it('renders a percent with default precision', () => {
    render(<NumberCell value={3.521} unit="%" />);
    expect(screen.getByText('3.52%')).toBeInTheDocument();
  });

  it('renders USD millions with M suffix and dollar prefix', () => {
    render(<NumberCell value={445.7} unit="USD_M" />);
    // 445.7 → $445.7M (1 decimal default for USD_M)
    expect(screen.getByText('$445.7M')).toBeInTheDocument();
  });

  it('converts ratio to percent', () => {
    render(<NumberCell value={0.0421} unit="ratio" />);
    // 0.0421 * 100 = 4.21, precision 4 by default for ratio → '4.2100'
    expect(screen.getByText(/4\.21.*%/)).toBeInTheDocument();
  });

  it('renders em-dash for null value', () => {
    render(<NumberCell value={null} unit="%" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders em-dash for undefined value', () => {
    render(<NumberCell value={undefined} unit="%" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders em-dash for NaN value', () => {
    render(<NumberCell value={NaN} unit="%" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('colors negative values rose when signed', () => {
    const { container } = render(<NumberCell value={-3.5} unit="%" signed />);
    const el = container.querySelector('span');
    expect(el?.className).toContain('text-rose-700');
    expect(el?.textContent).toContain('−'); // Uses the typographic minus, not hyphen
  });

  it('colors positive values emerald when signed', () => {
    const { container } = render(<NumberCell value={2.1} unit="%" signed />);
    const el = container.querySelector('span');
    expect(el?.className).toContain('text-emerald-700');
  });

  it('adds explicit + sign when explicitSign=true and value > 0', () => {
    render(<NumberCell value={5} unit="bps" explicitSign />);
    expect(screen.getByText(/\+5 bps/)).toBeInTheDocument();
  });

  it('respects precision override', () => {
    render(<NumberCell value={3.14159} unit="%" precision={4} />);
    expect(screen.getByText('3.1416%')).toBeInTheDocument();
  });

  it('uses tabular-nums class for consistent column alignment', () => {
    const { container } = render(<NumberCell value={1} unit="%" />);
    expect(container.querySelector('span')?.className).toContain('tabular-nums');
  });
});

// ─── TrendArrow ─────────────────────────────────────────────────────────────

describe('TrendArrow', () => {
  it('renders ▲ for positive delta', () => {
    render(<TrendArrow delta={0.34} unit="%" />);
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });

  it('renders ▼ for negative delta', () => {
    render(<TrendArrow delta={-0.5} unit="%" />);
    expect(screen.getByText(/▼/)).toBeInTheDocument();
  });

  it('renders ─ for zero delta', () => {
    render(<TrendArrow delta={0} unit="%" />);
    expect(screen.getByText(/─/)).toBeInTheDocument();
  });

  it('inverted=true flips color semantics (down=good=emerald)', () => {
    const { container } = render(<TrendArrow delta={-0.3} unit="%" inverted />);
    // Negative delta + inverted = positive signal = emerald
    expect(container.querySelector('span')?.className).toContain('text-emerald-600');
  });

  it('renders em-dash for null delta', () => {
    render(<TrendArrow delta={null} unit="%" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('uses bps formatting for bps unit (0 decimals)', () => {
    render(<TrendArrow delta={12.7} unit="bps" />);
    expect(screen.getByText(/13 bps/)).toBeInTheDocument();
  });

  it('arrowOnly mode hides the numeric label', () => {
    render(<TrendArrow delta={0.5} unit="%" arrowOnly />);
    expect(screen.queryByText(/\+0\.50/)).toBeNull();
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });

  it('uses typographic minus for negative values', () => {
    render(<TrendArrow delta={-0.5} unit="%" />);
    expect(screen.getByText(/−/)).toBeInTheDocument(); // Unicode U+2212
  });
});

// ─── SparklineCell ──────────────────────────────────────────────────────────

describe('SparklineCell', () => {
  it('renders a horizontal baseline for empty values', () => {
    const { container } = render(<SparklineCell values={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelector('line')).toBeInTheDocument();
  });

  it('renders a horizontal baseline for single-point values', () => {
    const { container } = render(<SparklineCell values={[1]} />);
    expect(container.querySelector('line')).toBeInTheDocument();
    // No path should be drawn with <2 points
    expect(container.querySelector('path')).toBeNull();
  });

  it('renders a path for >= 2 points', () => {
    const { container } = render(<SparklineCell values={[1, 2, 3, 4]} />);
    const path = container.querySelector('path');
    expect(path).toBeInTheDocument();
    // Path d attribute should start with M (moveTo)
    expect(path?.getAttribute('d')).toMatch(/^M/);
  });

  it('renders end dot by default', () => {
    const { container } = render(<SparklineCell values={[1, 2, 3]} />);
    expect(container.querySelector('circle')).toBeInTheDocument();
  });

  it('hides end dot when showEndDot=false', () => {
    const { container } = render(<SparklineCell values={[1, 2, 3]} showEndDot={false} />);
    expect(container.querySelector('circle')).toBeNull();
  });

  it('uses custom width/height props', () => {
    const { container } = render(<SparklineCell values={[1, 2]} width={100} height={30} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('30');
  });

  it('handles constant-value series without NaN division', () => {
    const { container } = render(<SparklineCell values={[5, 5, 5]} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).not.toContain('NaN');
  });
});

// ─── MetricStrip ────────────────────────────────────────────────────────────

describe('MetricStrip', () => {
  it('renders nothing for empty items', () => {
    const { container } = render(<MetricStrip items={[]} locale="en" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders bilingual labels resolved via the labels dictionary', () => {
    render(
      <MetricStrip
        items={[
          { key: 'nim', value: 3.5 },
          { key: 'lcr', value: 115 },
        ]}
        locale="en"
      />,
    );
    expect(screen.getByText('Net Interest Margin')).toBeInTheDocument();
    expect(screen.getByText('Liquidity Coverage Ratio')).toBeInTheDocument();
  });

  it('switches label language with locale prop', () => {
    const { rerender } = render(
      <MetricStrip items={[{ key: 'nim', value: 3.5 }]} locale="en" />,
    );
    expect(screen.getByText('Net Interest Margin')).toBeInTheDocument();
    rerender(<MetricStrip items={[{ key: 'nim', value: 3.5 }]} locale="es" />);
    expect(screen.getByText('Margen de Interés Neto')).toBeInTheDocument();
  });

  it('renders delta arrow when delta is provided', () => {
    render(
      <MetricStrip
        items={[{ key: 'nim', value: 3.5, delta: 0.12 }]}
        locale="en"
      />,
    );
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });

  it('omits delta arrow when delta is absent', () => {
    render(
      <MetricStrip items={[{ key: 'nim', value: 3.5 }]} locale="en" />,
    );
    expect(screen.queryByText(/▲|▼|─/)).toBeNull();
  });

  it('accepts an explicit label override', () => {
    render(
      <MetricStrip
        items={[{ key: 'nim', value: 3.5, label: 'Custom Label' }]}
        locale="en"
      />,
    );
    expect(screen.getByText('Custom Label')).toBeInTheDocument();
    expect(screen.queryByText('Net Interest Margin')).toBeNull();
  });

  it('has role=group with aria-label for a11y', () => {
    render(
      <MetricStrip items={[{ key: 'nim', value: 3.5 }]} locale="en" />,
    );
    expect(screen.getByRole('group', { name: /key metrics/i })).toBeInTheDocument();
  });

  it('renders a sparkline when trend is provided in standard density', () => {
    const { container } = render(
      <MetricStrip
        items={[{ key: 'nim', value: 3.5, trend: [3.1, 3.2, 3.3, 3.5] }]}
        locale="en"
        density="standard"
      />,
    );
    expect(container.querySelector('svg path')).toBeInTheDocument();
  });

  it('hides sparklines in compact density', () => {
    const { container } = render(
      <MetricStrip
        items={[{ key: 'nim', value: 3.5, trend: [3.1, 3.2, 3.3] }]}
        locale="en"
        density="compact"
      />,
    );
    expect(container.querySelector('svg path')).toBeNull();
  });
});

// ─── DataTable ──────────────────────────────────────────────────────────────

interface Row {
  method: string;
  var: number;
  cvar: number;
  history: readonly number[];
  delta: number;
}

const sampleRows: readonly Row[] = [
  { method: 'Historical', var: 9.3, cvar: 12.1, history: [8.9, 9.1, 9.3], delta: 0.2 },
  { method: 'Parametric', var: 8.7, cvar: 10.8, history: [8.5, 8.6, 8.7], delta: 0.1 },
];

describe('DataTable', () => {
  const columns: readonly DataTableColumn<Row>[] = [
    { id: 'method', header: 'Method', kind: 'text', accessor: (r) => r.method },
    { id: 'var',    headerKey: 'var', kind: 'number', accessor: (r) => r.var, unit: 'USD_M' },
    { id: 'cvar',   headerKey: 'cvar', kind: 'number', accessor: (r) => r.cvar, unit: 'USD_M' },
    { id: 'delta',  header: 'Δ', kind: 'delta', accessor: (r) => r.delta, unit: '%' },
    { id: 'spark',  header: '12d', kind: 'sparkline', accessor: (r) => r.history },
  ];

  it('renders the empty state for no rows', () => {
    render(
      <DataTable rows={[]} columns={columns} locale="en" rowKey={(r) => r.method} emptyText="No data" />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders a thead with resolved headers (static + headerKey)', () => {
    render(
      <DataTable rows={sampleRows} columns={columns} locale="en" rowKey={(r) => r.method} />,
    );
    expect(screen.getByText('Method')).toBeInTheDocument();
    // headerKey='var' resolves via labels dictionary
    expect(screen.getByText('Value at Risk')).toBeInTheDocument();
    expect(screen.getByText('CVaR / Expected Shortfall')).toBeInTheDocument();
  });

  it('resolves headerKey through the labels dictionary (locale-aware)', () => {
    render(
      <DataTable rows={sampleRows} columns={columns} locale="es" rowKey={(r) => r.method} />,
    );
    expect(screen.getByText('Valor en Riesgo')).toBeInTheDocument();
  });

  it('renders NumberCell formatted values', () => {
    render(
      <DataTable rows={sampleRows} columns={columns} locale="en" rowKey={(r) => r.method} />,
    );
    expect(screen.getByText('$9.3M')).toBeInTheDocument();
    expect(screen.getByText('$12.1M')).toBeInTheDocument();
  });

  it('renders delta arrows via TrendArrow', () => {
    render(
      <DataTable rows={sampleRows} columns={columns} locale="en" rowKey={(r) => r.method} />,
    );
    // Both rows have positive deltas → two ▲
    expect(screen.getAllByText(/▲/).length).toBe(2);
  });

  it('renders sparkline SVGs for sparkline kind', () => {
    const { container } = render(
      <DataTable rows={sampleRows} columns={columns} locale="en" rowKey={(r) => r.method} />,
    );
    // 2 rows × 1 sparkline column = 2 SVGs with path
    expect(container.querySelectorAll('svg path').length).toBe(2);
  });

  it('uses stable row keys from rowKey callback', () => {
    const { container } = render(
      <DataTable rows={sampleRows} columns={columns} locale="en" rowKey={(r) => r.method} />,
    );
    // If rowKey is being called, there should be exactly 2 data rows in tbody
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('renders custom column render function', () => {
    const customColumns: DataTableColumn<Row>[] = [
      {
        id: 'custom',
        header: 'Custom',
        kind: 'custom',
        accessor: (r) => r.method,
        render: (r) => <strong data-testid="custom-cell">{r.method.toUpperCase()}</strong>,
      },
    ];
    render(
      <DataTable rows={sampleRows} columns={customColumns} locale="en" rowKey={(r) => r.method} />,
    );
    const cells = screen.getAllByTestId('custom-cell');
    expect(cells[0]?.textContent).toBe('HISTORICAL');
    expect(cells[1]?.textContent).toBe('PARAMETRIC');
  });
});

