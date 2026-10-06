import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AlmSampleDataBanner } from './AlmSampleDataBanner';

const { localeRef } = vi.hoisted(() => ({ localeRef: { current: 'en' } }));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ locale: localeRef.current }),
}));

describe('AlmSampleDataBanner', () => {
  it('renders the English labeled-demo notice', () => {
    localeRef.current = 'en';
    render(<AlmSampleDataBanner />);

    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
    expect(
      screen.getByText(/connect your institution for live analysis/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders the Spanish labeled-demo notice', () => {
    localeRef.current = 'es';
    render(<AlmSampleDataBanner />);

    expect(screen.getByText(/datos de muestra/i)).toBeInTheDocument();
    expect(
      screen.getByText(/conecte su institución para análisis en vivo/i),
    ).toBeInTheDocument();
  });
});
