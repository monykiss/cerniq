import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import ScenarioChart from './ScenarioChart';

// Mock recharts — ResponsiveContainer has issues in jsdom; stub all chart components
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children?: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  Cell: () => <div />,
  ReferenceLine: () => <div />,
}));

const mockScenarios = [
  { name: '+200bp', shiftBps: 200, niImpact: 1.5, niImpactPct: 3.2, mveImpact: -2.1, mveImpactPct: -4.5 },
  { name: 'Base', shiftBps: 0, niImpact: 0, niImpactPct: 0, mveImpact: 0, mveImpactPct: 0 },
  { name: '-200bp', shiftBps: -200, niImpact: -1.2, niImpactPct: -2.6, mveImpact: 1.8, mveImpactPct: 3.9 },
];

describe('ScenarioChart', () => {
  it('renders without crashing', () => {
    const { container } = render(<ScenarioChart scenarios={mockScenarios} />);
    expect(container).toBeTruthy();
  });

  it('renders the title when provided', () => {
    render(<ScenarioChart scenarios={mockScenarios} title="NII Impact by Scenario" />);
    expect(screen.getByText('NII Impact by Scenario')).toBeInTheDocument();
  });

  it('renders the chart container', () => {
    render(<ScenarioChart scenarios={mockScenarios} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('renders with custom title and dataKey', () => {
    render(
      <ScenarioChart
        scenarios={mockScenarios}
        dataKey="mveImpact"
        title="MVE Impact"
        yAxisLabel="$ Millions"
      />,
    );
    expect(screen.getByText('MVE Impact')).toBeInTheDocument();
  });
});
