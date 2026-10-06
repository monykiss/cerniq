import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode, SVGProps } from 'react';
import AnalystPage from './page';

const { useALMMock } = vi.hoisted(() => ({
  useALMMock: vi.fn(),
}));

vi.mock('@/components/alm/ALMProvider', () => ({
  useALM: useALMMock,
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: 'en' }),
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    MessageSquare: Icon,
    Send: Icon,
    AlertTriangle: Icon,
    Building2: Icon,
  };
});

vi.mock('recharts', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Wrap,
    Bar: Wrap,
    XAxis: Wrap,
    YAxis: Wrap,
    CartesianGrid: Wrap,
    Tooltip: Wrap,
    ResponsiveContainer: Wrap,
    Cell: Wrap,
  };
});

describe('AnalystPage', () => {
  it('shows the shared institution-required state when no institution is selected', () => {
    useALMMock.mockReturnValue({ selectedId: '' });

    render(<AnalystPage />);

    expect(screen.getByText(/institution required/i)).toBeInTheDocument();
    expect(
      screen.getByText(/open conversational alm analyst/i),
    ).toBeInTheDocument();
  });
});
