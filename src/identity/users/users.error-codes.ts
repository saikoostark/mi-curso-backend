/**
 * Error codes owned by the user account/profile domain.
 *
 * Shared by registration, admin user management and the account/profile
 * primitives; the values are part of the public API contract.
 */
export const USER_ERRORS = {
  userNotFound: 'user_not_found',
  userProfileNotFound: 'user_profile_not_found',
  emailTaken: 'email_taken',
  usernameTaken: 'username_taken',
  emailUnchanged: 'email_unchanged',
  restoreConflict: 'restore_conflict',
} as const;

/** Union of the user-domain error codes. */
export type UserErrorCode = (typeof USER_ERRORS)[keyof typeof USER_ERRORS];
