import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SVGProps } from 'react';
import CompliancePage from './page';

vi.mock('@/components/brand/CerniqLogo', () => ({
  CerniqMark: () => <div data-testid="cerniq-mark" />,
}));

vi.mock('lucide-react', () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowLeft: Icon,
    ChevronRight: Icon,
    FileCheck: Icon,
    Files: Icon,
    ShieldCheck: Icon,
  };
});

describe('CompliancePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the shared compliance matrix as a buyer-facing artifact', () => {
    render(<CompliancePage />);

    expect(
      screen.getByRole('heading', {
        name: /Public compliance matrix for COSSEC, NCUA, Basel IRRBB, and CECL\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/20 mapped requirements/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^COSSEC$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^NCUA$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Basel IRRBB/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^CECL$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Scope and methodology/i)).toBeInTheDocument();
    expect(screen.getByText(/Important disclaimer/i)).toBeInTheDocument();
    expect(
      screen.getByText(/it does not certify regulatory compliance/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Each row maps a buyer-facing requirement/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/every green check is a module you can open right now/i),
    ).not.toBeInTheDocument();
  });
});
