import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalError from './global-error';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

describe('GlobalError', () => {
  const mockError = Object.assign(new Error('Test crash'), { digest: 'abc123' });
  const mockReset = vi.fn();

  it('renders the error message', () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('displays the error digest when present', () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    expect(screen.getByText(/Error ID: abc123/)).toBeInTheDocument();
  });

  it('calls reset when "Try again" button is clicked', () => {
    render(<GlobalError error={mockError} reset={mockReset} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('does not display error digest when absent', () => {
    const errorNoDigest = new Error('No digest') as Error & { digest?: string };
    render(<GlobalError error={errorNoDigest} reset={mockReset} />);
    expect(screen.queryByText(/Error ID/)).not.toBeInTheDocument();
  });
});
