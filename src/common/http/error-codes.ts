/**
 * Generic API error codes.
 *
 * These are the fallbacks owned by the HTTP layer: they are used when an
 * exception carries no domain `code` (framework 404/validation responses) or
 * when the failure is genuinely transport-level. Domain modules own their own
 * maps (for example `USER_ERRORS`, `AUTH_ERRORS`) so every code has one owner.
 *
 * Codes are stable public contract: clients may branch on them, so existing
 * values are never renamed.
 */
export const COMMON_ERROR_CODES = {
  validationFailed: 'validation_failed',
  badRequest: 'bad_request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  unprocessableEntity: 'unprocessable_entity',
  rateLimited: 'rate_limited',
  internalError: 'internal_error',
} as const;

/** Union of the generic error codes. */
export type CommonErrorCode =
  (typeof COMMON_ERROR_CODES)[keyof typeof COMMON_ERROR_CODES];
