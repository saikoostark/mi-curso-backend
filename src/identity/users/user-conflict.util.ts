import { ConflictException } from '@nestjs/common';
import { uniqueViolationConstraint } from '../../database/unique-violation.js';
import { USER_ERRORS } from './users.error-codes.js';

/** Account identifier protected by one of the partial unique indexes. */
export type UserUniqueField = 'email' | 'username';

/**
 * Maps the partial unique index names to the account field they protect.
 *
 * The indexes are created by `AddUserSoftDelete`; renaming one without
 * updating this map would silently downgrade the corresponding race to a 500.
 */
const USER_UNIQUE_INDEXES: Record<string, UserUniqueField> = {
  uq_users_email_active: 'email',
  uq_users_username_active: 'username',
};

/**
 * Identifies which account identifier a unique violation is about.
 *
 * @param error - Error thrown by a users write.
 * @returns The field, or `null` when the error is not a users uniqueness
 * violation.
 */
export function userUniqueViolation(error: unknown): UserUniqueField | null {
  const constraint = uniqueViolationConstraint(error);
  return constraint ? (USER_UNIQUE_INDEXES[constraint] ?? null) : null;
}

/**
 * Converts a users unique violation into the canonical 409.
 *
 * Callers that check identifiers before writing still race with concurrent
 * registrations/updates; the database is the final authority, so this turns its
 * verdict into the same error the pre-check would have raised.
 *
 * @param error - Error thrown by a users write.
 * @returns The conflict, or `null` when the error must be rethrown untouched.
 */
export function toUserConflict(error: unknown): ConflictException | null {
  const field = userUniqueViolation(error);
  if (!field) {
    return null;
  }

  return field === 'email'
    ? new ConflictException({
        code: USER_ERRORS.emailTaken,
        message: 'This email is already registered.',
      })
    : new ConflictException({
        code: USER_ERRORS.usernameTaken,
        message: 'This username is already taken.',
      });
}

/**
 * Builds the restore-specific conflict listing the identifiers that collided.
 *
 * Restore cannot silently pick replacements, so the failing fields travel to
 * the client as `meta.conflicts` and the admin retries with new values.
 *
 * @param conflicts - Identifiers that belong to another active account.
 * @returns The 409 to throw.
 */
export function restoreConflict(
  conflicts: UserUniqueField[],
): ConflictException {
  return new ConflictException({
    code: USER_ERRORS.restoreConflict,
    message:
      'The stored email/username now belong to another account; provide replacements.',
    // Extra fields are promoted to `error.meta` by the exception filter.
    conflicts,
  });
}
