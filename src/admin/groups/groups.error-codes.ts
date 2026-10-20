/**
 * Error codes owned by the group administration domain.
 */
export const GROUP_ERRORS = {
  groupNotFound: 'group_not_found',
  groupNameTaken: 'group_name_taken',
} as const;

/** Union of the group-domain error codes. */
export type GroupErrorCode = (typeof GROUP_ERRORS)[keyof typeof GROUP_ERRORS];
