import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricStrip } from './MetricStrip';

describe('MetricStrip', () => {
  it('renders all items', () => {
    const { container } = render(
      <MetricStrip
        items={[
          { label: 'Open cycles', value: 3 },
          { label: 'In review', value: 1 },
          { label: 'Avg days', value: '4.2' },
        ]}
      />,
    );
    expect(screen.getByText('Open cycles')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('cerniq-dashboard-surface');
  });

  it('applies positive delta in green', () => {
    render(<MetricStrip items={[{ label: 'Foo', value: 100, delta: 5, deltaFormat: 'percent' }]} />);
    const delta = screen.getByText('+5.0%');
    expect(delta.className).toContain('emerald');
  });

  it('applies negative delta in red', () => {
    render(<MetricStrip items={[{ label: 'Foo', value: 100, delta: -3, deltaFormat: 'percent' }]} />);
    const delta = screen.getByText('-3.0%');
    expect(delta.className).toContain('rose');
  });

  it('formats currency deltas', () => {
    render(<MetricStrip items={[{ label: 'Δ Cash', value: '$1.2M', delta: 50000, deltaFormat: 'currency' }]} />);
    expect(screen.getByText('+$50,000')).toBeInTheDocument();
  });

  it('renders clickable metrics as buttons', () => {
    const handler = vi.fn();
    render(<MetricStrip items={[{ label: 'Click me', value: 7, onClick: handler }]} />);
    const btn = screen.getByRole('listitem');
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
