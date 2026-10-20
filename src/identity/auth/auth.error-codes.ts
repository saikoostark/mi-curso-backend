/**
 * Error codes owned by the authentication journeys.
 *
 * Token-specific codes live in `TOKEN_ERRORS`; this map covers credentials and
 * account-state failures raised by login, refresh and password change.
 */
export const AUTH_ERRORS = {
  invalidCredentials: 'invalid_credentials',
  emailNotVerified: 'email_not_verified',
  passwordResetRequired: 'password_reset_required',
  invalidCurrentPassword: 'invalid_current_password',
} as const;

/** Union of the authentication-journey error codes. */
export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];
