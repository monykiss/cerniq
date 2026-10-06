import { normalizePagination, paginate } from './pagination.util';

describe('normalizePagination', () => {
  it('uses defaults when no params provided', () => {
    const result = normalizePagination({});
    expect(result).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('calculates correct skip for page 2', () => {
    const result = normalizePagination({ page: 2, limit: 10 });
    expect(result).toEqual({ page: 2, limit: 10, skip: 10 });
  });

  it('calculates correct skip for page 3 with limit 25', () => {
    const result = normalizePagination({ page: 3, limit: 25 });
    expect(result).toEqual({ page: 3, limit: 25, skip: 50 });
  });

  it('clamps page to minimum of 1', () => {
    const result = normalizePagination({ page: -5, limit: 20 });
    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('clamps page 0 to 1', () => {
    const result = normalizePagination({ page: 0, limit: 10 });
    expect(result.page).toBe(1);
  });

  it('caps limit at 100', () => {
    const result = normalizePagination({ page: 1, limit: 500 });
    expect(result.limit).toBe(100);
  });

  it('clamps limit to minimum of 1', () => {
    const result = normalizePagination({ page: 1, limit: -10 });
    expect(result.limit).toBe(1);
  });

  it('floors fractional page numbers', () => {
    const result = normalizePagination({ page: 2.7, limit: 10 });
    expect(result.page).toBe(2);
    expect(result.skip).toBe(10);
  });

  it('handles NaN page gracefully', () => {
    const result = normalizePagination({ page: NaN, limit: 10 });
    expect(result.page).toBe(1);
  });
});

describe('paginate', () => {
  const items = ['a', 'b', 'c'];

  it('builds correct response for first page', () => {
    const result = paginate(items, 50, { page: 1, limit: 10 });
    expect(result.data).toEqual(items);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(10);
    expect(result.meta.totalItems).toBe(50);
    expect(result.meta.totalPages).toBe(5);
    expect(result.meta.hasNextPage).toBe(true);
    expect(result.meta.hasPreviousPage).toBe(false);
  });

  it('builds correct response for last page', () => {
    const result = paginate(items, 50, { page: 5, limit: 10 });
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.hasPreviousPage).toBe(true);
  });

  it('builds correct response for middle page', () => {
    const result = paginate(items, 100, { page: 3, limit: 20 });
    expect(result.meta.hasNextPage).toBe(true);
    expect(result.meta.hasPreviousPage).toBe(true);
    expect(result.meta.totalPages).toBe(5);
  });

  it('handles single page of results', () => {
    const result = paginate(items, 3, { page: 1, limit: 10 });
    expect(result.meta.totalPages).toBe(1);
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.hasPreviousPage).toBe(false);
  });

  it('handles empty data', () => {
    const result = paginate([], 0, { page: 1, limit: 10 });
    expect(result.data).toEqual([]);
    expect(result.meta.totalPages).toBe(0);
    expect(result.meta.hasNextPage).toBe(false);
  });
});
