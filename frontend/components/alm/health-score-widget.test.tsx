import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HealthScoreWidget from './health-score-widget';

describe('HealthScoreWidget', () => {
  // ─── Score rendering ────────────────────────────────────────────────────────

  it('renders the correct score value', () => {
    render(<HealthScoreWidget score={72} />);
    expect(screen.getByTestId('health-score-value')).toHaveTextContent('72');
  });

  it('rounds fractional scores', () => {
    render(<HealthScoreWidget score={65.7} />);
    expect(screen.getByTestId('health-score-value')).toHaveTextContent('66');
  });

  // ─── Color thresholds ──────────────────────────────────────────────────────

  it('shows HIGH RISK label for score 0-39', () => {
    render(<HealthScoreWidget score={25} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('HIGH RISK');
  });

  it('shows HIGH RISK label at the boundary (39)', () => {
    render(<HealthScoreWidget score={39} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('HIGH RISK');
  });

  it('shows MODERATE label for score 40-69', () => {
    render(<HealthScoreWidget score={55} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('MODERATE');
  });

  it('shows MODERATE label at the lower boundary (40)', () => {
    render(<HealthScoreWidget score={40} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('MODERATE');
  });

  it('shows HEALTHY label for score 70-100', () => {
    render(<HealthScoreWidget score={85} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('HEALTHY');
  });

  it('shows HEALTHY label at the lower boundary (70)', () => {
    render(<HealthScoreWidget score={70} />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('HEALTHY');
  });

  // ─── Bilingual labels ─────────────────────────────────────────────────────

  it('renders English labels by default', () => {
    render(<HealthScoreWidget score={85} />);
    expect(screen.getByText('Health Score')).toBeInTheDocument();
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('HEALTHY');
  });

  it('renders Spanish labels when locale=es', () => {
    render(<HealthScoreWidget score={85} locale="es" />);
    expect(screen.getByText('Puntaje de Salud')).toBeInTheDocument();
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('SALUDABLE');
  });

  it('renders Spanish HIGH RISK label', () => {
    render(<HealthScoreWidget score={20} locale="es" />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('ALTO RIESGO');
  });

  it('renders Spanish MODERATE label', () => {
    render(<HealthScoreWidget score={50} locale="es" />);
    expect(screen.getByTestId('health-score-label')).toHaveTextContent('MODERADO');
  });

  // ─── Variant rendering ────────────────────────────────────────────────────

  it('renders "/ 100" text in full variant', () => {
    render(<HealthScoreWidget score={75} variant="full" />);
    expect(screen.getByText('/ 100')).toBeInTheDocument();
  });

  it('does not render "/ 100" text in compact variant', () => {
    render(<HealthScoreWidget score={75} variant="compact" />);
    expect(screen.queryByText('/ 100')).not.toBeInTheDocument();
  });

  it('does not render sparkline in compact variant even with history', () => {
    render(
      <HealthScoreWidget score={75} variant="compact" history={[60, 65, 70, 72, 75]} />,
    );
    expect(screen.queryByTestId('health-score-sparkline')).not.toBeInTheDocument();
  });

  // ─── Confidence indicator ─────────────────────────────────────────────────

  it('does not render confidence indicator when not provided', () => {
    render(<HealthScoreWidget score={75} />);
    expect(screen.queryByTestId('health-score-confidence')).not.toBeInTheDocument();
  });

  it('renders confidence indicator when provided', () => {
    render(<HealthScoreWidget score={75} confidence="HIGH" />);
    const el = screen.getByTestId('health-score-confidence');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('High confidence');
  });

  it('renders confidence in Spanish', () => {
    render(<HealthScoreWidget score={75} confidence="MEDIUM" locale="es" />);
    expect(screen.getByTestId('health-score-confidence')).toHaveTextContent(
      'Confianza media',
    );
  });

  it('renders LOW confidence correctly', () => {
    render(<HealthScoreWidget score={30} confidence="LOW" />);
    expect(screen.getByTestId('health-score-confidence')).toHaveTextContent(
      'Low confidence',
    );
  });

  // ─── Sparkline / history ──────────────────────────────────────────────────

  it('renders sparkline when history has 2+ values in full variant', () => {
    render(
      <HealthScoreWidget score={80} variant="full" history={[60, 65, 70, 75, 80]} />,
    );
    expect(screen.getByTestId('health-score-sparkline')).toBeInTheDocument();
    expect(screen.getByText('Recent trend')).toBeInTheDocument();
  });

  it('does not render sparkline when history has fewer than 2 values', () => {
    render(<HealthScoreWidget score={80} variant="full" history={[80]} />);
    expect(screen.queryByTestId('health-score-sparkline')).not.toBeInTheDocument();
  });

  it('does not render sparkline when history is not provided', () => {
    render(<HealthScoreWidget score={80} variant="full" />);
    expect(screen.queryByTestId('health-score-sparkline')).not.toBeInTheDocument();
  });

  it('renders sparkline trend label in Spanish', () => {
    render(
      <HealthScoreWidget score={80} variant="full" history={[60, 70, 80]} locale="es" />,
    );
    expect(screen.getByText('Tendencia reciente')).toBeInTheDocument();
  });

  // ─── Accessibility ────────────────────────────────────────────────────────

  it('has an accessible label with score and status', () => {
    render(<HealthScoreWidget score={82} />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute(
      'aria-label',
      'Health Score: 82/100 - HEALTHY',
    );
  });

  it('has correct accessible label in Spanish', () => {
    render(<HealthScoreWidget score={35} locale="es" />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute(
      'aria-label',
      'Puntaje de Salud: 35/100 - ALTO RIESGO',
    );
  });
});
