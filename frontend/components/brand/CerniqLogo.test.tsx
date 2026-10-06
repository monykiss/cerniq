import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CerniqMark, CerniqLockup } from './CerniqLogo';

describe('CerniqMark', () => {
  it('renders without crashing', () => {
    const { container } = render(<CerniqMark />);
    expect(container.querySelector('.cerniq-orbit')).toBeInTheDocument();
  });

  it('applies the default md size class', () => {
    const { container } = render(<CerniqMark />);
    const element = container.querySelector('.cerniq-orbit');
    expect(element?.className).toContain('h-16 w-16');
  });

  it('applies sm size class when size="sm"', () => {
    const { container } = render(<CerniqMark size="sm" />);
    const element = container.querySelector('.cerniq-orbit');
    expect(element?.className).toContain('h-12 w-12');
  });

  it('applies lg size class when size="lg"', () => {
    const { container } = render(<CerniqMark size="lg" />);
    const element = container.querySelector('.cerniq-orbit');
    expect(element?.className).toContain('h-24 w-24');
  });

  it('applies xl size class when size="xl"', () => {
    const { container } = render(<CerniqMark size="xl" />);
    const element = container.querySelector('.cerniq-orbit');
    expect(element?.className).toContain('h-36 w-36');
  });

  it('applies custom className', () => {
    const { container } = render(<CerniqMark className="my-custom-class" />);
    const element = container.querySelector('.cerniq-orbit');
    expect(element?.className).toContain('my-custom-class');
  });

  it('renders all orbit elements (rings, core, nodes)', () => {
    const { container } = render(<CerniqMark />);
    expect(container.querySelector('.cerniq-orbit-ring-primary')).toBeInTheDocument();
    expect(container.querySelector('.cerniq-orbit-ring-secondary')).toBeInTheDocument();
    expect(container.querySelector('.cerniq-orbit-ring-tertiary')).toBeInTheDocument();
    expect(container.querySelector('.cerniq-orbit-core')).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="cerniq-orbit-node"]')).toHaveLength(5);
  });
});

describe('CerniqLockup', () => {
  it('renders without crashing', () => {
    render(<CerniqLockup />);
    expect(screen.getByText('Cerniq')).toBeInTheDocument();
  });

  it('renders the default tagline', () => {
    render(<CerniqLockup />);
    expect(
      screen.getByText('Inteligencia de Riesgo Institucional')
    ).toBeInTheDocument();
  });

  it('renders a custom tagline', () => {
    render(<CerniqLockup tagline="Custom Tagline" />);
    expect(screen.getByText('Custom Tagline')).toBeInTheDocument();
  });

  it('does not render a tagline when tagline is empty', () => {
    render(<CerniqLockup tagline="" />);
    expect(
      screen.queryByText('Inteligencia de Riesgo Institucional')
    ).not.toBeInTheDocument();
  });

  it('uses compact styling when compact is true', () => {
    const { container } = render(<CerniqLockup compact />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('gap-3');
  });

  it('uses regular styling when compact is false', () => {
    const { container } = render(<CerniqLockup compact={false} />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('gap-4');
  });

  it('renders the CerniqMark with xl size by default', () => {
    const { container } = render(<CerniqLockup />);
    const mark = container.querySelector('.cerniq-orbit');
    expect(mark?.className).toContain('h-36 w-36');
  });

  it('renders the CerniqMark with sm size when compact', () => {
    const { container } = render(<CerniqLockup compact />);
    const mark = container.querySelector('.cerniq-orbit');
    expect(mark?.className).toContain('h-12 w-12');
  });
});
