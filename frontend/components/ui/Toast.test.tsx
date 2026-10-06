import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from './Toast';

function TestConsumer() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast('Hello!', 'success')}>Show Toast</button>
  );
}

describe('Toast', () => {
  it('renders children inside the provider', () => {
    render(
      <ToastProvider>
        <p>App content</p>
      </ToastProvider>,
    );
    expect(screen.getByText('App content')).toBeInTheDocument();
  });

  it('useToast throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useToast must be used within a <ToastProvider>');
    spy.mockRestore();
  });

  it('shows a toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    const button = screen.getByText('Show Toast');
    button.click();

    expect(await screen.findByText('Hello!')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
