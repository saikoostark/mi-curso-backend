/**
 * Error codes owned by the password domain.
 *
 * Used by password policy/change flows and by the admin creation payload,
 * which validates the confirmation before hashing.
 */
export const PASSWORD_ERRORS = {
  passwordMismatch: 'password_mismatch',
  passwordPolicy: 'password_policy',
} as const;

/** Union of the password-domain error codes. */
export type PasswordErrorCode =
  (typeof PASSWORD_ERRORS)[keyof typeof PASSWORD_ERRORS];
