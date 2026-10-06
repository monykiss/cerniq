import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AlmDataUnavailable } from './AlmDataUnavailable';
import type { DataGap } from '@/hooks/useReportDataGaps';

const gaps: DataGap[] = [
  {
    field: 'nimAttribution.balanceSheet',
    reason: 'EMPTY_BALANCE_SHEET',
    severity: 'CRITICAL',
    action: 'Load the balance sheet to attribute the NIM change.',
  },
];

describe('AlmDataUnavailable', () => {
  it('renders the neutral data-unavailable headline (never a pass/breach)', () => {
    render(<AlmDataUnavailable gaps={gaps} />);
    expect(screen.getByText(/Data Unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('surfaces the backend gap manifest via DataGapBanner', () => {
    render(<AlmDataUnavailable gaps={gaps} />);
    // The banner summarizes the critical count.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/critical gap/i)).toBeInTheDocument();
  });

  it('renders a domain-specific lead message when provided', () => {
    render(
      <AlmDataUnavailable
        gaps={gaps}
        message={{ en: 'Load earning assets to compute NIM.', es: 'Cargue activos.' }}
      />,
    );
    expect(
      screen.getByText(/Load earning assets to compute NIM/i),
    ).toBeInTheDocument();
  });

  it('renders cleanly with no gaps (banner suppressed)', () => {
    render(<AlmDataUnavailable />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
