/**
 * Error codes owned by the token layer.
 *
 * Guards, access/refresh token services and the email/reset token service all
 * consume this map, so token failures stay consistent across journeys.
 */
export const TOKEN_ERRORS = {
  invalidToken: 'invalid_token',
  missingToken: 'missing_token',
  tokenRevoked: 'token_revoked',
  invalidRefreshToken: 'invalid_refresh_token',
  sessionNotFound: 'session_not_found',
} as const;

/** Union of the token-layer error codes. */
export type TokenErrorCode = (typeof TOKEN_ERRORS)[keyof typeof TOKEN_ERRORS];
