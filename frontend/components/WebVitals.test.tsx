import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WebVitals } from './WebVitals';

// Mock the dynamic imports
vi.mock('web-vitals', () => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
  onINP: vi.fn(),
}));

vi.mock('@/lib/web-vitals', () => ({
  reportWebVital: vi.fn(),
}));

describe('WebVitals', () => {
  it('renders null (no visible output)', () => {
    const { container } = render(<WebVitals />);
    expect(container.innerHTML).toBe('');
  });

  it('does not throw when rendered', () => {
    expect(() => render(<WebVitals />)).not.toThrow();
  });
});
