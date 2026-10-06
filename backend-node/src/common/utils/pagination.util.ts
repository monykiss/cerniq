/**
 * Standardized pagination helper for consistent list responses.
 * Provides a uniform pagination envelope across all list endpoints.
 */

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Normalize pagination parameters with safe defaults.
 */
export function normalizePagination(params: PaginationParams): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Math.floor(Number(params.page) || DEFAULT_PAGE));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(Number(params.limit) || DEFAULT_LIMIT)),
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Build a standardized paginated response.
 */
export function paginate<T>(
  data: T[],
  totalItems: number,
  params: PaginationParams,
): PaginatedResult<T> {
  const { page, limit } = normalizePagination(params);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data,
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
