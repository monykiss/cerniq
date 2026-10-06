import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  account: string;
  balance: number;
}

const ROWS: Row[] = [
  { id: '1', account: 'Cash', balance: 100 },
  { id: '2', account: 'AR', balance: 300 },
  { id: '3', account: 'AP', balance: 200 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'account', header: 'Account', cell: (r) => r.account, sortValue: (r) => r.account },
  {
    key: 'balance',
    header: 'Balance',
    cell: (r) => `$${r.balance}`,
    sortValue: (r) => r.balance,
    align: 'right',
    numeric: true,
  },
];

describe('DataTable', () => {
  it('renders rows and columns', () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('cerniq-dashboard-surface');
  });

  it('shows empty state when rows are empty', () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r: Row) => r.id} emptyMessage="Nothing here" />);
    const message = screen.getByText('Nothing here');
    expect(message).toBeInTheDocument();
    expect(message.closest('div')).toHaveClass('cerniq-dashboard-surface');
  });

  it('sorts ascending by clicking a sortable header', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByText('Balance'));
    const cells = screen.getAllByText(/\$/);
    expect(cells[0].textContent).toBe('$100');
    expect(cells[2].textContent).toBe('$300');
  });

  it('toggles to descending on second click', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByText('Balance'));
    fireEvent.click(screen.getByText('Balance'));
    const cells = screen.getAllByText(/\$/);
    expect(cells[0].textContent).toBe('$300');
    expect(cells[2].textContent).toBe('$100');
  });

  it('fires onRowClick with the row data', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Cash'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('renders the optional caption', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Recent" />);
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });
});
