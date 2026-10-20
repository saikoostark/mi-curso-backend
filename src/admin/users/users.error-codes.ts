/**
 * Error codes owned by the admin user use cases.
 *
 * `USER_ERRORS` owns account lookup/uniqueness codes; this map only covers
 * protections that exist on the administration surface.
 */
export const ADMIN_USER_ERRORS = {
  superuserProtected: 'superuser_protected',
  cannotDeleteSelf: 'cannot_delete_self',
  notDeleted: 'not_deleted',
} as const;

/** Union of the admin-user error codes. */
export type AdminUserErrorCode =
  (typeof ADMIN_USER_ERRORS)[keyof typeof ADMIN_USER_ERRORS];
