import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScenarioInput, { type ScenarioParams } from './scenario-input';

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function renderComponent(overrides: Partial<React.ComponentProps<typeof ScenarioInput>> = {}) {
  const onRun = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <ScenarioInput onRun={onRun} onSave={onSave} {...overrides} />,
  );
  return { ...utils, onRun, onSave };
}

/* ── Tests ───────────────────────────────────────────────────────────────────── */

describe('ScenarioInput', () => {
  it('renders without crashing', () => {
    const { container } = renderComponent();
    expect(container).toBeTruthy();
  });

  it('renders the title in English by default', () => {
    renderComponent();
    expect(screen.getByText('Scenario Builder')).toBeInTheDocument();
  });

  it('renders bilingual labels in Spanish when locale is es', () => {
    renderComponent({ locale: 'es' });
    expect(screen.getByText('Constructor de Escenarios')).toBeInTheDocument();
    expect(screen.getByText('Choque de Tasa (pbs)')).toBeInTheDocument();
    expect(screen.getByText('Tasa de Retiro de Depositos (%)')).toBeInTheDocument();
    expect(screen.getByText('Multiplicador de Prepago')).toBeInTheDocument();
  });

  it('renders all 6 preset scenario buttons', () => {
    renderComponent();
    expect(screen.getByText('Parallel +200')).toBeInTheDocument();
    expect(screen.getByText('Parallel -100')).toBeInTheDocument();
    expect(screen.getByText('Steepening')).toBeInTheDocument();
    expect(screen.getByText('Flattening')).toBeInTheDocument();
    expect(screen.getByText('PR Recession')).toBeInTheDocument();
    expect(screen.getByText('Hurricane Stress')).toBeInTheDocument();
  });

  it('renders preset buttons in Spanish when locale is es', () => {
    renderComponent({ locale: 'es' });
    expect(screen.getByText('Paralelo +200')).toBeInTheDocument();
    expect(screen.getByText('Paralelo -100')).toBeInTheDocument();
    expect(screen.getByText('Empinamiento')).toBeInTheDocument();
    expect(screen.getByText('Aplanamiento')).toBeInTheDocument();
    expect(screen.getByText('Recesion PR')).toBeInTheDocument();
    expect(screen.getByText('Estres Huracan')).toBeInTheDocument();
  });

  describe('slider ranges', () => {
    it('Rate Shock slider has correct range -400 to +400 with step 25', () => {
      renderComponent();
      const slider = screen.getByRole('slider', { name: /rate shock/i });
      expect(slider).toHaveAttribute('min', '-400');
      expect(slider).toHaveAttribute('max', '400');
      expect(slider).toHaveAttribute('step', '25');
    });

    it('Deposit Runoff slider has correct range 0 to 50', () => {
      renderComponent();
      const slider = screen.getByRole('slider', { name: /deposit runoff/i });
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '50');
      expect(slider).toHaveAttribute('step', '1');
    });

    it('Prepayment Multiplier slider has correct range 0.5 to 3.0', () => {
      renderComponent();
      const slider = screen.getByRole('slider', { name: /prepayment/i });
      expect(slider).toHaveAttribute('min', '0.5');
      expect(slider).toHaveAttribute('max', '3');
      expect(slider).toHaveAttribute('step', '0.1');
    });

    it('Credit Loss slider has correct range 0 to 10', () => {
      renderComponent();
      const slider = screen.getByRole('slider', { name: /credit loss/i });
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '10');
      expect(slider).toHaveAttribute('step', '0.1');
    });
  });

  describe('preset buttons set correct values', () => {
    it('clicking "Parallel +200" sets rate shock to 200', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByTestId('preset-parallel_up_200'));

      const slider = screen.getByRole('slider', { name: /rate shock/i });
      expect(slider).toHaveValue('200');
    });

    it('clicking "Parallel -100" sets rate shock to -100', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByTestId('preset-parallel_down_100'));

      const slider = screen.getByRole('slider', { name: /rate shock/i });
      expect(slider).toHaveValue('-100');
    });

    it('clicking "PR Recession" sets multiple parameters', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByTestId('preset-pr_recession'));

      const rateSlider = screen.getByRole('slider', { name: /rate shock/i });
      const depositSlider = screen.getByRole('slider', { name: /deposit runoff/i });
      expect(rateSlider).toHaveValue('-200');
      expect(depositSlider).toHaveValue('15');
    });
  });

  describe('onRun callback', () => {
    it('fires onRun with default params when clicking Run', async () => {
      const user = userEvent.setup();
      const { onRun } = renderComponent();

      await user.click(screen.getByTestId('run-scenario'));

      expect(onRun).toHaveBeenCalledTimes(1);
      const params: ScenarioParams = onRun.mock.calls[0][0];
      expect(params.rateShockBps).toBe(0);
      expect(params.depositRunoffPct).toBe(0);
      expect(params.prepaymentMultiplier).toBe(1.0);
      expect(params.creditLossOverridePct).toBe(0);
    });

    it('fires onRun with correct params after selecting a preset', async () => {
      const user = userEvent.setup();
      const { onRun } = renderComponent();

      await user.click(screen.getByTestId('preset-hurricane_stress'));
      await user.click(screen.getByTestId('run-scenario'));

      expect(onRun).toHaveBeenCalledTimes(1);
      const params: ScenarioParams = onRun.mock.calls[0][0];
      expect(params.rateShockBps).toBe(-100);
      expect(params.depositRunoffPct).toBe(25);
      expect(params.prepaymentMultiplier).toBe(0.5);
      expect(params.creditLossOverridePct).toBe(7.0);
      expect(params.scenarioType).toBe('hurricane_stress');
    });

    it('fires onRun with defaultValues when provided', async () => {
      const user = userEvent.setup();
      const { onRun } = renderComponent({
        defaultValues: { rateShockBps: 100, depositRunoffPct: 10 },
      });

      await user.click(screen.getByTestId('run-scenario'));

      const params: ScenarioParams = onRun.mock.calls[0][0];
      expect(params.rateShockBps).toBe(100);
      expect(params.depositRunoffPct).toBe(10);
    });
  });

  describe('slider interaction', () => {
    it('slider value updates when changed via range input', () => {
      renderComponent();
      const slider = screen.getByRole('slider', { name: /rate shock/i });

      fireEvent.change(slider, { target: { value: '200' } });

      expect(slider).toHaveValue('200');
    });
  });

  describe('save dialog', () => {
    it('opens save dialog when clicking Save', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Save Scenario'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('calls onSave with name when saving', async () => {
      const user = userEvent.setup();
      const { onSave } = renderComponent();

      await user.click(screen.getByText('Save Scenario'));
      await user.type(screen.getByPlaceholderText('e.g., Q3 Stress Test'), 'My Test');
      await user.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][1]).toBe('My Test');
    });
  });
});
