import type { ApiErrorPayload } from './api-error.js';
import type { PaginationMeta } from './pagination.js';

/** Marker used to distinguish a paged payload from arbitrary domain objects. */
export const PAGINATED_DATA = Symbol('paginated-data');

/** Envelope returned by every successful endpoint. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/** Envelope returned by every failing endpoint. */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

/** Discriminated union of the two response envelopes. */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Successful list payload.
 *
 * The rows live under `page` and the metadata under `pagination`, matching the
 * project-wide list contract: `{ success: true, data: { page, pagination } }`.
 */
export interface PaginatedData<T> {
  [PAGINATED_DATA]: true;
  page: T[];
  pagination: PaginationMeta;
}

/**
 * Marks a controller return value as a paged payload.
 *
 * The symbol key never appears in JSON, so the HTTP body contains only
 * `page` and `pagination`.
 *
 * @param page - Rows on the current page.
 * @param pagination - Pagination metadata.
 * @returns The marked payload for `ApiResponseInterceptor`.
 */
export function paginated<T>(
  page: T[],
  pagination: PaginationMeta,
): PaginatedData<T> {
  return {
    [PAGINATED_DATA]: true,
    page,
    pagination,
  };
}

/**
 * Narrows an unknown controller result to a paged payload.
 *
 * @param value - Controller return value.
 * @returns `true` when the value was created by `paginated()`.
 */
export function isPaginatedData(
  value: unknown,
): value is PaginatedData<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[PAGINATED_DATA] === true
  );
}
